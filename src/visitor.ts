import { Token } from "./parser/lexer";
import { Literal } from "./literal";
import { SqlOptions } from "./main";

export class SQLLiteral extends Literal {
    static convert(type: string, value: string): any {
        return (new SQLLiteral(type, value)).valueOf();
    }
    'Edm.String'(value: string) { return "'" + decodeURIComponent(value).slice(1, -1).replace(/''/g, "'") + "'"; }
    'Edm.Guid'(value: string) { return "'" + decodeURIComponent(value) + "'"; }
    'Edm.Date'(value: string) { return "'" + value + "'"; }
    'Edm.DateTimeOffset'(value: string): any { return "'" + value.replace("T", " ").replace("Z", " ").trim() + "'"; }
    'Edm.Boolean'(value: string): any {
        value = value || '';
        switch (value.toLowerCase()) {
            case 'true': return 1;
            case 'false': return 0;
            default: return "NULL";
        }
    }
    'null'(value: string) { return "NULL"; }
}

export enum SQLLang {
    ANSI,
    MsSql,
    MySql,
    PostgreSql,
    Oracle,
    SurrealDB
}

export class Visitor {
    protected options: SqlOptions;
    type: SQLLang;
    select = "";
    where = "";
    orderby = "";
    skip: number;
    limit: number;
    inlinecount: boolean;
    navigationProperty: string;
    includes: Visitor[] = [];
    parameters: any = new Map();
    protected parameterSeed: number = 0;
    protected originalWhere: string;
    ast: Token;

    constructor(options = <SqlOptions>{}) {
        this.options = options;
        if (this.options.useParameters != false) this.options.useParameters = true;
        this.type = options.type || SQLLang.ANSI;

        // SurrealDB handles p0 unusually, so we start at 1.
        if (this.type == SQLLang.SurrealDB)
            this.parameterSeed = 1;
    }

    from(table: string) {
        let sql = `SELECT ${this.select} FROM [${table}] WHERE ${this.where} ORDER BY ${this.orderby}`;
        switch (this.type) {
            case SQLLang.Oracle:
            case SQLLang.MsSql:
                if (typeof this.skip == "number") sql += ` OFFSET ${this.skip} ROWS`;
                if (typeof this.limit == "number") {
                    if (typeof this.skip != "number") sql += " OFFSET 0 ROWS";
                    sql += ` FETCH NEXT ${this.limit} ROWS ONLY`;
                }
                break;
            case SQLLang.SurrealDB:
                if (typeof this.limit == "number") sql += ` LIMIT ${this.limit}`;
                if (typeof this.skip == "number") sql += ` START ${this.skip}`;
                break;
            case SQLLang.MySql:
            case SQLLang.PostgreSql:
            default:
                if (typeof this.limit == "number") sql += ` LIMIT ${this.limit}`;
                if (typeof this.skip == "number") sql += ` OFFSET ${this.skip}`;
                break;
        }
        return sql;
    }

    asMsSql() {
        this.type = SQLLang.MsSql;
        let rx = new RegExp("\\?", "g");
        let keys = this.parameters.keys();
        this.originalWhere = this.where;
        this.where = this.where.replace(rx, () => `@${keys.next().value}`);
        this.includes.forEach((item) => item.asMsSql());
        return this;
    }

    asSurrealDb() {
        this.type = SQLLang.SurrealDB;
        let rx = new RegExp("\\?", "g");
        let keys = this.parameters.keys();
        this.originalWhere = this.where;
        this.where = this.where.replace(rx, () => `$${keys.next().value}`);
        this.includes.forEach((item) => item.asSurrealDb());

        // Replace square brackets with parenthesis
        // TODO: Is this truly necessary?
        this.where = this.where.replace(/[\[]/g, '(');
        this.where = this.where.replace(/[\]]/g, ')');

        return this;
    }

    asOracleSql() {
        this.type = SQLLang.Oracle;
        let rx = new RegExp("\\?", "g");
        let keys = this.parameters.keys();
        this.originalWhere = this.where;
        this.where = this.where.replace(rx, () => `:${keys.next().value}`);
        this.includes.forEach((item) => item.asOracleSql());
        return this;
    }

    asAnsiSql() {
        this.type = SQLLang.ANSI;
        this.where = this.originalWhere || this.where;
        this.includes.forEach((item) => item.asAnsiSql());
        return this;
    }

