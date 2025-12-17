import { ParsedQuery } from "../types";
import { Visitor } from "./visitor";

export const renderQuery = (query: ParsedQuery, table: string, fetch = [] as string | string[]) => {
    let {
        where,
        select,
        orderby,
        limit,
        skip,
        parameters,
        includes
    } = query;

    // There are some cases where select may be undefined.
    select ??= "*";
    parameters ??= new Map();

    // Initiate a query to count the number of total records that match
    const countQuery = [
        `SELECT count() FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        'GROUP ALL'
    ].filter(i => i).join(' ');

    const doExpand = (node: Visitor, path = '') => {
        if (!node.includes) return;
        for (let i = 0; i < node.includes.length; i++) {
            const include = node.includes[i];
            path = path + include.navigationProperty;

            select += ', ' + include.navigationProperty + '.' + include.select;

            include.parameters.forEach((value, key) => {
                parameters.set(path + '.' + key, value);
            });

            doExpand(include, path + '.');
        }
    }
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
            select += ', ' + include.navigationProperty + '.' + include.select;

            include.parameters.forEach((value, key) => {
                parameters.set(path + '.' + key, value);
            });

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

    // Build a full query that we will throw at surreal
    let entriesQuery = [
        `SELECT ${select} FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        (typeof orderby == "string" && orderby != '1') ? `ORDER BY ${orderby}` : '',
        typeof limit == "number" ? `LIMIT ${limit}` : '',
        typeof skip == "number" ? `START ${skip}` : '',
        fetchClause
    ].filter(i => i).join(' ');

    // Pass the table as a parameter to avoid injection attacks.
    parameters.set("$table", table);

    return {
        countQuery,
        entriesQuery,
        parameters: Object.fromEntries(parameters),
        skip,
        limit
    };
};
