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

        // Check if this select item has a nested path structure (from dot notation)
        // The structure is: SelectItem.value = SelectPath, and SelectPath.value = { path, next }
        const pathValue = node.value?.value;
        if (pathValue?.path && pathValue?.next) {
            // Build the full path for alias checking
            let fullPath = this.getFullPath(pathValue.path);
            const nextPath = this.getFullPath(pathValue.next);
            if (fullPath && nextPath) {
                fullPath = `${fullPath}.${nextPath}`;
            }

            // Get clean dot path for AS clause (e.g., `foo`.`bar` -> foo.bar)
            const cleanPath = this.getCleanDotPath(pathValue);
            const asClause = cleanPath ? this.buildBacktickWrappedAsClause(cleanPath) : node.raw.replace(/`/g, '');

            // Check if the full path has a field alias
            if (fullPath && this.options.fieldAliases?.[fullPath]) {
                const alias = this.options.fieldAliases[fullPath];
                this.select += `${alias} AS ${asClause}`;
                return;
            }

            // For dot notation, use a single type::field() with the backtick-wrapped path
            // e.g., type::field('`foo`.`bar`') AS `foo`.`bar`
            const fieldSeed = `$field${this.fieldSeed++}`;
            this.parameters.set(fieldSeed, asClause);
            this.select += `type::field(${fieldSeed}) AS ${asClause}`;
            return;
        }

        // Extract the field name from the token value (decoded, without backticks)
        // For simple select items: node.value (SelectPath) -> value (ComplexProperty/PrimitiveProperty) -> value (ODataIdentifier) -> name
        const fieldName = node.value?.value?.value?.name || node.value?.value?.name || node.value?.name || node.raw;

        const fieldSeed = `$select${this.selectSeed++}`;
        this.parameters.set(fieldSeed, fieldName);
        this.select += `type::field(${fieldSeed}) AS \`${fieldName.replace(/`/g, '\\`')}\``;
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

            // Wrap with appropriate type cast based on literal type
            if (item.value === 'Edm.RecordId') {
                items.push(`type::record(${seed})`);
            } else if (item.value === 'Edm.PrefixedDate') {
                items.push(`<datetime>${seed}`);
            } else if (item.value === 'Edm.PrefixedNumber') {
                items.push(`<number>${seed}`);
            } else {
                items.push(seed);
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

    // Helper to extract the full dot-notation path from a property path expression
    private getFullPath(node: Lexer.Token): string | null {
        if (!node) return null;

        // Handle ODataIdentifier
        if (node.type === Lexer.TokenType.ODataIdentifier && node.value?.name) {
            return node.value.name;
        }

        // Handle SinglePathExpression (dot path) - value is the next token in the path
        if (node.type === Lexer.TokenType.SinglePathExpression) {
            // SinglePathExpression.value contains the next part of the path (often an ODataIdentifier)
            const nextPath = this.getFullPath(node.value);
            return nextPath;
        }

        // Handle PropertyPathExpression - recursively build path from current and next
        if (node.type === Lexer.TokenType.PropertyPathExpression && node.value?.current) {
            let path = this.getFullPath(node.value.current);
            if (node.value.next) {
                const nextPath = this.getFullPath(node.value.next);
                if (nextPath && path) {
                    path = `${path}.${nextPath}`;
                } else if (nextPath) {
                    path = nextPath;
                }
            }
            return path;
        }

        // Handle SelectPath - may contain ComplexProperty, ComplexCollectionProperty, etc.
        if (node.type === Lexer.TokenType.SelectPath && node.value) {
            // SelectPath.value may be a property token with a name
            if (node.value.name) {
                return node.value.name;
            }
            // Or it may have nested structure
            return this.getFullPath(node.value);
        }

        // Handle ComplexProperty, ComplexCollectionProperty, PrimitiveProperty, etc.
        if (node.value?.name) {
            return node.value.name;
        }

        return null;
    }

    // Helper to extract clean dot-notation path for AS clause from SelectPath with dot notation
    // Converts `foo`.`bar` to foo.bar (removes backticks but keeps dots)
    private getCleanDotPath(pathValue: any): string | null {
        if (!pathValue) return null;

        const parts: string[] = [];

        // Extract the first part
        const firstPart = this.getFullPath(pathValue.path);
        if (firstPart) parts.push(firstPart);

        // Extract the rest of the path recursively
        const extractNext = (node: any): void => {
            if (!node) return;

            // If it's a token (like SinglePathExpression), check its value property
            if (node.type === Lexer.TokenType.SinglePathExpression) {
                // SinglePathExpression has either:
                // 1. value.current and value.next (for nested paths)
                // 2. value = direct identifier (for last element)
                if (node.value?.current && node.value?.next) {
                    const currentPart = this.getFullPath(node.value.current);
                    if (currentPart) parts.push(currentPart);
                    extractNext(node.value.next);
                } else if (node.value) {
                    const part = this.getFullPath(node.value);
                    if (part) parts.push(part);
                }
            }
            // If it's a raw value object with current/next structure
            else if (node.current && node.next) {
                const currentPart = this.getFullPath(node.current);
                if (currentPart) parts.push(currentPart);
                extractNext(node.next);
            }
            // If it's a direct value (ODataIdentifier or similar)
            else {
                const part = this.getFullPath(node);
                if (part) parts.push(part);
            }
        };

        extractNext(pathValue.next);

        return parts.length > 0 ? parts.join('.') : null;
    }

    // Helper to build backtick-wrapped AS clause for nested objects
    // Converts foo.bar to `foo`.`bar` for SurrealDB nested object creation
    private buildBacktickWrappedAsClause(dotPath: string): string {
        return dotPath.split('.').map(part => `\`${part.replace(/`/g, '\\`')}\``).join('.');
    }

    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            // Check if the full path (including dot notation) matches a field alias
            const fullPath = this.getFullPath(node);
            if (fullPath && this.options.fieldAliases?.[fullPath]) {
                this[target] += this.options.fieldAliases[fullPath];
                return;
            }

            this.Visit(node.value.current, context);
            const isCollectionPath = node.value.next.type === Lexer.TokenType.CollectionPathExpression;
            const isDotPath = node.value.next.type === Lexer.TokenType.SinglePathExpression;
            if (!isCollectionPath && !isDotPath) {
                this[target] += "->";
            }
            else if (isDotPath) {
                this[target] += ".";
            }
            this.Visit(node.value.next, context);
        }
        else this.Visit(node.value, context);
    }

    protected VisitSinglePathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // Handle dot path expressions (field.subfield or `field`.`subfield`)
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            this[target] += ".";
            this.Visit(node.value.next, context);
        }
        else {
            this.Visit(node.value, context);
        }
    }

    protected VisitComplexProperty(node: Lexer.Token, context: any) {
        // ComplexProperty contains an odataIdentifier - visit it to render the field
        if (node.value?.name) {
            // Treat as ODataIdentifier for field rendering
            const fieldName = node.value.name;
            const target = context?.target || 'where';
            const aliasedField = this.options.fieldAliases?.[fieldName];

            if (aliasedField) {
                this[target] += aliasedField;
            } else {
                const fieldSeed = `$field${this.fieldSeed++}`;
                this.parameters.set(fieldSeed, fieldName);
                this[target] += `type::field(${fieldSeed})`;
            }
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitSelectPath(node: Lexer.Token, context: any) {
        // SelectPath.value may contain a ComplexProperty or nested structure
        if (node.value?.name) {
            // Direct property name - treat as field
            const fieldName = node.value.name;
            const target = context?.target || 'where';
            const aliasedField = this.options.fieldAliases?.[fieldName];

            if (aliasedField) {
                this[target] += aliasedField;
            } else {
                const fieldSeed = `$field${this.fieldSeed++}`;
                this.parameters.set(fieldSeed, fieldName);
                this[target] += `type::field(${fieldSeed})`;
            }
        } else if (node.value) {
            // Nested structure - visit recursively
            this.Visit(node.value, context);
        }
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

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];

        switch (method) {
            case "contains":
                // Use SurrealDB's native CONTAINS operator
                this.Visit(params[0], context);
                this[target] += ' CONTAINS ';
                // Check if it's a literal that needs special handling
                if (params[1].type === Lexer.TokenType.Literal) {
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    const literalValue = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, literalValue);
                    if (params[1].value === 'Edm.RecordId') {
                        this[target] += `type::record(${name})`;
                    } else if (params[1].value === 'Edm.String') {
                        this[target] += `type::string(${name})`;
                    } else {
                        this[target] += name;
                    }
                } else {
                    this.Visit(params[1], context);
                }
                break;
            case "endswith":
                this[target] += 'string::ends_with(';
                this.Visit(params[0], context);
                this[target] += ', ';
                // Check if it's a literal that needs special handling
                if (params[1].type === Lexer.TokenType.Literal) {
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    const literalValue = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, literalValue);
                    if (params[1].value === 'Edm.RecordId') {
                        this[target] += `type::record(${name})`;
                    } else {
                        this[target] += `type::string(${name})`;
                    }
                } else {
                    this.Visit(params[1], context);
                }
                this[target] += ')';
                break;
            case "startswith":
                this[target] += 'string::starts_with(';
                this.Visit(params[0], context);
                this[target] += ', ';
                // Check if it's a literal that needs special handling
                if (params[1].type === Lexer.TokenType.Literal) {
                    this.checkParameterLimit();
                    const name = `$param${this.parameterSeed++}`;
                    const literalValue = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, literalValue);
                    if (params[1].value === 'Edm.RecordId') {
                        this[target] += `type::record(${name})`;
                    } else {
                        this[target] += `type::string(${name})`;
                    }
                } else {
                    this.Visit(params[1], context);
                }
                this[target] += ')';
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