    asType() {
        switch (this.type) {
            case SQLLang.MsSql: return this.asMsSql();
            case SQLLang.ANSI:
            case SQLLang.MySql:
            case SQLLang.PostgreSql: return this.asAnsiSql();
            case SQLLang.Oracle: return this.asOracleSql();
            case SQLLang.SurrealDB: return this.asSurrealDb();
            default: return this;
        }
    }

    Visit(node: Token, context?: any) {
        this.ast = this.ast || node;
        context = context || { target: "where" };

        if (node) {
            var visitor = this[`Visit${node.type}`];
            if (visitor) visitor.call(this, node, context);
            else console.log(`Unhandled node type: ${node.type}`, node);
        }

        if (node == this.ast) {
            if (!this.select) this.select = `*`;
            if (!this.where) this.where = "1 = 1";
            if (!this.orderby) this.orderby = "1";
        }
        return this;
    }

    protected VisitODataUri(node: Token, context: any) {
        this.Visit(node.value.resource, context);
        this.Visit(node.value.query, context);
    }

    protected VisitExpand(node: Token, context: any) {
        node.value.items.forEach((item) => {
            let expandPath = item.value.path.raw;
            let visitor = this.includes.filter(v => v.navigationProperty == expandPath)[0];
            if (!visitor) {
                visitor = new Visitor(this.options);
                visitor.parameterSeed = this.parameterSeed;
                this.includes.push(visitor);
            }
            visitor.Visit(item);
            this.parameterSeed = visitor.parameterSeed;
        });
    }

    protected VisitExpandItem(node: Token, context: any) {
        this.Visit(node.value.path, context);
        if (node.value.options) node.value.options.forEach((item) => this.Visit(item, context));
    }

    protected VisitExpandPath(node: Token, context: any) {
        this.navigationProperty = node.raw;
    }

    protected VisitQueryOptions(node: Token, context: any) {
        node.value.options.forEach((option) => this.Visit(option, context));
    }

    protected VisitInlineCount(node: Token, context: any) {
        this.inlinecount = Literal.convert(node.value.value, node.value.raw);
    }

    protected VisitFilter(node: Token, context: any) {
        context.target = "where";
        this.Visit(node.value, context);
        if (!this.where) this.where = "1 = 1";
    }

