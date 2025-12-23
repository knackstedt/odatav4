import Lexer from './lexer';
import { filter, query } from "./parser";
import { MsSqlVisitor, MySqlVisitor, OracleVisitor, PostgreSqlVisitor, SQLLang, type SqlOptions, SurrealDbVisitor, Visitor } from "./visitors";

export { SQLLang } from "./visitors";
export type { SqlOptions } from "./visitors";

/**
 * Creates an SQL query descriptor from an OData query string
 * @param {string} odataQuery - An OData query string
 * @return {string}  SQL query descriptor
 * @example
 * const filter = createQuery("$filter=Size eq 4 and Age gt 18");
 * let sqlQuery = `SELECT * FROM table WHERE ${filter.where}`;
 */
export function createQuery(odataQuery: string | Lexer.Token, options = <SqlOptions>{}, type?: SQLLang): Visitor {
    if (typeof type != "undefined" && type) options.type = type;

    let ast: Lexer.Token = (typeof odataQuery == "string" ? query(odataQuery) : odataQuery);

    let visitor: Visitor;
    switch (options.type) {
        case SQLLang.SurrealDB:
            visitor = new SurrealDbVisitor(options, ast);
            break;
        case SQLLang.MsSql:
            visitor = new MsSqlVisitor(options, ast);
            break;
        case SQLLang.MySql:
            visitor = new MySqlVisitor(options, ast);
            break;
        case SQLLang.PostgreSql:
            visitor = new PostgreSqlVisitor(options, ast);
            break;
        case SQLLang.Oracle:
            visitor = new OracleVisitor(options, ast);
            break;
        default:
            visitor = new Visitor(options, ast);
            break;
    }

    return visitor.Visit(ast);
    // return this;
}

/**
 * Creates an SQL WHERE clause from an OData filter expression string
 * @param {string} odataFilter - A filter expression in OData $filter format
 * @return {string}  SQL WHERE clause
 * @example
 * const filter = createFilter("Size eq 4 and Age gt 18");
 * let sqlQuery = `SELECT * FROM table WHERE ${filter}`;
 */
export function createFilter(odataFilter: string | Lexer.Token, options = <SqlOptions>{}, type?: SQLLang): Visitor {
    if (typeof type != "undefined" && type) options.type = type;
    let ast: Lexer.Token = (typeof odataFilter == "string" ? filter(odataFilter) : odataFilter);

    let visitor: Visitor;
    switch (options.type) {
        case SQLLang.SurrealDB:
            visitor = new SurrealDbVisitor(options, ast);
            break;
        case SQLLang.MsSql:
            visitor = new MsSqlVisitor(options, ast);
            break;
        case SQLLang.MySql:
            visitor = new MySqlVisitor(options, ast);
            break;
        case SQLLang.PostgreSql:
            visitor = new PostgreSqlVisitor(options, ast);
            break;
        case SQLLang.Oracle:
            visitor = new OracleVisitor(options, ast);
            break;
        default:
            visitor = new Visitor(options, ast);
            break;
    }

    return visitor.Visit(ast);
}


