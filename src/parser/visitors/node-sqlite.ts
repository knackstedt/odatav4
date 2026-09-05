
import Lexer from '../lexer';
import { Literal } from "../literal";
import { ODataV4ParseError } from '../utils';
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

/**
 * Visitor that translates OData V4 query expressions into SQLite-compatible SQL
 * suitable for execution via Node.js' built-in `node:sqlite` module
 * (`DatabaseSync` / `StatementSync`).
 *
 * Design notes:
 *  - Parameter binding is always enabled (`useParameters: true`) to neutralise
 *    SQL-injection payloads the same way `MsSqlVisitor` does. The base
 *    `VisitLiteral` inlines `SQLLiteral.convert()` output directly into the
 *    query when `useParameters` is false, and `SQLLiteral`'s `Edm.String`
 *    handler decodes OData's `''` escaping without re-escaping for SQL,
 *    allowing an attacker to break out of the string literal. Binding values
 *    as parameters neutralises the payload.
 *  - SQLite supports several parameter forms (`?`, `?NNN`, `:name`, `@name`,
 *    `$name`). We reuse the base visitor's `$literalN` / `$paramN` named
 *    parameter scheme, which is valid SQLite `$name` syntax. Consumers can
 *    bind these via `StatementSync.setNamedParameter()` or by passing an
 *    object to `.all()` / `.get()` / `.run()`.
 *  - Identifiers are quoted with double quotes (`"col"`), the canonical
 *    SQLite quoting. Backticks are also accepted by SQLite but double quotes
 *    are the standard.
 *  - SQLite has no `LEN` (use `LENGTH`), no `LOCATE`/`CHARINDEX`/`POSITION`
 *    (use `INSTR`), no `CONCAT` (use `||`), and no `FLOOR`/`CEIL` unless
 *    compiled with `SQLITE_ENABLE_MATH_FUNCTIONS` (SQLite >= 3.35). We emit
 *    `floor()`/`ceil()` which work on modern SQLite builds.
 *  - Date/time functions use SQLite's `strftime()` format codes.
 */
