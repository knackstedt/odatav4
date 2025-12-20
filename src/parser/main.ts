import Lexer from './lexer';
import { filter, query } from "./parser";
import { SQLLang, Visitor } from "./visitor";

export { SQLLang } from "./visitor";

export interface SqlOptions {
    useParameters?: boolean;
    type?: SQLLang;
    maxExpandDepth?: number;
    maxExpandCount?: number;
    maxTop?: number;
    maxSkip?: number;
    maxParameters?: number;
    enableSearch?: boolean;
}

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
    return new Visitor(options).Visit(ast).asType();
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
    return new Visitor(options).Visit(ast).asType();
}


