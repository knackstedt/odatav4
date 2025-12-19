import * as express from "express";
import { route } from './util';

import { RecordId, Surreal } from 'surrealdb';
import { createQuery, SQLLang } from '../parser/main';
import { renderQuery } from '../parser/query-renderer';
import { ODataExpressConfig, ODataExpressTable, ParsedQuery } from '../types';
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

    if (targetId && !isNaN(Number(targetId))) {
        targetId = Number(targetId) as any;
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

        const method = req.method.toLowerCase();
        const groups = req['session'].profile.roles ?? [];
        const { read, patch, delete: del, post, write, all } = tableConfig.accessControl;

        if (all) {
            if (!all.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (read && method === 'get') {
            if (!read.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (patch && method === 'patch') {
            if (!patch.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (del && method === 'delete') {
            if (!del.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        if (post && method === 'post') {
            if (!post.find(r => groups.includes(r)))
                throw { status: 403, message: "Forbidden" };
        }

        // If it's something that would modify a table, check for write access.
        if (write && ['post', 'patch', 'delete'].includes(method)) {
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

export const parseODataRequest = (
    urlPath: string
): ParsedQuery => {
    // If we don't get a full URL, fake one.
    if (!/https?:\/\//.test(urlPath)) {
        urlPath = 'http://localhost' + (urlPath.startsWith('/') ? '' : '/') + urlPath;
    }
    const url = new URL(urlPath);
    const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    const odataQuery = decodeURIComponent(query.trim());

    if (!odataQuery) {
        return {
            select: '*',
            where: undefined,
            orderby: undefined,
            limit: undefined,
            skip: undefined,
            includes: [],
            parameters: new Map()
        };
    }

    const rootNode = createQuery(odataQuery, {
        type: SQLLang.SurrealDB
    });

    return {
        where: rootNode.where,
        select: rootNode.select,
        orderby: rootNode.orderby,
        limit: rootNode.limit,
        skip: rootNode.skip,
        includes: rootNode.includes,
        parameters: rootNode.parameters,

        format: rootNode.format,
        count: rootNode.inlinecount,
        skipToken: rootNode.skipToken,
        search: rootNode.search
    };
};


/**
 * Parse the request URL and build queries
 */
export const ODataV4ToSurrealQL = (
    table: string,
    urlPath: string | ParsedQuery,
    fetch = [] as string | string[]
) => {
    const parsed = typeof urlPath === 'string'
        ? parseODataRequest(urlPath)
        : urlPath;

    return {
        ...parsed,
        ...renderQuery(parsed, table, fetch)
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
    fetch = [] as string | string[],
    parsed?: ParsedQuery,
    maxPageSize?: number
) => {

    // Ensure we have a parsed query object
    if (!parsed) {
        parsed = parseODataRequest(urlPath);
    }

    // Enforce maxPageSize
    if (maxPageSize !== undefined && maxPageSize > 0) {
        if (parsed.limit === undefined || parsed.limit > maxPageSize) {
            parsed.limit = maxPageSize;
        }
    }

    const converterResult = await ODataV4ToSurrealQL(
        table,
        parsed,
        fetch
    );

    let {
        countQuery,
        entriesQuery,
        parameters,
        skip,
        limit,
        count: includeCount
    } = converterResult;
    limit ??= 0;
    skip ??= 0;

    // const includeMetadata = /[?&]$metadata/.test(urlPath);

    // Surreal doesn't like parameters with a $ prefix
    // so make a copy without them.
    Object.keys(parameters).forEach(k => {
        parameters[k.slice(1)] = parameters[k];
    });

    let countResult, data;
    try {
        const [rawCountResult, rawData] = await Promise.all([
            db.query(countQuery.toString(), parameters).collect<any[]>(),
            db.query(entriesQuery.toString(), parameters).collect<any[]>()
        ]);

        // SurrealDB's collect() returns an array of result arrays, one for each query.
        // If we passed a single query, it's [ [result1, result2, ...] ].
        countResult = (rawCountResult?.[0] || []) as any[];
        data = (rawData?.[0] || []) as any[];
    } catch (e) {
        console.error("SurrealDB Query Error:", e);
        console.error("Query:", entriesQuery);
        console.error("Parameters:", JSON.stringify(parameters, null, 2));
        throw e;
    }

    const actualData = (data || []) as any[];
    const count = countResult?.[0]?.count || 0;

    const pageSize = (limit && limit > 0) ? limit : 100;

    const url = new URL(urlPath, 'http://localhost');
    url.searchParams.set('$skip', (skip + actualData.length).toString());
    url.searchParams.set('$top', pageSize.toString());

    // TODO: Implement metadata

    // const metadata = includeMetadata
    //     ? undefined
    //     : await db.query(`INFO FOR TABLE ${table}`);

    return {
        // '@odata.metadata': metadata,
        // '@odata.context': `${url.pathname}$metadata#${table}`,
        '@odata.count': includeCount ? count : undefined,
        '@odata.nextlink': (skip + pageSize) >= (count as number)
            ? undefined
            : `${url.pathname}?${url.searchParams.toString()}`,
        value: actualData
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
            return db.query('RETURN rand::ulid().lowercase()')
                .collect<[string]>()
                .then(r => r[0]);
        };

        let result;
        if (req.method == "POST") {
            const newId = new RecordId(table, await idGenerator(item));
            delete item.id;
            const results = await db.query(`CREATE type::record($id) CONTENT $content`, {
                id: newId,
                content: item,
                ...variables
            }).collect();
            const popped = results.pop();
            result = Array.isArray(popped) && popped.length > 0 ? popped[0] : null;
        }
        else if (req.method == "PATCH") {
            // if (!item.id) {
            //     throw { status: 400, message: "ID is required in body for PATCH" };
            // }

            delete item.id;
            const results = await db.query(`UPDATE type::record($id) MERGE $content`, {
                id: rid,
                content: item,
                ...variables
            }).collect();
            result = results.pop()[0];
        }
        else if (req.method == "PUT") {
            delete item.id;
            const results = await db.query(`UPSERT type::record($id) CONTENT $content`, {
                id: rid,
                content: item,
                ...variables
            }).collect();
            result = results.pop()[0];
        }
        else if (req.method == "DELETE") {
            const results = await db.query(`DELETE type::record($id)`, {
                id: rid,
                ...variables
            }).collect();
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
 */
const odataJson = (res: express.Response, data: any, status = 200) => {
    res.status(status).setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, (key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof RecordId) return value.toString();
        return value;
    }));
};

export const SurrealODataV4Middleware = (
    config: ODataExpressConfig
) => {
    const connection = config.resolveDb;
    const tables: (ODataExpressTable<any> & { _fields?: { type: string; }; })[] = config.tables;

    if (config.enableAutoTypeCasting) {
        // Experimental. TBD.
    }

    if (!connection) {
        throw new Error("No connection resolver specified");
    }

    const router: express.Router & { config: ODataExpressConfig; } = express.Router() as any;
    router.config = config;

    router.use(route(async (req, res, next) => {
        try {
            req['odata'] = parseODataRequest(req.url);
        } catch (e) {
            // Ignore parsing errors here, they will be caught later if needed
        }
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
            let _r = await db.query(query, {
                ...params,
                id: new RecordId(table, id)
            }).collect<any[][]>();
            let result = _r?.[0]?.[0];

            if (!result) {
                res.status(404).send({ error: { message: "Not Found" } });
                return;
            }

            if (typeof tableConfig.afterRecordGet == "function")
                result = await tableConfig.afterRecordGet(req, result);

            res.contentType("application/json");
            res.send(JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') return value.toString();
                if (value instanceof RecordId) return value.toString();
                return value;
            }));
            return;
        }

        let url = new URL(req.protocol + "://" + req.hostname + req.originalUrl);

        const result = await RunODataV4SelectFilter(
            db,
            table,
            url.toString(),
            tableConfig.fetch,
            req['odata'],
            config.maxPageSize
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

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result, (key, value) => {
            if (typeof value === 'bigint') return value.toString();
            if (value instanceof RecordId) return value.toString();
            return value;
        }));
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

