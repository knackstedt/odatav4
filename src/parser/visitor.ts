import Lexer from './lexer';
import { Literal } from "./literal";
import { SqlOptions } from "./main";
import { ODataV4ParseError } from './utils';

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
    format: string;
    skipToken: string;
    search: string;
    specificId: string;

    navigationProperty: string;
    includes: Visitor[] = [];
    parameters = new Map<string, any>();
    protected parameterSeed: number = 0;
    protected fieldSeed: number = 0;
    protected selectSeed: number = 0;
    protected originalWhere: string;
    ast: Lexer.Token;

    constructor(options = <SqlOptions>{}) {
        this.options = options;
        if (this.options.useParameters != false) this.options.useParameters = true;
        this.type = options.type || SQLLang.ANSI;

        // SurrealDB handles p0 unusually, so we start at 1?
        if (this.type == SQLLang.SurrealDB) {
            this.parameterSeed = 1;
            this.fieldSeed = 1;
        }
    }

    getBaseQuery(table: string) {
        switch (this.options.type) {
            case SQLLang.SurrealDB: {
                this.parameters.set("table", table);
                // TODO: type::fields
                return `SELECT ${this.select} FROM type::table($table) WHERE ${this.where} ORDER BY ${this.orderby}`;
            }
            case SQLLang.Oracle:
            case SQLLang.MsSql:
            case SQLLang.MySql:
            case SQLLang.PostgreSql:
            case SQLLang.ANSI:
            default:
                `SELECT ${this.select} FROM [${table}] WHERE ${this.where} ORDER BY ${this.orderby}`
        }
    }

    from(table: string) {
        let sql = this.getBaseQuery(table);

        // Ensure that skip and limit are either undefined or are numbers.
        // TODO: Should we have special handling for 0 / -1?
        if (this.limit && typeof this.limit != "number") {
            throw new ODataV4ParseError({ msg: "Pagination property $limit is malformed." });
        }
        if (this.skip && typeof this.skip != "number") {
            throw new ODataV4ParseError({ msg: "Pagination property $skip is malformed." });
        }

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
        this.originalWhere = this.where;
        this.includes.forEach((item) => item.asSurrealDb());

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

        // Why is this needed?
        if (node == this.ast) {
            this.select ||= `*`;
            this.where ||= "1 = 1";
            this.orderby ||= "1";
        }
        return this;
    }

    protected VisitODataUri(node: Lexer.Token, context: any) {
        this.Visit(node.value.resource, context);
        this.Visit(node.value.query, context);
    }

    protected VisitExpand(node: Lexer.Token, context: any) {
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

    protected VisitExpandItem(node: Lexer.Token, context: any) {
        this.Visit(node.value.path, context);
        if (node.value.options) node.value.options.forEach((item) => this.Visit(item, context));
    }

    protected VisitExpandPath(node: Lexer.Token, context: any) {
        this.navigationProperty = node.raw;
    }

    protected VisitQueryOptions(node: Lexer.Token, context: any) {
        node.value.options.forEach((option) => {
            // Create a fresh context for each option to prevent one option from affecting others
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
        // TODO: this is a placeholder implementation -- it is broken.
        this.search = node.value.value;

        // VisitSearchAndExpression;
        // VisitSearchOrExpression;
        // VisitSearchNotExpression;
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
        this.skip = +node.value.raw;
    }

    protected VisitTop(node: Lexer.Token, context: any) {
        this.limit = +node.value.raw;
    }

    protected VisitSelect(node: Lexer.Token, context: any) {
        context.target = "select";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.select += ", ";
        });
    }

    protected VisitSelectItem(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            const fieldSeed = `$select${this.selectSeed++}`;
            this.parameters.set(fieldSeed, node.raw);
            this.select += `type::field(${fieldSeed})`;
        }
        else {
            let item = node.raw.replace(/\//g, '.');
            this.select += `[${item}]`;
        }
    }

    protected VisitAndExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            this.where += "(";
            this.Visit(node.value.left, context);
            this.where += " && ";
            this.Visit(node.value.right, context);
            this.where += ")";
        }
        else {
            this.Visit(node.value.left, context);
            this.where += " AND ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitOrExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            this.where += "(";
            this.Visit(node.value.left, context);
            this.where += " || ";
            this.Visit(node.value.right, context);
            this.where += ")";
        }
        else {
            this.Visit(node.value.left, context);
            this.where += " OR ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitNotExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.type == SQLLang.SurrealDB) {
            this[target] += "!("
            this.Visit(node.value, context);
            this[target] += ")";
        }
        else {
            this.Visit(node.value.right, context);
        }
    }

    protected VisitInExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this.where += " in [";

            const items = [];
            for (let i = 0; i < node.value.right.values.length; i++) {
                const item = node.value.right.values[i];

                // this.VisitLiteral(node.value.right.values[i], context);
                const value = Literal.convert(item.value, item.raw);

                const seed = `$param${this.parameterSeed++}`;
                this.parameters.set(seed, value);
                items.push(seed);

                if (typeof value == "string" && /(?<=[^\\]|^):/.test(value)) {
                    // We will optionally handle SurrealDB IDs here.
                    // This emits both the string value and the record type.
                    // e.g. field IN ['scan:01K7HT1EMX3EYE19M1MGQ36D7K', type::record('scan:01K7HT1EMX3EYE19M1MGQ36D7K')]
                    items.push(`type::record(${seed})`);
                }
            }
            this.where += items.join(", ");

            this.where += "]";
        }
    }

    protected VisitBoolParenExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitParenExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitAddExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';

        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this[target] += " + ";
            this.Visit(node.value.right, context);
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " + ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitSubExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';

        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this[target] += " - ";
            this.Visit(node.value.right, context);
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " - ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitMulExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';

        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this[target] += " * ";
            this.Visit(node.value.right, context);
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " * ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitDivExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';

        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this[target] += " / ";
            this.Visit(node.value.right, context);
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " / ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitModExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';

        if (this.type == SQLLang.SurrealDB) {
            this.Visit(node.value.left, context);
            this[target] += " % ";
            this.Visit(node.value.right, context);
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " % ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitCommonExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitFirstMemberExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitMemberExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            if (this.type == SQLLang.SurrealDB) {
                // This is assumed to always be a graph relationship navigation.
                this[target] += "->";
            }
            else {
                context.identifier += ".";
            }

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
        if (this.type == SQLLang.SurrealDB) {
            // In Surreal 2.x, orderby does not support parameterization of field names.
            if (context.target == 'orderby') {
                // TODO: Handle navigation properties?
                // For now, we will panic if there are any non basic ASCII chars.
                if (/[^A-Za-z0-9_\-]/.test(node.value.name)) {
                    throw new ODataV4ParseError({ msg: `Cannot use non-basic ASCII characters in ORDER BY clauses for SurrealDB. This is a safety limiter for the query language that is resolved in Surreal 3.x.` });
                }
                this[context.target] += node.value.name;
            }
            else {
                const fieldSeed = `$field${this.fieldSeed++}`;
                this.parameters.set(fieldSeed, node.value.name);
                this[context.target] += `type::field(${fieldSeed})`;
            }
        }
        else {
            this[context.target] += `[${node.value.name}]`;
        }
        context.identifier = node.value.name;
    }

    protected VisitEqualsExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            // TODO: This exists to handle surrealDB strings as IDs
            // but it probably needs reworked from the ground-up.
            // TODO: This doesn't work for the string on the left side!
            if (
                node.value.right.type == Lexer.TokenType.Literal &&
                node.value.right.value == "Edm.String" &&
                /(?<=[^\\]|^):/.test(node.value.right.raw)
            ) {
                // We will optionally handle SurrealDB IDs here.
                // This emits an equals expression that checks both the string value and the record type.
                // e.g. (field = 'scan:01K7HT1EMX3EYE19M1MGQ36D7K' || field = type::record('scan:01K7HT1EMX3EYE19M1MGQ36D7K'))
                this.where += "((";
                this.Visit(node.value.left, context);
                this.where += " = ";
                this.Visit(node.value.right, context);
                this.where += ") || (";
                const where = this.where;
                const p = this.where.length;

                this.where = '';
                this.Visit(node.value.left, context);
                this.where += "```";
                this.Visit(node.value.right, context);

                const [ field, literal ] = this.where.split("```");

                this.where = where;

                this.where += "string::is_record(";
                this.where += literal;
                this.where += ") AND ";
                this.where += field;
                this.where += " = type::record(";
                this.where += literal;
                this.where += ")))";
            }
            else {
                // this isn't possibly a SurrealDB ID, so do normal equals handling.
                this.Visit(node.value.left, context);
                this.where += " = ";
                this.Visit(node.value.right, context);
            }
        }
        else {
            this.Visit(node.value.left, context);
            this.where += " = ";
            this.Visit(node.value.right, context);

            // FIX: This is a hack.
            if (this.options.useParameters && context.literal == null) {
                this.where = this.where.replace(/= \$literal\d+$/, "IS NULL")
                    .replace(new RegExp(`\\? = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
            }
            else if (context.literal == "NULL") {
                this.where = this.where.replace(/= NULL$/, "IS NULL")
                    .replace(new RegExp(`NULL = \\[${context.identifier}\\]$`), `[${context.identifier}] IS NULL`);
            }
        }
    }

    protected VisitNotEqualsExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += this.type == SQLLang.SurrealDB ? " != " : " <> ";
        this.Visit(node.value.right, context);

        if (this.type != SQLLang.SurrealDB) {
            // FIX: This is a hack.
            if (this.options.useParameters && context.literal == null) {
                this.where = this.where.replace(/(?:<>|!=) \$literal\d+$/, "IS NOT NULL")
                    .replace(new RegExp(`\\? (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
            }
            else if (context.literal == "NULL") {
                this.where = this.where.replace(/(?:<>|!=) NULL$/, "IS NOT NULL")
                    .replace(new RegExp(`NULL (?:<>|!=) \\[${context.identifier}\\]$`), `[${context.identifier}] IS NOT NULL`);
            }
        }
    }

    protected VisitLesserThanExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " < ";
        this.Visit(node.value.right, context);
    }

    protected VisitLesserOrEqualsExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " <= ";
        this.Visit(node.value.right, context);
    }

    protected VisitGreaterThanExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " > ";
        this.Visit(node.value.right, context);
    }

    protected VisitGreaterOrEqualsExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value.left, context);
        this.where += " >= ";
        this.Visit(node.value.right, context);
    }

    protected VisitLiteral(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.options.useParameters) {
            let name = `$literal${this.parameterSeed++}`;
            let value = Literal.convert(node.value, node.raw);

            context.literal = value;
            this.parameters.set(name, value);
            this[target] += name;
        }
        else this[target] += (context.literal = SQLLiteral.convert(node.value, node.raw));
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];
        let fn: string;
        const name = `$param${this.parameterSeed++}`;

        switch (method) {
            case "contains":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += 'string::contains(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, value);
                    this[target] += `, type::string(${name}))`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `%${value}%`);
                        this[target] += ` LIKE ${name}`;
                    }
                    else this[target] += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
                }
                break;
            case "endswith":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += 'string::ends_with(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, value);
                    this[target] += `, type::string(${name}))`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `%${value}`);
                        this[target] += ` LIKE ${name}`;
                    }
                    else this[target] += ` LIKE '%${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}'`;
                }

                break;
            case "startswith":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += 'string::starts_with(';
                    this.Visit(params[0], context);

                    let value = Literal.convert(params[1].value, params[1].raw);
                    this.parameters.set(name, value);
                    this[target] += `, type::string(${name}))`;
                }
                else {
                    this.Visit(params[0], context);
                    if (this.options.useParameters) {
                        let value = Literal.convert(params[1].value, params[1].raw);
                        this.parameters.set(name, `${value}%`);
                        this[target] += ` LIKE ${name}`;
                    }
                    else this[target] += ` LIKE '${SQLLiteral.convert(params[1].value, params[1].raw).slice(1, -1)}%'`;
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
                this[target] += `${fn}(`;
                this.Visit(params[0], context);
                this[target] += ', ';
                this.Visit(params[1], context);
                this[target] += ") - 1";
                break;
            case "round":
                this[target] += this.type == SQLLang.SurrealDB ? "math::round(" : "ROUND(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "length":
                this[target] += this.type == SQLLang.SurrealDB ? "string::len(" : "LEN(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "tolower":
                this[target] += this.type == SQLLang.SurrealDB ? "string::lowercase(" : "LCASE(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "toupper":
                this[target] += this.type == SQLLang.SurrealDB ? "string::uppercase(" : "UCASE(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "floor":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += `math::floor(`;
                    this.Visit(params[0], context);
                    this[target] += ")";
                }
            case "ceiling":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += `math::ceil(`
                    this.Visit(params[0], context);
                    this[target] += ")";
                }
            case "year":
            case "month":
            case "day":
            case "hour":
            case "minute":
            case "second":
                this[target] += this.type == SQLLang.SurrealDB
                    ? `time::${method}(`
                    : `${method.toUpperCase()}(`;
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "now":
                this[target] += this.type == SQLLang.SurrealDB
                    ? "time::now()"
                    : "NOW()";
                break;
            case "trim":
                this[target] += this.type == SQLLang.SurrealDB
                    ? "string::trim("
                    : "TRIM(' ' FROM ";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
        }
    }

}
