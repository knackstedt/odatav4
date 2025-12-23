import * as util from 'util';
import type { ParsedQuery } from "../types";
import { Visitor } from "./visitor";

function createInspectableString(sql: string, parameters: Record<string, any>) {
    if (globalThis.process?.env?.['NODE_ENV'] === 'test') {
        return sql;
    }
    const deParameterize = () => {
        let sql = this.sql;
        this.parameters.forEach((value, key) => {
            const k = key.replace("$", "\\$");

            sql = sql.replace(new RegExp("type::field\\(" + k + "\\)", 'g'), '{' + value + '}');
            sql = sql.replace(new RegExp("type::record\\(" + k + "\\)", 'g'), '{' + value + '}');
            sql = sql.replace(new RegExp(k, 'g'), typeof value === 'string' ? '{"' + value + '"}' : '{' + value + '}');

            sql = sql.replace(/type::table\('([^']+?)'\)/, (m, g) => g);
            sql = sql.replace(/type::string\(('[^']+?')\)/, (m, g) => g);
            sql = sql.replace(/type::string\(([^']+?)\)/, (m, g) => g);
        });

        return sql;
    };
    return new Proxy(new String(sql), {
        get(target, prop, receiver) {
            // String classes that are proxies need to be able to do this
            if (prop === 'toString') {
                return () => sql;
            }
            else if (prop === util.inspect?.custom) {
                return (depth: number, options: any) => {

                    const base = '\x1b[38;2;255;255;255m';
                    const string = '\x1b[38;2;0;255;110m';
                    const fn = '\x1b[38;2;255;155;103m';
                    const number = '\x1b[38;2;0;219;255m';
                    const keyword = '\x1b[38;2;255;0;158m';
                    const dgray = '\x1b[38;2;200;200;200m';
                    const reset = '\x1b[0m';

                    let sql = deParameterize();

                    // Colorize array indices
                    sql = sql.replace(/\[(\d+)\]/g, (m, g) => dgray + '[' + number + g + dgray + ']' + base);
                    // Colorize operators
                    sql = sql.replace(/&&|\|\|| [<>+-/*] /g, m => keyword + m + base);
                    sql = sql.replace(/,/g, m => dgray + m + base);

                    // Colorize numbers
                    sql = sql.replace(/([ ()])(\d+)/g, (m, g0, g1) => g0 + number + g1 + base);
                    sql = sql.replace(/(\d+)([ ()])/g, (m, g0, g1) => number + g0 + base + g1);
                    sql = sql.replace(/([ ()])(\d+)([ ()])/g, (m, g0, g1, g2) => g0 + number + g1 + base + g2);

                    // Colorize keywords
                    sql = sql.replace(/( |^)(SELECT|WHERE|GROUP BY|GROUP ALL|ORDER BY|LIMIT|START|FROM|FETCH|AS|COUNT|ASC|DESC)( |$)/g, (m, g0, g1, g2) => g0 + keyword + g1 + base + g2);
                    sql = sql.replace(/( |^)(SELECT|WHERE|GROUP BY|GROUP ALL|ORDER BY|LIMIT|START|FROM|FETCH|AS|COUNT|ASC|DESC)( |$)/g, (m, g0, g1, g2) => g0 + keyword + g1 + base + g2);

                    // Colorize functions
                    sql = sql.replace(/([a-z_]+(?:::[a-z_]+)+)\(/g, m => fn + m + base);

                    // Colorize parentheses
                    sql = sql.replace(/[()]/g, m => dgray + m + base);

                    // Colorize strings
                    sql = sql.replace(/`.+?(?<!\\)`|'[^']+'|"[^"]+"/g, (m) => string + m + base);

                    return reset + base + sql + reset;
                };
            }
            return Reflect.get(target, prop, receiver);
        }
    });
}

export const renderQuery = (query: ParsedQuery, table: string, fetch = [] as string | string[], disableParameters = false) => {
    let {
        where,
        select,
        orderby,
        groupby,
        limit,
        skip,
        parameters,
        includes
    } = query;

    // There are some cases where select may be undefined.
    select ??= "*";
    parameters ??= new Map();
    let selectIteration = 0;

    const doExpand = (node: Visitor, path = '') => {
        if (!node.includes) return;
        for (let i = 0; i < node.includes.length; i++) {
            const include = node.includes[i];
            path = path + include.navigationProperty;


            include.parameters.forEach((value, key) => {
                if (key.startsWith("$select")) {
                    const newKey = key.replace(/\$select\d+/, "$select_expanded_" + selectIteration++);
                    include.select = include.select.replace(key, newKey);
                    parameters.set(newKey, include.navigationProperty + '.' + value);
                }
                else {
                    parameters.set(path + '.' + key, value);
                }
            });

            doExpand(include, path + '.');
        }
    };
    // We need to handle the root includes if they exist
    if (includes) {
        // Construct a dummy visitor to reuse doExpand if possible, or just iterate
        // The original logic called doExpand(rootNode). rootNode was the Visitor from createQuery.
        // If we have includes on ParsedQuery, we should iterate them.
        for (let i = 0; i < includes.length; i++) {
            const include = includes[i];
            const path = include.navigationProperty;

            // Update: We need to ensure we don't double-add if it's already in select?
            // The original logic just appended.
            if (include.select === '*') {
                include.select = include.navigationProperty + '.*';
            }

            include.parameters.forEach((value, key) => {
                if (key.startsWith("$select")) {
                    const newKey = key.replace(/\$select\d+/, "$select_expanded_" + selectIteration++);
                    include.select = include.select.replace(key, newKey);
                    parameters.set(newKey, include.navigationProperty + '.' + value);
                }
                else {
                    parameters.set(path + '.' + key, value);
                }
            });

            select += ', ' + include.select
                .replace(/type::field\(([^)]+)\)/g, (m, p) => include.parameters.get(p) || m)
                .replace(/ AS `[^`]+`/g, '');

            doExpand(include, path + '.');
        }
    }

    let fetchClause = '';
    if (fetch) {
        if (!Array.isArray(fetch))
            fetch = [fetch];

        if (fetch.length > 0) {
            fetchClause = `FETCH `;
            fetchClause += fetch.map((field, idx) => {
                parameters.set(`$fetch${idx}`, field);
                return `type::field($fetch${idx})`;
            }).join(', ');
        }
    }

    // Initiate a query to count the number of total records that match
    let countQuery = [
        `SELECT count() FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        'GROUP ALL'
    ].filter(i => i).join(' ');

    // Build a full query that we will throw at surreal
    let entriesQuery = [
        `SELECT ${select} FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        `${groupby ? `GROUP BY ${groupby}` : ''}`,
        (typeof orderby == "string" && orderby != '1') ? `ORDER BY ${orderby}` : '',
        typeof limit == "number" ? `LIMIT ${limit}` : '',
        typeof skip == "number" ? `START ${skip}` : '',
        fetchClause
    ].filter(i => i).join(' ');

    // Pass the table as a parameter to avoid injection attacks.
    parameters.set("$table", table);

    return {
        /**
         * The count query
         */
        countQuery: createInspectableString(countQuery, parameters),
        /**
         * The entries query
         */
        entriesQuery: createInspectableString(entriesQuery, parameters),
        /**
         * The parameters
         */
        parameters: Object.fromEntries(parameters),
        /**
         * The skip
         */
        skip,
        /**
         * The limit
         */
        limit
    };
};
