import * as express from "express";
import { route } from './util';

import Surreal, { RecordId, StringRecordId } from 'surrealdb';
import { createQuery, SQLLang } from '../parser/main';
import { Visitor } from '../parser/visitor';
import { ODataExpressConfig, ODataExpressTable } from '../types';
import { getJSONSchema, getODataMetadata } from '../util/metadata';



/**
 * Supported request formats
 * /api/odata/table:12345
 * /api/odata/
 *  = body: { id: table:12345 }
 *
 * /api/odata/table
 *  = body: { id: table:12345 }
 */

/**
 * Validate that the authenticated user has access to the underlying table & object
 */
const checkObjectAccess = (req: express.Request, tables: ODataExpressTable<any>[], object?: Object) => {
    let targetId: string;
    let targetTable: string;

    const path = decodeURIComponent(req.originalUrl);
    const uriPathWithQuery = path.endsWith("/") ? path.slice(0, -1) : path;
    const uriPath = uriPathWithQuery.split('?')[0];
    const lastUrlChunk = uriPath.split('/').filter(c => !!c).pop();
    const [urlTargetTable, urlTargetId] = lastUrlChunk == 'odata' ? [] : (lastUrlChunk || '').split(':');

    if (object?.['id']) {
        const [objTable, objId] = object['id'].split(':');

        if (urlTargetId && urlTargetId != objId)
            throw { status: 400, message: "ID from URL mismatches data" };
        if (urlTargetTable && urlTargetTable != objTable)
            throw { status: 400, message: "Table from URL mismatches data", urlTable: urlTargetTable, objectTable: objTable };

        targetId = objId;
        targetTable = objTable;
    }
    else {
        targetId = urlTargetId;
        targetTable = urlTargetTable;
    }

    // If the ID is contained within mathematical brackets, peel the real ID out.
    if (/^⟨[^⟩]+⟩$/.test(targetId)) {
        targetId = targetId.slice(1, -1);
    }

    if (!targetTable) {
        throw { status: 400, message: "Table not specified" };
    }

    const tableConfig = tables.find(t => t.table == targetTable);

    if (!tableConfig)
        throw { status: 404, message: "Not Found" };

    /**
     * Perform an operation access check.
     */
    if (tableConfig?.accessControl) {
        if (!req['session']?.profile) {
            throw { status: 403, message: "Forbidden" };
        }

        const groups = req['session'].profile.roles;
        const { read, patch, delete: del, post, write, all } = tableConfig.accessControl;

        if (all) {
            if (!all.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (read && req.method == 'get') {
            if (!read.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (patch && req.method == 'patch') {
            if (!patch.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (del && req.method == 'delete') {
            if (!del.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (post && req.method == 'post') {
            if (!post.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        // If it's something that would modify a table, check for write access.
        if (write && ['post', 'patch', 'delete'].includes(req.method)) {
            if (!write.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }
    }

    return {
        tableConfig: tableConfig,
        table: targetTable,
        id: targetId,
    };
};


/**
 * Parse the request URL and build queries
 */
export const ODataV4ToSurrealQL = (
    table: string,
    urlPath: string,
    fetch = [] as string | string[]
) => {
    // If we don't get a full URL, fake one.
    if (!/https?:\/\//.test(urlPath)) {
        urlPath = 'http://localhost' + (urlPath.startsWith('/') ? '' : '/') + urlPath;
    }
    const url = new URL(urlPath);
    const queryString = url.search;

    const hasFilter =
        queryString?.includes("$select") ||
        queryString?.includes("$filter") ||
        queryString?.includes("$group") ||
        queryString?.includes("$expand") ||
        queryString?.includes("$top") ||
        queryString?.includes("$fetch") ||
        queryString?.includes("$order");

    const query = queryString.startsWith("?") ? queryString.slice(1) : queryString;
    const odataQuery = decodeURIComponent(query.trim());


    // Note: createQuery throws an error if there is leading or trailing whitespace on odata params
    // It also throws an error if there are query params that aren't known to the odata spec.
    // TODO: Strip unknown params instead of throwing an error?
    const rootNode = hasFilter ? createQuery(odataQuery, {
        type: SQLLang.SurrealDB
    }) : {  } as Visitor;
    let {
        where,
        select,
        orderby,
        limit,
        skip,
        parameters,
    } = rootNode;

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
        for (let i = 0; i < node.includes?.length; i++) {
            const include = node.includes[i];
            path = path + include.navigationProperty;

            select += ', ' + include.navigationProperty + '.' + include.select;

            include.parameters.forEach((value, key) => {
                parameters.set(path + '.' + key, value);
            });

            doExpand(include, path + '.');
        }
    }
    doExpand(rootNode);


    // Build a full query that we will throw at surreal
    let entriesQuery = [
        `SELECT ${select} FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        (typeof orderby == "string" && orderby != '1') ? `ORDER BY ${orderby}` : '',
        typeof limit == "number" ? `LIMIT ${limit}` : '',
        typeof skip == "number" ? `START ${skip}` : '',
    ].filter(i => i).join(' ');

    if (fetch) {
        if (!Array.isArray(fetch))
            fetch = [fetch];

        if (fetch.length > 0) {
            entriesQuery += ` FETCH `;
            entriesQuery += fetch.map((field, idx) => {
                parameters.set(`$fetch${idx}`, field);
                return `$fetch${idx}`;
            }).join(', ');
        }
    }

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

/**
 * Executes an OData V4 select query with filtering against a SurrealDB table.
 * @param db - The SurrealDB database instance.
 * @param table - The name of the table to query.
 * @param urlPath - The request URL containing OData query parameters.
 * @returns A Promise resolving to an object containing OData-compliant results, including count, nextlink, and value array.
 */
export const RunODataV4SelectFilter = async (
    db: Surreal,
    table: string,
    urlPath: string,
    fetch = [] as string | string[]
) => {

    let {
        countQuery,
        entriesQuery,
        parameters,
        skip,
        limit
    } = await ODataV4ToSurrealQL(
        table,
        urlPath,
        fetch
    );
    limit ??= 0;
    skip ??= 0;

    // const includeMetadata = /[?&]$metadata/.test(urlPath);

    // Surreal doesn't like parameters with a $ prefix
    // so make a copy without them.
    Object.keys(parameters).forEach(k => {
        parameters[k.slice(1)] = parameters[k];
    });

    let [
        countResult,
        [data]
    ] = await Promise.all([
        db.query<any>(countQuery, parameters),
        db.query<any[]>(entriesQuery, parameters)
    ]);
    data ??= [];
    const count = countResult?.[0]?.[0]?.count || 0;

    const pageSize = 100;

    const url = new URL(urlPath);
    url.searchParams.set('$skip', skip + data.length);
    url.searchParams.set('$top', pageSize as any);

    // TODO: Implement metadata

    // const metadata = includeMetadata
    //     ? undefined
    //     : await db.query(`INFO FOR TABLE ${table}`);

    const entriesRead = skip + data.length;
    return {
        // '@odata.metadata': metadata,
        // '@odata.context': `${url.pathname}$metadata#${table}`,
        '@odata.count': count ?? undefined,
        '@odata.nextlink': (skip + pageSize) >= (count as number)
            ? undefined
            : `${url.pathname}?${url.searchParams.toString()}`,
        value: data
    };
};


const ODataCRUDMethods = async (
    connection: Surreal,
    config: ODataExpressConfig,
    req: express.Request
) => {
    let {
        tables,
        idGenerator,
        // hooks
    } = config;

    const isBulk = Array.isArray(req.body);
    const beforeMethod = 'beforeRecord' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);
    const afterMethod = 'afterRecord' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);

    const accessResult = Symbol("private");

    let items: {
        id: string,
        [accessResult]: ReturnType<typeof checkObjectAccess>;
    }[] = isBulk ? req.body : [req.body];

    if (req.method == "DELETE" && !req.body) {
        items = [{ id: req.path.split('/').pop() }] as any;
    }

    // Remove any empty items.
    items = items.filter(i => i !== null && i !== undefined);

    if (!items || items.length == 0) {
        throw { status: 400, message: "No data provided" };
    }

    // If there is a preprocessor, apply it on all records to be inserted.
    items = await Promise.all(items.map(async item => {
        const { id, table, tableConfig } = checkObjectAccess(req, tables, item);

        if (typeof tableConfig[beforeMethod] == "function") {
            item = await tableConfig[beforeMethod](req, item);
        }

        // Support a generic mutate handler
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && tableConfig.beforeRecordMutate) {
            item = await tableConfig.beforeRecordMutate(req, item) as any;
        }

        item[accessResult] = {
            id, table, tableConfig
        };
        return item;
    }));

    // Get all of the data
    let results = await Promise.all(items.map(async (item) => {
        const { id, table } = item[accessResult];
        const db = connection;

        const rid = id == null ? null : new RecordId(table, id);

        const variables = await (
            typeof config.variables == 'function'
                ? config.variables(req, item)
                : config.variables
        ) || [];

        idGenerator ??= async () => {
            return db.query<[string]>('RETURN rand::ulid().lowercase()')
                .then(r => r[0]);
        }

        let result;
        if (req.method == "POST") {
            const newId = new RecordId(table, await idGenerator(item));
            delete item.id;
            const results = await db.query(`CREATE type::record($id) CONTENT $content`, {
                id: newId,
                content: item,
                ...variables
            });
            const popped = results.pop();
            result = Array.isArray(popped) && popped.length > 0 ? popped[0] : null;
        }
        else if (req.method == "PATCH") {
            // if (!item.id) {
            //     throw { status: 400, message: "ID is required in body for PATCH" };
            // }

            delete item.id;
            result = await db.merge(rid, item);
            const results = await db.query(`UPDATE type::record($id) MERGE $content`, {
                id: rid,
                content: item,
                ...variables
            });
            result = results.pop()[0];
        }
        else if (req.method == "PUT") {
            delete item.id;
            const results = await db.query(`UPSERT type::record($id) CONTENT $content`, {
                id: rid,
                content: item,
                ...variables
            });
            result = results.pop()[0];
        }
        else if (req.method == "DELETE") {
            const results = await db.query(`DELETE type::record($id)`, {
                id: rid,
                ...variables
            });
            result = results.pop()[0];
        }
        else {
            throw { status: 400, message: "Invalid method" };
        }

        return {
            result,
            accessResult: item[accessResult]
        };
    }));

    // If there is a postprocessor, apply it on the result set.
    results = await Promise.all(results.map(async r => {
        const {
            result,
            accessResult
        } = r;

        if (req.method != "GET") {
            if (typeof accessResult.tableConfig.afterRecordMutate == "function") {
                await accessResult.tableConfig.afterRecordMutate(req, result);
            }
        }
        if (typeof accessResult.tableConfig[afterMethod] == "function") {
            await accessResult.tableConfig[afterMethod](req, result);
        }

        return r;
    }));


    if (isBulk) {
        results = results.filter(r => !!r);
        if (results.length == 0) {
            // TODO: Should we do anything special here?
        }
        return results;
    }
    else {
        return results[0];
    }
};

/**
 * OData V4 Middleware for Express
 * Based on the provided configuration, creates an Express router that
 * handles OData V4 requests, translates them into SurrealDB queries,
 * and returns the results in OData-compliant format.
 */
export const SurrealODataV4Middleware = (
    config: ODataExpressConfig
) => {
    const connection = config.resolveDb;
    const tables: (ODataExpressTable<any> & { _fields?: { type: string } })[] = config.tables;

    if (config.enableAutoTypeCasting) {
        // Experimental. TBD.
    }

    if (!connection) {
        throw new Error("No connection resolver specified");
    }

    const router: express.Router & { config: ODataExpressConfig } = express.Router() as any;
    router.config = config;

    router.use(route(async (req, res, next) => {
        req['db'] = connection instanceof Surreal ? connection : await connection(req);
        next();
    }));

    /**
     * OData Metadata Endpoint
     */
    router.get('/$metadata#:table', route(async (req, res, next) => {
        const db = req['db'] as Surreal;
        const { tableConfig, table, id } = checkObjectAccess(req, tables);

        if (!tableConfig) {
            throw { status: 400, message: "Table not specified" };
        }

        res.send(await getODataMetadata(db, tableConfig));
    }));

    /**
     * JSON Schema Endpoint
     */
    router.get('/$schema#:table', route(async (req, res, next) => {
        const db = req['db'] as Surreal;
        const { tableConfig, table, id } = checkObjectAccess(req, tables);

        if (!tableConfig) {
            throw { status: 400, message: "Table not specified" };
        }

        res.send(await getJSONSchema(db, tableConfig));
    }));

    /**
     * GET -- select with filtering
     */
    router.use(route(async (req, res, next) => {
        if (req.method != "GET") return next();
        const db = req['db'] as Surreal;

        const { tableConfig, table, id } = checkObjectAccess(req, tables);

        // If the target includes a colon, then we're acting on 1 record
        if (id) {
            let query = `SELECT * FROM $id`;
            let params = {};
            let fetch = tableConfig.fetch;

            if (fetch) {
                if (!Array.isArray(fetch))
                    fetch = [fetch];

                if (fetch.length > 0) {
                    query += ` FETCH `;
                    query += fetch.map((field, idx) => {
                        params[`fetch${idx}`] = field;
                        return `$fetch${idx}`;
                    }).join(', ');
                }
            }
            let _r = await db.query<[[any]]>(query, {
                ...params,
                id: new RecordId(table, id)
            });
            let [[result]] = _r;

            if (typeof tableConfig.afterRecordGet == "function")
                result = await tableConfig.afterRecordGet(req, result);

            if (!result) {
                res.contentType("application/json");
                res.send('{}');
                return;
            }

            res.contentType("application/json");
            res.send(JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            }));
            return;
        }

        let url = new URL(req.protocol + "://" + req.hostname + req.originalUrl);

        // if (tableConfig.filterStringProcessor) {
        //     const query = tableConfig.filterStringProcessor(req, url.searchParams['$filter'] || '');
        //     url.search = query;
        // }

        const result = await RunODataV4SelectFilter(
            db,
            table,
            url.toString(),
            tableConfig.fetch
        );

        if (typeof tableConfig.afterRecordGet == "function") {
            // result.value = await Promise.all(result.value.map(v => tableConfig.afterRecordGet(req, v)));
            const batchSize = 10;
            const processedValues = [];

            for (let i = 0; i < result.value.length; i += batchSize) {
                const batch = result.value.slice(i, i + batchSize);
                const processedBatch = await Promise.all(batch.map(v => tableConfig.afterRecordGet(req, v)));
                processedValues.push(...processedBatch);
            }

            result.value = processedValues;
        }

        res.set("Content-Type", "application/json");
        res.send(JSON.stringify(result, (key, value) =>
            typeof value === 'bigint'
                ? value.toString() // TODO: This may be lossy. Consider a different approach
                : value // return everything else unchanged
        ));
    }));

    /**
     * POST / PATCH / PUT / DELETE
     *
     */
    router.use(route(async (req, res, next) => {
        const db = req['db'] as Surreal;

        const result = await ODataCRUDMethods(db, config, req);
        res.send(Array.isArray(result) ? result.map(r => r.result) : result.result);
    }));

    return router;
}