    protected VisitOrderBy(node: Token, context: any) {
        context.target = "orderby";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.orderby += ", ";
        });
    }

    protected VisitOrderByItem(node: Token, context: any) {
        this.Visit(node.value.expr, context);
        this.orderby += node.value.direction > 0 ? " ASC" : " DESC";
    }

    protected VisitSkip(node: Token, context: any) {
        this.skip = +node.value.raw;
    }

    protected VisitTop(node: Token, context: any) {
        this.limit = +node.value.raw;
    }

    protected VisitSelect(node: Token, context: any) {
        context.target = "select";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.select += ", ";
        });
    }

    protected VisitSelectItem(node: Token, context: any) {
        let item = node.raw.replace(/\//g, '.');
        this.select += `[${item}]`;
    }

    protected VisitAndExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " AND ";
        this.Visit(node.value.right, context);
    }

    protected VisitOrExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " OR ";
        this.Visit(node.value.right, context);
    }

    protected VisitBoolParenExpression(node: Token, context: any) {
        this.where += "(";
        this.Visit(node.value, context);
        this.where += ")";
    }

    protected VisitCommonExpression(node: Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitFirstMemberExpression(node: Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitMemberExpression(node: Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitPropertyPathExpression(node: Token, context: any) {
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            context.identifier += ".";
            this.Visit(node.value.next, context);
        } else this.Visit(node.value, context);
    }

    protected VisitSingleNavigationExpression(node: Token, context: any) {
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            this.Visit(node.value.next, context);
        } else this.Visit(node.value, context);
    }

    protected VisitODataIdentifier(node: Token, context: any) {
        this[context.target] += `[${node.value.name}]`;
        context.identifier = node.value.name;
    }

    protected VisitEqualsExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " = ";
        this.Visit(node.value.right, context);
        if (this.options.useParameters && context.literal == null) {
            this.where = this.where.replace(/= \?$/, "IS NULL").replace(new RegExp(`\\? = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
        } else if (context.literal == "NULL") {
            this.where = this.where.replace(/= NULL$/, "IS NULL").replace(new RegExp(`NULL = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
        }
    }

    protected VisitNotEqualsExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += this.type == SQLLang.SurrealDB ? " != " : " <> ";
        this.Visit(node.value.right, context);
        if (this.options.useParameters && context.literal == null) {
            this.where = this.where.replace(/(?:<>|!=) \?$/, "IS NOT NULL").replace(new RegExp(`\\? (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
        }
        else if (context.literal == "NULL") {
            this.where = this.where.replace(/(?:<>|!=) NULL$/, "IS NOT NULL").replace(new RegExp(`NULL (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
        }
    }

    protected VisitLesserThanExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " < ";
        this.Visit(node.value.right, context);
    }

    protected VisitLesserOrEqualsExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " <= ";
        this.Visit(node.value.right, context);
    }

    protected VisitGreaterThanExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " > ";
        this.Visit(node.value.right, context);
    }

    protected VisitGreaterOrEqualsExpression(node: Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " >= ";
        this.Visit(node.value.right, context);
    }

    protected VisitLiteral(node: Token, context: any) {
        if (this.options.useParameters) {
            let name = `p${this.parameterSeed++}`;
            let value = Literal.convert(node.value, node.raw);
            context.literal = value;
            this.parameters.set(name, value);
            this.where += "?";
        } else this.where += (context.literal = SQLLiteral.convert(node.value, node.raw));
    }

    protected VisitMethodCallExpression(node: Token, context: any) {
        var method = node.value.method;
        var params = node.value.parameters || [];
        let fn: string;
        switch (method) {
            case "contains":
                if (this.type == SQLLang.SurrealDB) {
                    this.where += 'string::contains(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    let name = `p${this.parameterSeed++}`;
                    this.parameters.set(name, value);
                    this.where += ` || '', ?)`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let name = `p${this.parameterSeed++}`;
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `%${value}%`);
                        this.where += ` LIKE ?`;
                    }
                    else this.where += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
                }
                break;
            case "endswith":
                if (this.type == SQLLang.SurrealDB) {
                    this.where += 'string::endsWith(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    let name = `p${this.parameterSeed++}`;
                    this.parameters.set(name, value);
                    this.where += ` || '', ?)`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let name = `p${this.parameterSeed++}`;
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `%${value}`);
                        this.where += ` LIKE ?`;
                    }
                    else this.where += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}'`;
                }

                break;
            case "startswith":
                if (this.type == SQLLang.SurrealDB) {
                    this.where += 'string::startsWith(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    let name = `p${this.parameterSeed++}`;
                    this.parameters.set(name, value);
                    this.where += ` || '', ?)`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let name = `p${this.parameterSeed++}`;
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `${value}%`);
                        this.where += ` LIKE ?`;
                    }
                    else this.where += ` LIKE '${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
                }

                break;
            case "indexof":
                fn = "";
                switch (this.type) {
                    case SQLLang.SurrealDB:
                        fn = 'array::find_index'
                    case SQLLang.MsSql:
                        fn = "CHARINDEX";
                        break;
                    case SQLLang.ANSI:
                    case SQLLang.MySql:
                    case SQLLang.PostgreSql:
                    default:
                        fn = "INSTR";
                        break;
                }
                if (fn === "CHARINDEX") {
                    const tmp = params[0];
                    params[0] = params[1];
                    params[1] = tmp;
                }
                this.where += `${fn}(`;
                this.Visit(params[0], context);
                this.where += ', ';
                this.Visit(params[1], context);
                this.where += ") - 1";
                break;
            case "round":
                this.where += this.type == SQLLang.SurrealDB ? "math::round(" : "ROUND(";
                this.Visit(params[0], context);
                this.where += ")";
                break;
            case "length":
                this.where += this.type == SQLLang.SurrealDB ? "string::len(" : "LEN(";
                this.Visit(params[0], context);
                this.where += ")";
                break;
            case "tolower":
                this.where += this.type == SQLLang.SurrealDB ? "string::lowercase(" : "LCASE(";
                this.Visit(params[0], context);
                this.where += ")";
                break;
            case "toupper":
                this.where += this.type == SQLLang.SurrealDB ? "string::uppercase(" : "UCASE(";
                this.Visit(params[0], context);
                this.where += ")";
                break;
            case "floor":
            case "ceiling":
            case "year":
            case "month":
            case "day":
            case "hour":
            case "minute":
            case "second":
                this.where += this.type == SQLLang.SurrealDB
                    ? `time::${method}(`
                    : `${method.toUpperCase()}(`;
                this.Visit(params[0], context);
                this.where += ")";
                break;
            case "now":
                this.where += this.type == SQLLang.SurrealDB
                    ? "time::now()"
                    : "NOW()";
                break;
            case "trim":
                this.where += this.type == SQLLang.SurrealDB
                    ? "string::trim("
                    : "TRIM(' ' FROM ";
                this.Visit(params[0], context);
                this.where += ")";
                break;
        }
    }

}
