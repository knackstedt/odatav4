import Lexer from './lexer';
import { Literal } from "./literal";
import type { SqlOptions } from "./main";
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

        if (this.type == SQLLang.SurrealDB) {
            this.parameterSeed = 1;
            this.fieldSeed = 1;
        }

        // Initialize expand counter if not provided (this logic relies on child visitors sharing the reference manually)
        this.expandCounter = { count: 0 };
    }

    expandDepth: number = 0;
    expandCounter: { count: number; };

    protected getFetchPaths(includes: Visitor[], parentPath: string = ""): string[] {
        const paths: string[] = [];
        for (const include of includes) {
            if (!include.navigationProperty) continue;
            const currentPath = parentPath ? `${parentPath}.${include.navigationProperty}` : include.navigationProperty;
            paths.push(currentPath);
            if (include.includes.length > 0) {
                paths.push(...this.getFetchPaths(include.includes, currentPath));
            }
        }
        return paths;
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
                `SELECT ${this.select} FROM [${table}] WHERE ${this.where} ORDER BY ${this.orderby}`;
        }
    }

    protected isId(p: any): boolean {
        if (!p) return false;
        if (p.type == Lexer.TokenType.ODataIdentifier) {
            return p.value?.name == 'id' || p.value?.name?.endsWith('Id');
        }
        if (p.value && typeof p.value === 'object') {
            return this.isId(p.value) || this.isId(p.value.left) || this.isId(p.value.right);
        }
        return false;
    }

    protected checkParameterLimit() {
        const maxParams = this.options.maxParameters ?? 1000;
        if (this.parameterSeed >= maxParams) {
            throw new ODataV4ParseError({
                msg: `Query too complex: parameter limit of ${maxParams} exceeded.`
            });
        }
    }

    protected VisitComparisonExpression(node: Lexer.Token, context: any, operator: string) {
        if (this.type == SQLLang.SurrealDB) {
            const left = node.value.left;
            const right = node.value.right;

            const isLeftId = this.isId(left);
            const isRightLiteral = right && (right.type == Lexer.TokenType.Literal || (right.type as any) == "Literal");
            const isRightPotentialId = isRightLiteral && (
                (right.value == "Edm.String" && /(?<=[^\\]|^):/.test(right.raw)) ||
                (typeof right.value == "string" && (right.value as string).startsWith("Edm.Int")) ||
                (typeof right.value == "string" && ["Edm.SByte", "Edm.Byte", "Edm.Decimal", "Edm.Double", "Edm.Single"].includes(right.value as string)) ||
                typeof right.value == "number"
            );

            if (isLeftId && isRightPotentialId) {
                const where = this.where;
                this.where = '';
                this.Visit(left, context);
                const field = this.where;

                this.where = '';
                this.Visit(right, context);
                const literal = this.where;

                this.where = where;

                if (operator == "=" || operator == "!=") {
                    if (operator == "=") {
                        this.where += `((${field} = ${literal}) || (string::is_record(type::string(${field})) && (string::ends_with(type::string(${field}), ":" + type::string(${literal})))))`;
                    }
                    else {
                        this.where += `! ((${field} = ${literal}) || (string::is_record(type::string(${field})) && (string::ends_with(type::string(${field}), ":" + type::string(${literal})))))`;
                    }
                    return;
                }
                else {
                    // Range comparison for IDs
                    // Only compare the numeric part if it's a record.
                    // Otherwise, compare the raw field.
                    this.where += `((string::is_record(type::string(${field})) && type::number(string::split(type::string(${field}), ":")[1]) ${operator} ${literal}) || (!string::is_record(type::string(${field})) && ${field} ${operator} ${literal}))`;
                    return;
                }
            }
        }

        this.Visit(node.value.left, context);
        if (this.type == SQLLang.SurrealDB) {
            this.where += ` ${operator} `;
        }
        else {
            this.where += operator == "!=" ? " <> " : ` ${operator} `;
        }
        this.Visit(node.value.right, context);
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
                if (this.includes.length > 0) {
                    const paths = this.getFetchPaths(this.includes);
                    if (paths.length > 0) sql += ` FETCH ${paths.join(", ")}`;
                }
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
            this.groupby ||= "";
        }
        return this;
    }

    protected VisitODataUri(node: Lexer.Token, context: any) {
        this.Visit(node.value.resource, context);
        this.Visit(node.value.query, context);
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
                visitor = new Visitor(this.options);
                visitor.parameterSeed = this.parameterSeed;
                visitor.expandDepth = this.expandDepth + 1;
                visitor.expandCounter = this.expandCounter; // Share the counter
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
        if (!this.options.enableSearch) {
            throw new ODataV4ParseError({
                msg: "$search is disabled."
            });
        }
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
        const value = +node.value.raw;
        if (value < 0) {
            throw new ODataV4ParseError({
                msg: "The $skip query option must be a non-negative integer."
            });
        }
        const maxSkip = this.options.maxSkip ?? 1000000;
        if (value > maxSkip) {
            throw new ODataV4ParseError({
                msg: `The $skip value must not exceed ${maxSkip}.`
            });
        }
        this.skip = value;
    }

    protected VisitTop(node: Lexer.Token, context: any) {
        const value = +node.value.raw;
        const maxPageSize = this.options.maxPageSize ?? 500;
        if (value > maxPageSize) {
            throw new ODataV4ParseError({
                msg: `The $top value must not exceed ${maxPageSize}.`
            });
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
        // For SurrealDB, use backticks like orderby
        if (this.type == SQLLang.SurrealDB) {
            this.groupby += '`' + node.value.expr.raw.replace(/`/g, '\\`') + '`';
        }
        else {
            this.groupby += `[${node.value.expr.raw}]`;
        }
    }

    protected VisitSelect(node: Lexer.Token, context: any) {
        context.target = "select";
        node.value.items.forEach((item, i) => {
            this.Visit(item, context);
            if (i < node.value.items.length - 1) this.select += ", ";
        });
    }

    protected VisitSelectItem(node: Lexer.Token, context: any) {
        // Check if this is a wildcard select - don't parameterize it
        if (node.raw === '*') {
            this.select += '*';
            return;
        }

        if (this.type == SQLLang.SurrealDB) {
            const fieldSeed = `$select${this.selectSeed++}`;
            this.parameters.set(fieldSeed, node.raw);
            this.select += `type::field(${fieldSeed}) AS \`${node.raw.replace(/`/g, '\\`')}\``;
        }
        else {
            let item = node.raw.replace(/\//g, '.');
            this.select += `[${item}]`;
        }
    }

    protected VisitAndExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            const target = context?.target || 'where';
            this[target] += "(";
            this.Visit(node.value.left, context);
            this[target] += " && ";
            this.Visit(node.value.right, context);
            this[target] += ")";
        }
        else {
            this.Visit(node.value.left, context);
            this.where += " AND ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitOrExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            const target = context?.target || 'where';
            this[target] += "(";
            this.Visit(node.value.left, context);
            this[target] += " || ";
            this.Visit(node.value.right, context);
            this[target] += ")";
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
            this[target] += "!(";
            this.Visit(node.value, context);
            this[target] += ")";
        }
        else {
            this.Visit(node.value, context);
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

                this.checkParameterLimit();
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

    protected VisitNegateExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "-(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitHasExpression(node: Lexer.Token, context: any) {
        // OData 'has' is for bitwise flags/enums
        // SurrealDB doesn't have direct bitwise AND, but we can check array membership
        // For now, implement as array contains check
        const target = context?.target || 'where';

        this.Visit(node.value.left, context);
        this[target] += " CONTAINS ";
        this.Visit(node.value.right, context);
    }

    protected VisitIsOfExpression(node: Lexer.Token, context: any) {
        // isof() checks if expression is of specified type
        // Map to SurrealDB type::is::* functions
        const target = context?.target || 'where';
        const typeName = node.value.right?.value || node.value.right?.raw;

        // Map EDM types to SurrealDB type checks
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
        // cast() converts expression to specified type
        const target = context?.target || 'where';
        const typeName = node.value.right?.value || node.value.right?.raw;

        // Map EDM types to SurrealDB type conversion
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

    protected VisitParenExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        this[target] += "(";
        this.Visit(node.value, context);
        this[target] += ")";
    }

    protected VisitAddExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // This seems very wrong.
        if (this.type == SQLLang.SurrealDB && (this.isId(node.value.left) || this.isId(node.value.right))) {
            this[target] += "NULL";
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " + ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitSubExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // This seems very wrong.
        if (this.type == SQLLang.SurrealDB && (this.isId(node.value.left) || this.isId(node.value.right))) {
            this[target] += "NULL";
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " - ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitMulExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        // This seems very wrong.
        if (this.type == SQLLang.SurrealDB && (this.isId(node.value.left) || this.isId(node.value.right))) {
            this[target] += "NULL";
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " * ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitDivExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.type == SQLLang.SurrealDB && (this.isId(node.value.left) || this.isId(node.value.right))) {
            this[target] += "NULL";
        }
        else {
            this.Visit(node.value.left, context);
            this[target] += " / ";
            this.Visit(node.value.right, context);
        }
    }

    protected VisitModExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (this.type == SQLLang.SurrealDB && (this.isId(node.value.left) || this.isId(node.value.right))) {
            this[target] += "NULL";
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
        if (Array.isArray(node.value)) {
            const [first, second] = node.value;
            if (first.type === Lexer.TokenType.LambdaVariableExpression) {
                // Implicit context for lambda variable, just visit the property path
                this.Visit(second, context);
            } else {
                this.Visit(first, context);
                const target = context?.target || 'where';
                if (this.type == SQLLang.SurrealDB) this[target] += "->";
                else this[target] += ".";
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
            if (this.type == SQLLang.SurrealDB) this[target] += "->";
            else this[target] += ".";
            this.Visit(node.value.value, context);
        } else {
            this.Visit(node.value, context);
        }
    }

    protected VisitPropertyPathExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        if (node.value.current && node.value.next) {
            this.Visit(node.value.current, context);
            if (this.type == SQLLang.SurrealDB) {
                // Determine if we should append '->' (graph nav) or nothing (array filter/sub-selection)
                const isCollectionPath = node.value.next.type === Lexer.TokenType.CollectionPathExpression;

                if (!isCollectionPath) {
                    this[target] += "->";
                }
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
            if (context.target == 'orderby') {
                // Orderby fields are not parameterized in SurrealDB, so we'll just output & escape the raw name.
                this[context.target] += '`' + node.value.name.replace(/`/g, '\\`') + '`';
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
        this.VisitComparisonExpression(node, context, "=");
        if (this.type != SQLLang.SurrealDB) {
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
        this.VisitComparisonExpression(node, context, "!=");

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

            if (this.type == SQLLang.SurrealDB && node.value === 'Edm.GeographyPoint') {
                const match = node.raw.match(/'Point\(([^)]+)\)'/);
                if (match) {
                    const [x, y] = match[1].split(' ').map(Number);
                    this[target] += `(${x}, ${y})`;
                    return;
                }
            }
            if (this.type == SQLLang.SurrealDB && node.value === 'Edm.GeographyPolygon') {
                const match = node.raw.match(/'Polygon\(\(([^)]+)\)\)'/);
                if (match) {
                    const points = match[1].split(',').map(p => p.trim().split(' ').map(Number));
                    value = { type: 'Polygon', coordinates: [points] };
                }
            }

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
        const target = context?.target || 'where';
        const lambdaVar = node.value.variable;
        const predicate = node.value.predicate;

        if (this.type == SQLLang.SurrealDB) {
            // "Comments/any(c:c/Score gt 5)" -> Comments[WHERE $this.Score > 5] != []
            this[target] += "[WHERE ";
            this.Visit(predicate, context);
            this[target] += "] != []";
        } else {
            // Fallback or other SQL dialects
            throw new ODataV4ParseError({ msg: `Lambda 'any' not implemented for this SQL dialect.` });
        }
    }

    protected VisitAllExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const lambdaVar = node.value.variable;
        const predicate = node.value.predicate;

        if (this.type == SQLLang.SurrealDB) {
            // "Comments/all(c:c/Score gt 5)" -> Comments[WHERE !($this.Score > 5)] = []
            this[target] += "[WHERE !(";
            this.Visit(predicate, context);
            this[target] += ")] = []";
        } else {
            throw new ODataV4ParseError({ msg: `Lambda 'all' not implemented for this SQL dialect.` });
        }
    }

    protected VisitLambdaVariableExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            const target = context?.target || 'where';
            this[target] += "$this";
        }
    }

    protected VisitLambdaPredicateExpression(node: Lexer.Token, context: any) {
        this.Visit(node.value, context);
    }

    protected VisitImplicitVariableExpression(node: Lexer.Token, context: any) {
        if (this.type == SQLLang.SurrealDB) {
            const target = context?.target || 'where';
            this[target] += "$this";
        }
    }

    protected VisitMethodCallExpression(node: Lexer.Token, context: any) {
        const target = context?.target || 'where';
        const method = node.value.method;
        const params = node.value.parameters || [];
        let fn: string;
        this.checkParameterLimit();
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
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "(IF string::contains(type::string(";
                    this.Visit(params[0], context);
                    this[target] += "), type::string(";
                    this.Visit(params[1], context);
                    this[target] += ")) THEN string::len(string::split(type::string(";
                    this.Visit(params[0], context);
                    this[target] += "), type::string(";
                    this.Visit(params[1], context);
                    this[target] += "))[0]) ELSE -1 END)";
                } else {
                    fn = "";
                    switch (this.type) {
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
                }
                break;
            case "round":
                if (this.type == SQLLang.SurrealDB && this.isId(params[0])) {
                    this[target] += "NULL";
                }
                else {
                    this[target] += this.type == SQLLang.SurrealDB ? "math::round(" : "ROUND(";
                    this.Visit(params[0], context);
                    this[target] += ")";
                }
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
            case "concat":
                this[target] += this.type == SQLLang.SurrealDB ? "string::concat(" : "CONCAT(";
                for (let i = 0; i < params.length; i++) {
                    this.Visit(params[i], context);
                    if (i < params.length - 1) {
                        this[target] += ", ";
                    }
                }
                this[target] += ")";
                break;
            case "toupper":
                this[target] += this.type == SQLLang.SurrealDB ? "string::uppercase(" : "UCASE(";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "floor":
                if (this.type == SQLLang.SurrealDB) {
                    if (this.isId(params[0])) {
                        this[target] += "NULL";
                    }
                    else {
                        this[target] += `math::floor(`;
                        this.Visit(params[0], context);
                        this[target] += ")";
                    }
                }
                break;
            case "ceiling":
                if (this.type == SQLLang.SurrealDB) {
                    if (this.isId(params[0])) {
                        this[target] += "NULL";
                    }
                    else {
                        this[target] += `math::ceil(`;
                        this.Visit(params[0], context);
                        this[target] += ")";
                    }
                }
                break;
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
            case "substring":
                this[target] += this.type == SQLLang.SurrealDB
                    ? "string::slice("
                    : "SUBSTRING(";
                this.Visit(params[0], context);
                this[target] += ", ";
                this.Visit(params[1], context);
                if (params[2]) {
                    this[target] += ", ";
                    this.Visit(params[2], context);
                }
                this[target] += ")";
                break;
            case "trim":
                this[target] += this.type == SQLLang.SurrealDB
                    ? "string::trim("
                    : "TRIM(' ' FROM ";
                this.Visit(params[0], context);
                this[target] += ")";
                break;
            case "fractionalseconds":
                // Extract sub-second precision (nanoseconds) and convert to fractional seconds
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "(time::nano(";
                    this.Visit(params[0], context);
                    this[target] += ") % 1000000000 / 1000000000.0)";
                }
                break;
            case "date":
                // Extract just the date component
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "time::floor(";
                    this.Visit(params[0], context);
                    this[target] += ", 1d)";
                }
                break;
            case "time":
                // Extract just the time component (duration since midnight in nanoseconds)
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "(time::nano(";
                    this.Visit(params[0], context);
                    this[target] += ") % 86400000000000)";
                }
                break;
            case "geo.distance":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "geo::distance(";
                    this.Visit(params[0], context);
                    this[target] += ", ";
                    this.Visit(params[1], context);
                    this[target] += ")";
                }
                break;
            case "geo.intersects":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "geo::intersects(";
                    this.Visit(params[0], context);
                    this[target] += ", ";
                    this.Visit(params[1], context);
                    this[target] += ")";
                }
                break;
            case "geo.length":
                if (this.type == SQLLang.SurrealDB) {
                    this[target] += "geo::length(";
                    this.Visit(params[0], context);
                    this[target] += ")";
                }
                break;
            default:
                throw new ODataV4ParseError({ msg: `Function '${method}' is not supported or allowed.` });
        }
    }

}
