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

        const isRightLiteral = right && (right.type == Lexer.TokenType.Literal || (right.type as any) == "Literal");
        const isRightPotentialId = isRightLiteral && (
            (right.value == "Edm.String" && /(?<=[^\\]|^):/.test(right.raw)) ||
            (typeof right.value == "string" && (right.value as string).startsWith("Edm.Int")) ||
            (typeof right.value == "string" && ["Edm.SByte", "Edm.Byte", "Edm.Decimal", "Edm.Double", "Edm.Single"].includes(right.value as string)) ||
            typeof right.value == "number"
        );
        const isLeftLiteral = left && (left.type == Lexer.TokenType.Literal || (left.type as any) == "Literal");
        const isLeftPotentialId = isLeftLiteral && (
            (left.value == "Edm.String" && /(?<=[^\\]|^):/.test(left.raw)) ||
            (typeof left.value == "string" && (left.value as string).startsWith("Edm.Int")) ||
            (typeof left.value == "string" && ["Edm.SByte", "Edm.Byte", "Edm.Decimal", "Edm.Double", "Edm.Single"].includes(left.value as string)) ||
            typeof left.value == "number"
        );

        if (isLeftPotentialId || isRightPotentialId) {
            const where = this.where;
            this.where = '';
            this.Visit(left, context);
            const leftStr = this.where;

            this.where = '';
            this.Visit(right, context);
            const rightStr = this.where;

            this.where = where;

            if (isLeftPotentialId) {
                if (operator == "=" || operator == "!=") {
                    if (operator == "=") {
                        this.where += `((${leftStr} = ${rightStr}) || (string::is_record(type::string(${leftStr})) && (type::field(${leftStr}) = type::string(${rightStr}))))`;
                    }
                    else {
                        this.where += `! ((${leftStr} = ${rightStr}) || (string::is_record(type::string(${leftStr})) && (type::field(${leftStr}) = type::string(${rightStr}))))`;
                    }
                    return;
                }
                else {
                    // Range comparison for IDs
                    // Only compare the numeric part if it's a record.
                    // Otherwise, compare the raw field.
                    this.where += `((string::is_record(type::string(${leftStr})) && type::number(string::split(type::string(${leftStr}), ":")[1]) ${operator} ${rightStr}) || (!string::is_record(type::string(${leftStr})) && ${leftStr} ${operator} ${rightStr}))`;
                    return;
                }

            }
            else if (isRightPotentialId) {
                if (operator == "=" || operator == "!=") {
                    if (operator == "=") {
                        this.where += `((${rightStr} = ${leftStr}) || (string::is_record(type::string(${rightStr})) && (type::field(${rightStr}) = type::string(${leftStr}))))`;
                    }
                    else {
                        this.where += `! ((${rightStr} = ${leftStr}) || (string::is_record(type::string(${rightStr})) && (type::field(${rightStr}) = type::string(${leftStr}))))`;
                    }
                    return;
                }
                else {
                    // Range comparison for IDs
                    // Only compare the numeric part if it's a record.
                    // Otherwise, compare the raw field.
                    this.where += `((string::is_record(type::string(${rightStr})) && type::number(string::split(type::string(${rightStr}), ":")[1]) ${operator} ${leftStr}) || (!string::is_record(type::string(${rightStr})) && ${rightStr} ${operator} ${leftStr}))`;
                    return;
                }
            }
        }

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
        if (context.target == 'orderby') {
            this[context.target] += '`' + node.value.name.replace(/`/g, '\\`') + '`';
        }
        else {
            const fieldSeed = `$field${this.fieldSeed++}`;
            this.parameters.set(fieldSeed, node.value.name);
            this[context.target] += `type::field(${fieldSeed})`;
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

            if (node.value === 'Edm.GeographyPoint') {
                const match = node.raw.match(/'Point\(([^)]+)\)'/);
                if (match) {
                    const [x, y] = match[1].split(' ').map(Number);
                    this[target] += `(${x}, ${y})`;
                    return;
                }
            }
            if (node.value === 'Edm.GeographyPolygon') {
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
        this.checkParameterLimit();
        const name = `$param${this.parameterSeed++}`;

        switch (method) {
            case "contains":
                this[target] += 'string::contains(';
                this.Visit(params[0], context);

                let value = Literal.convert(params[1].value, params[1].raw);
                this.parameters.set(name, value);
                this[target] += `, type::string(${name}))`;
                break;
            case "endswith":
                this[target] += 'string::ends_with(';
                this.Visit(params[0], context);

                let value2 = Literal.convert(params[1].value, params[1].raw);
                this.parameters.set(name, value2);
                this[target] += `, type::string(${name}))`;
                break;
            case "startswith":
                this[target] += 'string::starts_with(';
                this.Visit(params[0], context);

                let value3 = Literal.convert(params[1].value, params[1].raw);
                this.parameters.set(name, value3);
                this[target] += `, type::string(${name}))`;
                break;
            case "indexof":
                this[target] += "(IF string::contains(type::string(";
                this.Visit(params[0], context);
                this[target] += "), type::string(";
                this.Visit(params[1], context);
                this[target] += ")) THEN string::len(string::split(type::string(";
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
