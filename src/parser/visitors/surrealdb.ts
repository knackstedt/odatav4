import Lexer from '../lexer';
import { Literal } from "../literal";
import { SQLLang, type SqlOptions } from "./types";
import { Visitor } from "./visitor";

export class SurrealDbVisitor extends Visitor {
    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        super({ useParameters: true, ...options, type: SQLLang.SurrealDB }, ast);
    }

    from(table: string) {
        let sql = `SELECT ${this.select} FROM ${table} WHERE ${this.where}`;
        const fetchPaths = this.getFetchPaths(this.includes);
        if (fetchPaths.length > 0) {
            sql += ` FETCH ${fetchPaths.join(", ")}`;
        }
        if (this.groupby) sql += ` GROUP BY ${this.groupby}`;
        if (this.orderby) sql += ` ORDER BY ${this.orderby}`;
        if (this.limit) sql += ` LIMIT ${this.limit}`;
        if (this.skip) sql += ` START ${this.skip}`;
        return sql;
    }

    protected VisitComparisonExpression(node: Lexer.Token, context: any, operator: string) {
        const left = node.value.left;
        const right = node.value.right;

        // Helper to check if a node contains an aliased field
        const containsAliasedField = (n: any): boolean => {
            if (!n) return false;
            if (n.type === Lexer.TokenType.ODataIdentifier && n.value?.name && this.options.fieldAliases?.[n.value.name]) {
                return true;
            }
            // Check nested structures
            if (n.value) {
                if (n.value.left && containsAliasedField(n.value.left)) return true;
                if (n.value.right && containsAliasedField(n.value.right)) return true;
                if (n.value.current && containsAliasedField(n.value.current)) return true;
                if (n.value.next && containsAliasedField(n.value.next)) return true;
            }
            return false;
        };

        // Skip record ID logic if either side contains an aliased field
        // ALIASED fields are only ever treated as plaintext fields.
        if (containsAliasedField(left) || containsAliasedField(right)) {
            this.Visit(node.value.left, context);
            this.where += ` ${operator} `;
            this.Visit(node.value.right, context);
            return;
        }

        // Standard comparison - RecordIds are now explicitly handled with r"..." prefix
        // and converted using type::record() in VisitLiteral
        this.Visit(node.value.left, context);
        this.where += ` ${operator} `;
        this.Visit(node.value.right, context);
    }

    protected VisitGroupByItem(node: Lexer.Token, context: any) {
        this.groupby += '`' + node.value.expr.raw.replace(/`/g, '\\`') + '`';
    }

    protected VisitSelectItem(node: Lexer.Token, context: any) {
        if (node.raw === '*') {
            this.select += '*';
            return;
        }

        const fieldSeed = `$select${this.selectSeed++}`;
        this.parameters.set(fieldSeed, node.raw);
        this.select += `type::field(${fieldSeed}) AS \`${node.raw.replace(/`/g, '\\`')}\``;
    }

    protected VisitAndExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value.left, context);
        this[target] += " && ";
        this.Visit(node.value.right, context);
        this[target] += ")";
    }

    protected VisitOrExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value.left, context);
        this[target] += " || ";
        this.Visit(node.value.right, context);
        this[target] += ")";
    }

    protected VisitNotExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "!(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitInExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " in [";

        const items = [];
        for (let i = 0; i < node.value.right.values.length; i++) {
            const item = node.value.right.values[i];
            const value = Literal.convert(item.value, item.raw);

            this.checkParameterLimit();
            const seed = `$param${this.parameterSeed++}`;
            this.parameters.set(seed, value);
            items.push(seed);

            if (typeof value == "string" && /(?<=[^\\]|^):/.test(value)) {
                items.push(`type::record(${seed})`);
            }
        }
        this.where += items.join(", ");
        this.where += "]";
    }

    protected VisitHasExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " CONTAINS ";
        this.Visit(node.value.right, context);
    }

    protected VisitIsOfExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const typeName = node.value.right?.value || node.value.right?.raw;
        const typeMap: Record<string, string> = {
            'Edm.String': 'string',
            'Edm.Int32': 'number',
            'Edm.Int64': 'number',
            'Edm.Decimal': 'number',
            'Edm.Double': 'number',
            'Edm.Boolean': 'bool',
            'Edm.Guid': 'string',
            'Edm.Date': 'datetime',
            'Edm.DateTimeOffset': 'datetime'
        };

        const surrealType = typeMap[typeName] || 'string';
        this[target] += `type::is::${surrealType}(`;
        this.Visit(node.value.left, context);
        this[target] += ")";
    }

    protected VisitCastExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const typeName = node.value.right?.value || node.value.right?.raw;
        const typeMap: Record<string, string> = {
            'Edm.String': 'string',
            'Edm.Int32': 'int',
            'Edm.Int64': 'int',
            'Edm.Decimal': 'decimal',
            'Edm.Double': 'float',
            'Edm.Boolean': 'bool',
            'Edm.Date': 'datetime',
            'Edm.DateTimeOffset': 'datetime'
        };

        const surrealType = typeMap[typeName] || 'string';
        this[target] += `type::${surrealType}(`;
        this.Visit(node.value.left, context);
        this[target] += ")";
    }

    protected VisitAddExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // SurrealDB logic as seen in original file
        if (this.isId(node.value.left) || this.isId(node.value.right)) {
            this[target] += "NULL";
        }
        else {
            super.VisitAddExpression(node, context);
        }
    }

    protected VisitSubExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.isId(node.value.left) || this.isId(node.value.right)) {
            this[target] += "NULL";
        }
        else {
            super.VisitSubExpression(node, context);
        }
    }

    protected VisitMulExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.isId(node.value.left) || this.isId(node.value.right)) {
            this[target] += "NULL";
        }
        else {
            super.VisitMulExpression(node, context);
        }
    }

    protected VisitDivExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.isId(node.value.left) || this.isId(node.value.right)) {
            this[target] += "NULL";
        }
        else {
            super.VisitDivExpression(node, context);
        }
    }

    protected VisitModExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.isId(node.value.left) || this.isId(node.value.right)) {
            this[target] += "NULL";
        }
        else {
            super.VisitModExpression(node, context);
        }
    }

    protected VisitFirstMemberExpression(node: Lexer.Token, context: any) {
        if (Array.isArray(node.value)) {
            const [first, second] = node.value;
            if (first.type === Lexer.TokenType.LambdaVariableExpression) {
                this.Visit(second, context);
            } else {
                this.Visit(first, context);
                const target = context?.target || 'where';
                this[target] += "->";
                this.Visit(second, context);
            }
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitMemberExpression(node: Lexer.Token, context: any) {
        if (node.value.name && node.value.value) {
            this.Visit(node.value.name, context);
            const target = context?.target || 'where';
            this[target] += "->";
            this.Visit(node.value.value, context);
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            const isCollectionPath = node.value.next.type === Lexer.TokenType.CollectionPathExpression;
            if (!isCollectionPath) {
                this[target] += "->";
            }
            this.Visit(node.value.next, context);
        }
        else this.Visit(node.value, context);
    }

    protected VisitODataIdentifier(node: Lexer.Token, context: any) {
        const fieldName = node.value.name;
        const aliasedField = this.options.fieldAliases?.[fieldName];

        if (context.target == 'orderby') {
            if (aliasedField) {
                this[context.target] += aliasedField;
            } else {
                this[context.target] += '`' + fieldName.replace(/`/g, '\\`') + '`';
            }
        }
        else {
            if (aliasedField) {
                this[context.target] += aliasedField;
            } else {
                const fieldSeed = `$field${this.fieldSeed++}`;
                this.parameters.set(fieldSeed, fieldName);
                this[context.target] += `type::field(${fieldSeed})`;
            }
        }
    }

    protected VisitEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "=");
        // Does not implement IS NULL logic here as SurrealDB handles NULL differently or the original code excluded it for SurrealDB
    }

    protected VisitNotEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "!=");
    }

    protected VisitLiteral(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.options.useParameters) {
            this.checkParameterLimit();
            let name = `$literal${this.parameterSeed++}`;
            let value = Literal.convert(node.value, node.raw);

            if (node.value === 'Edm.RecordId') {
                // value is a record ID string from the literal converter (e.g., "table:id")
                // Use type::record() cast to convert string to RecordId in SurrealDB
                // This keeps the parameter as a string for clean JSON serialization
                context.literal = value;
                this.parameters.set(name, value);
                this[target] += `type::record(${name})`;
                return;
            }
            else if (node.value === 'Edm.PrefixedDate') {
                // value is a date string from the literal converter
                // Use <datetime> cast to preserve nanosecond precision
                context.literal = value;
                this.parameters.set(name, value);
                this[target] += `<datetime>${name}`;
                return;
            }
            else if (node.value === 'Edm.PrefixedNumber') {
                // value is a number string from the literal converter
                // Use <number> cast to preserve decimal precision and handle large integers
                context.literal = value;
                this.parameters.set(name, value);
                this[target] += `<number>${name}`;
                return;
            }
            else if (node.value === 'Edm.GeographyPoint') {
                const match = node.raw.match(/'Point\(([^)]+)\)'/);
                if (match) {
                    const [x, y] = match[1].split(' ').map(Number);
                    this[target] += `(${x}, ${y})`;
                    return;
                }
            }
            else if (node.value === 'Edm.GeographyPolygon') {
                const match = node.raw.match(/'Polygon\(\(([^)]+)\)\)'/);
                if (match) {
                    // TODO: Verify this structure. Original code used arrays for Polygon?
                    const points = match[1].split(',').map(p => p.trim().split(' ').map(Number));
                    value = { type: 'Polygon', coordinates: [points] };
                }
            }

            context.literal = value;
            this.parameters.set(name, value);
            this[target] += name;
        } else {
            // For literals without parameters, we might want to let BaseVisitor handle standard ones,
            // but Geo types need handling if not using parameters?
            // Original code defaults to SQLLiteral.convert which handles standard types.
            // But SurrealDB logic for Geo types was only inside `if (useParameters)` block basically?
            // Actually original code had the Geo logic inside `if (this.options.useParameters)` block.
            // If not using parameters, it fell back to SQLLiteral.convert.
            super.VisitLiteral(node, context);
        }
    }

    protected VisitAnyExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // "Comments/any(c:c/Score gt 5)" -> Comments[WHERE $this.Score > 5] != []
        this[target] += "[WHERE ";
        this.Visit(node.value.predicate, context);
        this[target] += "] != []";
    }

    protected VisitAllExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // "Comments/all(c:c/Score gt 5)" -> Comments[WHERE !($this.Score > 5)] = []
        this[target] += "[WHERE !(";
        this.Visit(node.value.predicate, context);
        this[target] += ")] = []";
    }

    protected VisitLambdaVariableExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "$this";
    }

    protected VisitImplicitVariableExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "$this";
    }

    /**
     * Helper method to convert literal values with proper type handling for SurrealDB
     * Handles RecordId, PrefixedDate, and PrefixedNumber conversions
     * All are kept as strings for clean JSON serialization and wrapped with type casts in queries
     */
    private convertLiteralValue(literalNode: Lexer.Token): any {
        let value = Literal.convert(literalNode.value, literalNode.raw);

        // RecordId, PrefixedDate, and PrefixedNumber are all kept as strings
        // They will be wrapped with type casts when added to the query:
        // - RecordId: type::record($param)
        // - PrefixedDate: <datetime>$param
        // - PrefixedNumber: <number>$param

        return value;
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];
        this.checkParameterLimit();
        const name = `$param${this.parameterSeed++}`;

        switch (method) {
            case "contains":
                // Use SurrealDB's native CONTAINS operator
                this.Visit(params[0], context);
                this[target] += ' CONTAINS ';
                let value = this.convertLiteralValue(params[1]);
                this.parameters.set(name, value);
                this[target] += name;
                break;
            case "endswith":
                this[target] += 'string::ends_with(';
                this.Visit(params[0], context);

                let value2 = this.convertLiteralValue(params[1]);
                this.parameters.set(name, value2);
                this[target] += `, type::string(${name}))`;
                break;
            case "startswith":
                this[target] += 'string::starts_with(';
                this.Visit(params[0], context);

                let value3 = this.convertLiteralValue(params[1]);
                this.parameters.set(name, value3);
                this[target] += `, type::string(${name}))`;
                break;
            case "indexof":
                this[target] += "(IF type::string(";
                this.Visit(params[0], context);
                this[target] += ") CONTAINS ";
                this.Visit(params[1], context);
                this[target] += " THEN string::len(string::split(type::string(";
                this.Visit(params[0], context);
                this[target] += "), type::string(";
                this.Visit(params[1], context);
                this[target] += "))[0]) ELSE -1 END)";
                break;

            case "round":
                this[target] += "math::round(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "floor":
                this[target] += "math::floor(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "ceiling":
                this[target] += "math::ceil(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "geo.distance":
                this[target] += "geo::distance(";
                this.Visit(params[0], context);
                this[target] += ", ";
                this.Visit(params[1], context);
                this[target] += ")";
                break;
            case "geo.intersects":
                this[target] += "geo::contains(";
                this.Visit(params[0], context);
                this[target] += ", ";
                this.Visit(params[1], context);
                this[target] += ")";
                break;
            case "length":
                this[target] += "string::len(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "substring":
                this[target] += "string::slice(";
                this.Visit(params[0], context);
                this[target] += ", ";
                this.Visit(params[1], context);
                if (params[2]) {
                    this[target] += ", ";
                    this.Visit(params[2], context);
                }
                this[target] += ")";
                break;
            case "concat":
                this[target] += "string::concat(";
                this.Visit(params[0], context);
                this[target] += ", ";
                this.Visit(params[1], context);
                this[target] += ")";
                break;
            case "tolower":
                this[target] += "string::lowercase(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "toupper":
                this[target] += "string::uppercase(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "trim":
                this[target] += "string::trim(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            // Time functions
            case "year":
                this[target] += "time::year(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "month":
                this[target] += "time::month(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "day":
                this[target] += "time::day(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "hour":
                this[target] += "time::hour(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "minute":
                this[target] += "time::minute(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "second":
                this[target] += "time::second(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "fractionalseconds":
                this[target] += "time::nano(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "date":
                this[target] += "time::floor(";
                this.Visit(params[0], context);
                this[target] += ", 1d)";
                break;
            case "time":
                this[target] += "time::format(";
                this.Visit(params[0], context);
                this[target] += ", \"%T\")";
                break;
            case "now":
                this[target] += "time::now()";
                break;

            default:
                super.VisitMethodCallExpression(node, context);
                break;
        }
    }
}
