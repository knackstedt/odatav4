
import Lexer from '../lexer';
import { Literal } from "../literal";
import { ODataV4ParseError } from '../utils';
import { SQLLiteral } from './sql-literal';
import { SQLLang, type SqlOptions } from './types';

export class Visitor {
    readonly options: SqlOptions;
    readonly type: SQLLang;

    select = "";
    where = "";
    orderby = "";
    groupby = "";
    skip: number;
    limit: number;
    inlinecount: boolean;
    format: string;
    skipToken: string;
    search: string;
    specificId: string;

    navigationProperty: string;
    includes: Visitor[] = [];
    parameters: Map<string, any> = new Map();

    ast: Lexer.Token;

    originalWhere: string;

    parameterSeed = 1;
    protected selectSeed = 0;
    protected fieldSeed = 1;

    protected expandDepth = 0;
    protected expandCounter = { count: 0 }; // Shared counter object

    constructor(options = <SqlOptions>{}, ast: Lexer.Token) {
        this.options = {
            useParameters: false,
            type: SQLLang.ANSI,
            ...options
        };
        this.type = this.options.type;
    }

    protected getFetchPaths(includes: Visitor[], parentPath: string = ""): string[] {
        let fetchPaths: string[] = [];

        for (const include of includes) {
            const currentPath = parentPath ? `${parentPath}.${include.navigationProperty}` : include.navigationProperty;

            // If the include has its own includes, recurse
            if (include.includes && include.includes.length > 0) {
                fetchPaths = fetchPaths.concat(this.getFetchPaths(include.includes, currentPath));
            } else {
                fetchPaths.push(currentPath);
            }
        }
        return fetchPaths;
    }

    /**
     * Override this method to return the AST for the base query for a table.
     * @param table
     * @returns
     */
    from(table: string) {
        let sql = `SELECT ${this.select} FROM ${table} WHERE ${this.where}`;
        if (this.orderby) sql += ` ORDER BY ${this.orderby}`;
        if (this.limit) sql += ` LIMIT ${this.limit}`;
        if (this.skip) sql += ` OFFSET ${this.skip}`;
        return sql;
    }

    /**
     *
     * @deprecated this method does nothing.
     */
    asType() {
        return this;
    }

    Visit(node: Lexer.Token, context?: any) {
        this.ast = this.ast || node;
        context = context || { target: "where" };
        if (node) {
            const visitor = this[`Visit${node.type}`];
            if (!visitor) {
                throw new ODataV4ParseError({ msg: `Unhandled node type: ${node.type}`, props: { node } });
            }
            visitor.call(this, node, context);
        }

        if (node == this.ast) {
            this.select ||= `*`;
            this.where ||= "1 = 1";
            this.orderby ||= "1";
            this.groupby ||= "";
        }
        return this;
    }

    protected VisitODataUri(node: Lexer.Token, context: any) {
        this.Visit(node.value.resource, context);
        this.Visit(node.value.query, context);
    }

    protected VisitComparisonExpression(node: Lexer.Token, context: any, operator: string) {
        this.Visit(node.value.left, context);
        this.where += operator == "!=" ? " <> " : ` ${operator} `;
        this.Visit(node.value.right, context);
    }

    protected VisitExpand(node: Lexer.Token, context: any) {
        const maxDepth = this.options.maxExpandDepth ?? 5;
        const maxCount = this.options.maxExpandCount ?? 10;

        if (this.expandDepth >= maxDepth) {
            throw new ODataV4ParseError({ msg: `Maximum expansion depth of ${maxDepth} exceeded.` });
        }

        node.value.items.forEach((item) => {
            this.expandCounter.count++;
            if (this.expandCounter.count > maxCount) {
                throw new ODataV4ParseError({ msg: `Maximum expansion count of ${maxCount} exceeded.` });
            }

            let expandPath = item.value.path.raw;
            let visitor = this.includes.filter(v => v.navigationProperty == expandPath)[0];
            if (!visitor) {
                // Must construct the same type of visitor
                visitor = new (this.constructor as any)(this.options);
                visitor.parameterSeed = this.parameterSeed;
                visitor.expandDepth = this.expandDepth + 1;
                visitor.expandCounter = this.expandCounter;
                this.includes.push(visitor);
            }
            visitor.Visit(item);
            this.parameterSeed = visitor.parameterSeed;
        });
    }

    protected VisitExpandItem(node: Lexer.Token, context: any) {
        this.Visit(node.value.path, context);
        if (node.value.options) node.value.options.forEach((item) => this.Visit(item, context));
    }