export class NodeSqliteVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        // Force parameterized literals to prevent SQL injection. The base
        // VisitLiteral inlines SQLLiteral.convert() output directly into the
        // query when useParameters is false, and SQLLiteral's Edm.String
        // handler decodes OData's '' escaping without re-escaping for SQL,
        // allowing an attacker to break out of the string literal. Binding
        // values as parameters neutralises the payload.
        super({ ...options, useParameters: true, type: SQLLang.NodeSqlite }, ast);
    }

    from(table: string) {
        const quotedTable = this.quoteIdentifier(table);
        let sql = `SELECT ${this.select} FROM ${quotedTable}`;
        if (this.where) sql += ` WHERE ${this.where}`;
        else sql += ` WHERE 1 = 1`;
        if (this.groupby) sql += ` GROUP BY ${this.groupby}`;
        // Skip the default "1" orderby placeholder set by the base Visit().
        if (this.orderby && this.orderby !== '1') sql += ` ORDER BY ${this.orderby}`;
        if (this.limit) sql += ` LIMIT ${this.limit}`;
        // SQLite requires LIMIT when using OFFSET.
        if (this.skip) {
            if (!this.limit) sql += ` LIMIT -1`;
            sql += ` OFFSET ${this.skip}`;
        }
        return sql;
    }

    /**
     * Quote an identifier using SQLite's canonical double-quote syntax.
     * Embedded double quotes are escaped by doubling them (`""`).
     */
    protected quoteIdentifier(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }

    protected VisitODataIdentifier(node: Lexer.Token, context: any) {
        const fieldName = node.value.name;
        const aliasedField = this.options.fieldAliases?.[fieldName];

        if (aliasedField) {
            this[context.target] += aliasedField;
        } else {
            this[context.target] += this.quoteIdentifier(fieldName);
        }
        context.identifier = node.value.name;
    }

    protected VisitSelectItem(node: Lexer.Token, context: any) {
        if (node.raw === '*') {
            this.select += '*';
            return;
        }

        // Handle namespace.* pattern (e.g., lime.*)
        if (node.value?.namespace && node.value?.value === '*') {
            this.select += `${this.quoteIdentifier(node.value.namespace)}.*`;
            return;
        }

        // For dot-notation paths, build the full path and quote each segment.
        const raw = node.raw.replace(/\//g, '.');
        if (raw.includes('.')) {
            const parts = raw.split('.');
            const aliasedField = this.options.fieldAliases?.[raw];
            if (aliasedField) {
                this.select += `${aliasedField} AS ${this.quoteIdentifier(raw)}`;
            } else {
                const quoted = parts.map(p => this.quoteIdentifier(p)).join('.');
                this.select += `${quoted} AS ${this.quoteIdentifier(raw)}`;
            }
            return;
        }

        const aliasedField = this.options.fieldAliases?.[raw];
        if (aliasedField) {
            this.select += `${aliasedField} AS ${this.quoteIdentifier(raw)}`;
        } else {
            this.select += `${this.quoteIdentifier(raw)} AS ${this.quoteIdentifier(raw)}`;
        }
    }

    protected VisitGroupByItem(node: Lexer.Token, context: any) {
        const raw = node.value.expr.raw;
        if (raw.includes('.')) {
            this.groupby += raw.split('.').map((p: string) => this.quoteIdentifier(p)).join('.');
        } else {
            this.groupby += this.quoteIdentifier(raw);
        }
    }

    /**
     * Handle dot-notation property paths (e.g., Address/City or Address.City).
     * SQLite stores nested objects as JSON text; use json_extract to access
     * nested fields.
     */
    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            // Check if this is a lambda expression (e.g., Tags/any(t: ...) or Tags/all(t: ...))
            // The 'next' node is a CollectionPathExpression wrapping an AnyExpression or AllExpression.
            const nextNode = node.value.next;
            const lambdaType = nextNode?.value?.type;
            if (lambdaType === Lexer.TokenType.AnyExpression || lambdaType === Lexer.TokenType.AllExpression) {
                const lambdaNode = nextNode.value;
                // Capture buffer position before emitting the collection column reference.
                const bufStart = this[target].length;
                // Visit the current node to emit the column reference (e.g., "Tags").
                this.Visit(node.value.current, context);
                // Extract the emitted column reference.
                const collectionExpr = this[target].slice(bufStart);
                // Remove it from the buffer — we'll wrap it in json_each() instead.
                this[target] = this[target].slice(0, bufStart);
                // Build the json_each subquery.
                if (lambdaType === Lexer.TokenType.AnyExpression) {
                    this[target] += `EXISTS (SELECT 1 FROM json_each((${collectionExpr})) WHERE `;
                    this.Visit(lambdaNode.value.predicate, context);
                    this[target] += ")";
                } else {
                    this[target] += `NOT EXISTS (SELECT 1 FROM json_each((${collectionExpr})) WHERE NOT (`;
                    this.Visit(lambdaNode.value.predicate, context);
                    this[target] += "))";
                }
                return;
            }

            // Build the full dot path
            const fullPath = this.getFullPathFromNode(node);
            if (fullPath && this.options.fieldAliases?.[fullPath]) {
                this[target] += this.options.fieldAliases[fullPath];
                return;
            }

            // For SQLite, use json_extract for nested paths.
            // The first segment is the column, the rest is the JSON path.
            const parts = fullPath ? fullPath.split('.') : [];
            if (parts.length >= 2) {
                const column = this.quoteIdentifier(parts[0]);
                const jsonPath = '$.' + parts.slice(1).join('.');
                this[target] += `json_extract(${column}, '${jsonPath}')`;
                return;
            }

            // Fallback to base behavior
            this.Visit(node.value.current, context);
            this[target] += ".";
            this.Visit(node.value.next, context);
        }
        else this.Visit(node.value, context);
    }

    /**
     * Extract a dot-separated path string from a PropertyPathExpression node.
     */
    private getFullPathFromNode(node: Lexer.Token): string | null {
        if (!node) return null;

        // ODataIdentifier - the leaf node with the actual name
        if (node.type === Lexer.TokenType.ODataIdentifier && node.value?.name) {
            return node.value.name;
        }

        // PropertyPathExpression - has current and next
        if (node.type === Lexer.TokenType.PropertyPathExpression && node.value?.current) {
            let path = this.getFullPathFromNode(node.value.current);
            if (node.value.next) {
                const nextPath = this.getFullPathFromNode(node.value.next);
                if (nextPath && path) path = `${path}.${nextPath}`;
                else if (nextPath) path = nextPath;
            }
            return path;
        }

        // SingleNavigationExpression - wraps a MemberExpression
        if (node.type === Lexer.TokenType.SingleNavigationExpression) {
            if (node.value?.current && node.value?.next) {
                let path = this.getFullPathFromNode(node.value.current);
                const nextPath = this.getFullPathFromNode(node.value.next);
                if (nextPath && path) path = `${path}.${nextPath}`;
                else if (nextPath) path = nextPath;
                return path;
            }
            return this.getFullPathFromNode(node.value);
        }

        // MemberExpression - wraps another expression
        if (node.type === Lexer.TokenType.MemberExpression) {
            if (node.value?.name && node.value?.value) {
                let path = this.getFullPathFromNode(node.value.name);
                const nextPath = this.getFullPathFromNode(node.value.value);
                if (nextPath && path) path = `${path}.${nextPath}`;
                else if (nextPath) path = nextPath;
                return path;
            }
            return this.getFullPathFromNode(node.value);
        }

        // SelectPath, ComplexProperty, etc.
        if (node.value?.name) return node.value.name;
        if (node.value) return this.getFullPathFromNode(node.value);

        return null;
    }

    /**
     * Lambda 'any' operator: collection/any(var: predicate)
     *
     * Lambda expressions are handled directly in VisitPropertyPathExpression,
     * which captures the collection column reference and wraps it in
     * json_each(). This method is only reached if the lambda is not part of
     * a property path expression, which should not occur in valid OData.
     */
    protected VisitAnyExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Lambda 'any' must be used with a collection property path (e.g., Tags/any(t: ...)).` });
    }

    /**
     * Lambda 'all' operator: collection/all(var: predicate)
     *
     * Lambda expressions are handled directly in VisitPropertyPathExpression.
     * See VisitAnyExpression for details.
     */
    protected VisitAllExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Lambda 'all' must be used with a collection property path (e.g., Tags/all(t: ...)).` });
    }

    /**
     * Lambda variable: $this refers to the current element in the lambda.
     * In SQLite's json_each, the current element is accessed via `value`.
     * Note: json_each returns `value` as already-unquoted text, so we use
     * it directly (not json_extract(value, '$') which would fail on plain
     * text values).
     */
    protected VisitLambdaVariableExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "value";
    }

    protected VisitImplicitVariableExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "value";
    }

    protected VisitNotExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "NOT (";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitLiteral(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // node:sqlite does not accept boolean values as bound parameters.
        // SQLite stores booleans as INTEGER 0/1, so convert here.
        if (node.value === 'Edm.Boolean') {
            this.checkParameterLimit();
            const name = `$literal${this.parameterSeed++}`;
            const raw = node.raw || '';
            const value = raw.toLowerCase() === 'true' ? 1 : 0;
            context.literal = value;
            this.parameters.set(name, value);
            this[target] += name;
            return;
        }
        // Let the base class handle all other literal types.
        super.VisitLiteral(node, context);
    }

    protected VisitInExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " IN (";

        const items = [];
        for (let i = 0; i < node.value.right.values.length; i++) {
            const item = node.value.right.values[i];
            let value = Literal.convert(item.value, item.raw);
            // node:sqlite does not accept boolean values; convert to 0/1.
            if (typeof value === 'boolean') value = value ? 1 : 0;

            this.checkParameterLimit();
            const seed = `$param${this.parameterSeed++}`;
            this.parameters.set(seed, value);
            items.push(seed);
        }
        this.where += items.join(", ");
        this.where += ")";
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "indexof":
                // SQLite's INSTR(haystack, needle) returns 1-based position,
                // 0 if not found. OData's indexof returns 0-based, -1 if not found.
                this[target] += "(INSTR(";
                this.Visit(params[0], context); // string (haystack)
                this[target] += ", ";
                this.Visit(params[1], context); // substring (needle)
                this[target] += ") - 1)";
                break;

            case "length":
                this[target] += "LENGTH(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "substring":
                // OData substring(string, startPos [, length])
                // SQLite substr(string, startPos [, length])
                // OData startPos is 0-based; SQLite substr startPos is 1-based.
                this[target] += "SUBSTR(";
                this.Visit(params[0], context);
                this[target] += ", ";
                // Adjust 0-based to 1-based by adding 1.
                this[target] += "(";
                this.Visit(params[1], context);
                this[target] += ") + 1";
                if (params[2]) {
                    this[target] += ", ";
                    this.Visit(params[2], context);
                }
                this[target] += ")";
                break;

            case "concat":
                // SQLite has no CONCAT function; use || operator.
                this[target] += "(";
                this.Visit(params[0], context);
                this[target] += " || ";
                // Handle variadic concat (OData concat accepts 2+ args).
                for (let i = 1; i < params.length; i++) {
                    this.Visit(params[i], context);
                    if (i < params.length - 1) this[target] += " || ";
                }
                this[target] += ")";
                break;

            case "contains":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    const value = Literal.convert(params[1].value, params[1].raw);
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    this.parameters.set(name, `%${value}%`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '%${Literal.convert(params[1].value, params[1].raw)}%'`;
                break;

            case "startswith":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    const value = Literal.convert(params[1].value, params[1].raw);
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    this.parameters.set(name, `${value}%`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '${Literal.convert(params[1].value, params[1].raw)}%'`;
                break;

            case "endswith":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    const value = Literal.convert(params[1].value, params[1].raw);
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    this.parameters.set(name, `%${value}`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '%${Literal.convert(params[1].value, params[1].raw)}'`;
                break;

            case "round":
                this[target] += "ROUND(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "abs":
                // Requires SQLite >= 3.35 with SQLITE_ENABLE_MATH_FUNCTIONS
                this[target] += "abs(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "floor":
                // Requires SQLite >= 3.35 with SQLITE_ENABLE_MATH_FUNCTIONS
                this[target] += "floor(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "ceiling":
                // Requires SQLite >= 3.35 with SQLITE_ENABLE_MATH_FUNCTIONS
                this[target] += "ceil(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "tolower":
                this[target] += "LOWER(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "toupper":
                this[target] += "UPPER(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "trim":
                this[target] += "TRIM(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            // Date/time functions - SQLite uses strftime with format codes
            case "year":
                this[target] += "CAST(strftime('%Y', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "month":
                this[target] += "CAST(strftime('%m', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "day":
                this[target] += "CAST(strftime('%d', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "hour":
                this[target] += "CAST(strftime('%H', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "minute":
                this[target] += "CAST(strftime('%M', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "second":
                this[target] += "CAST(strftime('%S', ";
                this.Visit(params[0], context);
                this[target] += ") AS INTEGER)";
                break;
            case "fractionalseconds":
                // SQLite stores fractional seconds via %f (SS.SSS)
                this[target] += "CAST(strftime('%f', ";
                this.Visit(params[0], context);
                this[target] += ") AS REAL)";
                break;
            case "date":
                this[target] += "date(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "time":
                this[target] += "time(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "now":
                this[target] += "datetime('now')";
                break;
            case "maxdatetime":
                this[target] += "'9999-12-31T23:59:59Z'";
                break;
            case "mindatetime":
                this[target] += "'0001-01-01T00:00:00Z'";
                break;
            case "totaloffsetminutes":
                throw new ODataV4ParseError({ msg: `totaloffsetminutes is not supported in SQLite (no native timezone offset support).` });
            case "totalseconds":
                // Convert datetime to total seconds since epoch
                this[target] += "strftime('%s', ";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "geo.distance": {
                // geo.distance(point1, point2) - Haversine formula
                // Points are stored as JSON {lat, lng} or as geography'Point(lng lat)'
                // We extract lat/lng using json_extract and compute the great-circle distance.
                const geoArgs = node.value.parameters;
                this[target] += "(";
                this[target] += "6371000 * 2 * asin(sqrt(";
                this[target] += "pow(sin((radians(json_extract(";
                this.Visit(geoArgs[1], context);
                this[target] += ", '$.lat')) - radians(json_extract(";
                this.Visit(geoArgs[0], context);
                this[target] += ", '$.lat')) / 2), 2) + ";
                this[target] += "cos(radians(json_extract(";
                this.Visit(geoArgs[0], context);
                this[target] += ", '$.lat'))) * cos(radians(json_extract(";
                this.Visit(geoArgs[1], context);
                this[target] += ", '$.lat'))) * ";
                this[target] += "pow(sin((radians(json_extract(";
                this.Visit(geoArgs[1], context);
                this[target] += ", '$.lng')) - radians(json_extract(";
                this.Visit(geoArgs[0], context);
                this[target] += ", '$.lng')) / 2), 2)";
                this[target] += ")))";
                this[target] += ")";
                return;
            }

            case "geo.intersects":
                throw new ODataV4ParseError({ msg: `geo.intersects is not supported in SQLite. Use a spatial extension or implement intersection in application logic.` });

            case "geo.length":
                throw new ODataV4ParseError({ msg: `geo.length is not supported in SQLite. Use a spatial extension or implement length calculation in application logic.` });

            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }

    protected VisitHasExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " & ";
        this.Visit(node.value.right, context);
    }

    protected VisitIsOfExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // The parser stores the type name in node.value.typename
        // and the target expression in node.value.target.
        // The typename raw may include surrounding single quotes (e.g. 'Edm.String')
        let typeName = node.value.typename?.value?.name || node.value.typename?.raw || node.value.typename?.value;
        if (typeof typeName === 'string' && typeName.startsWith("'") && typeName.endsWith("'")) {
            typeName = typeName.slice(1, -1);
        }
        // SQLite's typeof() returns 'null', 'integer', 'real', 'text', or 'blob'.
        const typeMap: Record<string, string> = {
            'Edm.String': 'text',
            'Edm.Int32': 'integer',
            'Edm.Int64': 'integer',
            'Edm.Decimal': 'real',
            'Edm.Double': 'real',
            'Edm.Single': 'real',
            'Edm.Boolean': 'integer',
            'Edm.Guid': 'text',
            'Edm.Date': 'text',
            'Edm.DateTimeOffset': 'text'
        };
        const sqliteType = typeMap[typeName] || 'text';
        if (node.value.target) {
            this[target] += "(typeof(";
            this.Visit(node.value.target, context);
            this[target] += `) = '${sqliteType}')`;
        } else {
            // isof(typeName) without an expression checks the implicit $it
            // variable, which has no meaningful single type in SQLite.
            throw new ODataV4ParseError({ msg: `isof(typeName) without an expression is not supported in SQLite.` });
        }
    }

    protected VisitCastExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // The parser stores the type name in node.value.typename
        // and the target expression in node.value.target.
        let typeName = node.value.typename?.value?.name || node.value.typename?.raw || node.value.typename?.value;
        if (typeof typeName === 'string' && typeName.startsWith("'") && typeName.endsWith("'")) {
            typeName = typeName.slice(1, -1);
        }
        const typeMap: Record<string, string> = {
            'Edm.String': 'TEXT',
            'Edm.Int32': 'INTEGER',
            'Edm.Int64': 'INTEGER',
            'Edm.Decimal': 'REAL',
            'Edm.Double': 'REAL',
            'Edm.Single': 'REAL',
            'Edm.Boolean': 'INTEGER',
            'Edm.Guid': 'TEXT',
            'Edm.Date': 'TEXT',
            'Edm.DateTimeOffset': 'TEXT'
        };
        const sqliteType = typeMap[typeName] || 'TEXT';
        this[target] += `CAST(`;
        if (node.value.target) {
            this.Visit(node.value.target, context);
        } else {
            this[target] += 'NULL';
        }
        this[target] += ` AS ${sqliteType})`;
    }
}