    protected VisitExpandPath(node: Lexer.Token, context: any) {
        this.navigationProperty = node.raw;
    }

    protected VisitQueryOptions(node: Lexer.Token, context: any) {
        node.value.options.forEach((option) => {
            const optionContext = { ...context };
            this.Visit(option, optionContext);
        });
    }

    protected VisitInlineCount(node: Lexer.Token, context: any) {
        this.inlinecount = Literal.convert(node.value.value, node.value.raw);
    }

    protected VisitFilter(node: Lexer.Token, context: any) {
        context.target = "where";
        this.Visit(node.value, context);
        this.where ||= "1 = 1";
    }

    protected VisitFormat(node: Lexer.Token, context: any) {
        this.format = node.value.format;
    }

    protected VisitSkipToken(node: Lexer.Token, context: any) {
        this.skipToken = node.value;
    }

    protected VisitSearch(node: Lexer.Token, context: any) {
        if (!this.options.enableSearch) {
            throw new ODataV4ParseError({
                msg: "$search is disabled."
            });
        }
        this.search = node.value.value;
    }

    protected VisitId(node: Lexer.Token, context: any) {
        this.specificId = node.value;
    }

    protected VisitOrderBy(node: Lexer.Token, context: any) {
        context.target = "orderby";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.orderby += ", ";
        });
    }

    protected VisitOrderByItem(node: Lexer.Token, context: any) {
        this.Visit(node.value.expr, context);
        this.orderby += node.value.direction > 0 ? " ASC" : " DESC";
    }

    protected VisitSkip(node: Lexer.Token, context: any) {
        const value = +node.value.raw;
        if (value < 0) {
            throw new ODataV4ParseError({ msg: "The $skip query option must be a non-negative integer." });
        }
        const maxSkip = this.options.maxSkip ?? 1000000;
        if (value > maxSkip) {
            throw new ODataV4ParseError({ msg: `The $skip value must not exceed ${maxSkip}.` });
        }
        this.skip = value;
    }

    protected VisitTop(node: Lexer.Token, context: any) {
        const value = +node.value.raw;
        const maxPageSize = this.options.maxPageSize ?? 500;
        if (value > maxPageSize) {
            throw new ODataV4ParseError({ msg: `The $top value must not exceed ${maxPageSize}.` });
        }
        this.limit = value;
    }

    protected VisitGroupBy(node: Lexer.Token, context: any) {
        context.target = "groupby";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.groupby += ", ";
        });
    }

    protected VisitGroupByItem(node: Lexer.Token, context: any) {
        this.groupby += `[${node.value.expr.raw}]`;
    }

    protected VisitSelect(node: Lexer.Token, context: any) {
        context.target = "select";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.select += ", ";
        });
    }

    protected VisitSelectItem(node: Lexer.Token, context: any) {
        if (node.raw === '*') {
            this.select += '*';
            return;
        }
        let item = node.raw.replace(/\//g, '.');
        this.select += `[${item}]`;
    }

    protected VisitAndExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " AND ";
        this.Visit(node.value.right, context);
    }

    protected VisitOrExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " OR ";
        this.Visit(node.value.right, context);
    }

    protected VisitNotExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitInExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " IN (";

        const items = [];
        for (let i = 0; i < node.value.right.values.length; i++) {
            const item = node.value.right.values[i];
            const value = Literal.convert(item.value, item.raw);

            if (this.options.useParameters) {
                this.checkParameterLimit();
                const seed = `$param${this.parameterSeed++}`;
                this.parameters.set(seed, value);
                items.push(seed);
            } else {
                items.push(SQLLiteral.convert(item.value, item.raw));
            }
        }
        this.where += items.join(", ");
        this.where += ")";
    }

    protected VisitBoolParenExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitNegateExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "-(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitHasExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Operator 'has' not implemented for this SQL dialect.` });
    }

    protected VisitIsOfExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Function 'isof' not implemented for this SQL dialect.` });
    }

    protected VisitCastExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Function 'cast' not implemented for this SQL dialect.` });
    }

    protected VisitParenExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitAddExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " + ";
        this.Visit(node.value.right, context);
    }

    protected VisitSubExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " - ";
        this.Visit(node.value.right, context);
    }

    protected VisitMulExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " * ";
        this.Visit(node.value.right, context);
    }

    protected VisitDivExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " / ";
        this.Visit(node.value.right, context);
    }

    protected VisitModExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this.Visit(node.value.left, context);
        this[target] += " % ";
        this.Visit(node.value.right, context);
    }

    protected VisitCommonExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitFirstMemberExpression(node: Lexer.Token, context: any) {
        if (Array.isArray(node.value)) {
            const [first, second] = node.value;
            this.Visit(first, context);
            const target = context?.target || 'where';
            this[target] += ".";
            this.Visit(second, context);
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitMemberExpression(node: Lexer.Token, context: any) {
        if (node.value.name && node.value.value) {
            this.Visit(node.value.name, context);
            const target = context?.target || 'where';
            this[target] += ".";
            this.Visit(node.value.value, context);
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            context.identifier += ".";
            this.Visit(node.value.next, context);
        }
        else this.Visit(node.value, context);
    }

    protected VisitSingleNavigationExpression(node: Lexer.Token, context: any) {
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            this.Visit(node.value.next, context);
        }
        else this.Visit(node.value, context);
    }

    protected VisitODataIdentifier(node: Lexer.Token, context: any) {
        this[context.target] += `[${node.value.name}]`;
        context.identifier = node.value.name;
    }

    protected VisitEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "=");
        if (this.options.useParameters && context.literal == null) {
            this.where = this.where.replace(/= \$literal\d+$/, "IS NULL")
                .replace(new RegExp(`\\? = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
        }
        else if (context.literal == "NULL") {
            this.where = this.where.replace(/= NULL$/, "IS NULL")
                .replace(new RegExp(`NULL = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
        }
    }

    protected VisitNotEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "!=");
        if (this.options.useParameters && context.literal == null) {
            this.where = this.where.replace(/(?:<>|!=) \$literal\d+$/, "IS NOT NULL")
                .replace(new RegExp(`\\? (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
        }
        else if (context.literal == "NULL") {
            this.where = this.where.replace(/(?:<>|!=) NULL$/, "IS NOT NULL")
                .replace(new RegExp(`NULL (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
        }
    }

    protected VisitLesserThanExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "<");
    }

    protected VisitLesserOrEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, "<=");
    }

    protected VisitGreaterThanExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, ">");
    }

    protected VisitGreaterOrEqualsExpression(node: Lexer.Token, context: any) {
        this.VisitComparisonExpression(node, context, ">=");
    }

    protected VisitLiteral(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.options.useParameters) {
            this.checkParameterLimit();
            let name = `$literal${this.parameterSeed++}`;
            let value = Literal.convert(node.value, node.raw);
            context.literal = value;
            this.parameters.set(name, value);
            this[target] += name;
        }
        else this[target] += (context.literal = SQLLiteral.convert(node.value, node.raw));
    }

    protected VisitCollectionPathExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitAnyExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Lambda 'any' not implemented for this SQL dialect.` });
    }

    protected VisitAllExpression(node: Lexer.Token, context: any) {
        throw new ODataV4ParseError({ msg: `Lambda 'all' not implemented for this SQL dialect.` });
    }

    protected VisitLambdaVariableExpression(node: Lexer.Token, context: any) {
        // Implement in specific dialects if needed
    }

    protected VisitLambdaPredicateExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitImplicitVariableExpression(node: Lexer.Token, context: any) {
        // Implement in specific dialects if needed
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];
        this.checkParameterLimit();
        const name = `$param${this.parameterSeed++}`;

        switch (method) {
            case "contains":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, `%${value}%`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
                break;
            case "endswith":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, `%${value}`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}'`;
                break;
            case "startswith":
                this.Visit(params[0], context);
                if (this.options.useParameters) {
                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, `${value}%`);
                    this[target] += ` LIKE ${name}`;
                }
                else this[target] += ` LIKE '${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
                break;
            case "indexof":
                this[target] += `(LOCATE(`;
                this.Visit(params[1], context);
                this[target] += ", ";
                this.Visit(params[0], context);
                this[target] += `) - 1)`;
                break;
            case "round":
                this[target] += "ROUND(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "length":
                this[target] += "LEN(";
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
            case "floor":
            case "ceiling":
            case "year":
            case "month":
            case "day":
            case "hour":
            case "minute":
            case "second":
                this[target] += `${method.toUpperCase()}(`;
                this.Visit(params[0], context);
                this[target] += ")";
                break;

            case "now":
                this[target] += "NOW()";
                break;

            case "trim":
                this[target] += "TRIM(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
        }
    }

    protected isId(p: any): boolean {
        return p && (p.type === Lexer.TokenType.Id || p.type === 'Id');
    }

    protected checkParameterLimit() {
        const limit = this.options.maxParameters || 1000;
        if (this.parameters.size > limit) {
            throw new ODataV4ParseError({ msg: `Maximum parameter limit of ${limit} exceeded.` });
        }
    }
}
