
import * as express from "express";
import { route } from './util';

import Surreal, { RecordId, StringRecordId } from 'surrealdb';
import { createQuery, SQLLang } from '../main';
import { Visitor } from '../visitor';

// Set restrictions on who can read/write/update on a table.
// If not present, the table will effectively have no permission
// constraints
export type ODataV4TableConfig = {
    /**
     *
     */
    [key: string]: {

        accessControl?: {
            read?: string[],
            post?: string[],
            patch?: string[],
            delete?: string[],

            // Write encompasses `post` `patch` and `delete` together.
            write?: string[];
            // Ensure that the user has at least one of the listed roles,
            // for ANY of the methods
            all?: string[];
        };

        afterGet?: (req: express.Request, record: Object) => Promise<Object> | Object;
        afterPost?: (req: express.Request, record: Object) => Promise<Object> | Object;
        afterPut?: (req: express.Request, record: Object) => Promise<Object> | Object;
        afterPatch?: (req: express.Request, record: Object) => Promise<Object> | Object;
        afterDelete?: (req: express.Request, record: Object) => Promise<Object> | Object;

        beforePost?: (req: express.Request, record: Object) => Promise<Object> | Object;
        beforePut?: (req: express.Request, record: Object) => Promise<Object> | Object;
        beforePatch?: (req: express.Request, record: Object) => Promise<Object> | Object;
        beforeDelete?: (req: express.Request, record: Object) => Promise<Object> | Object;
        beforeMutate?: (req: express.Request, record: Object) => Promise<Object> | Object;

        /**
         * PreProcess $filter strings
         */
        filterStringProcessor?: (req: express.Request, original: string) => string;
    };
};


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
 * @param req
 * @param tableConfigMap
 * @param object
 * @returns
 */
const checkObjectAccess = (req: express.Request, tableConfigMap: ODataV4TableConfig, object?: Object) => {
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

    // if (targetId && !/^[0-9A-Za-z]{20,}$/.test(targetId))
    //     throw { status: 400, message: "Invalid resource" };


    // Verify the table name is semantically valid
    if (/[^a-zA-Z0-9_-]/.test(targetTable))
        throw { status: 400, message: "Malformed target" };

    const tableConfig = tableConfigMap[targetTable];

    if (!tableConfig)
        throw { status: 404, message: "Not Found" };

    /**
     * Perform an operation access check.
     */
    if (tableConfig?.accessControl) {
        if (!req.session.profile) {
            throw { status: 403, message: "Forbidden" };
        }

        const groups = req.session.profile.roles;
        const { read, patch, delete: del, post, write, all } = tableConfig.accessControl;

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
        queryString?.includes("$order");

    const query = queryString.startsWith("?") ? queryString.slice(1) : queryString;
    const odataQuery = decodeURIComponent(query.trim());

    // Note: createQuery throws an error if there is leading or trailing whitespace on odata params
    // It also throws an error if there are query params that aren't known to the odata spec.
    // TODO: Strip unknown params instead of throwing an error?
    let {
        where, select, orderby, limit, skip, parameters
    } = hasFilter ? createQuery(odataQuery, {
        type: SQLLang.SurrealDB
    }) : {  } as Visitor;

    parameters ??= new Map();

    // Initiate a query to count the number of total records that match
    const countQuery = [
        `SELECT count() FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        'GROUP ALL'
    ].filter(i => i).join(' ');

    // Build a full query that we will throw at surreal
    const entriesQuery = [
        `SELECT ${select || '*'} FROM type::table($table)`,
        `${where ? `WHERE ${where}` : ''}`,
        (typeof orderby == "string" && orderby != '1') ? `ORDER BY ${orderby}` : '',
        typeof limit == "number" ? `LIMIT ${limit}` : '',
        typeof skip == "number" ? `START ${skip}` : ''
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

export const RunODataV4SelectFilter = async (
    db: Surreal,
    table: string,
    urlPath: string
) => {
    let {
        countQuery,
        entriesQuery,
        parameters,
        skip,
        limit
    } = await ODataV4ToSurrealQL(
        table,
        urlPath
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
    // // Rip off the path to prevent the base url from being contaminated.
    // const qParams = urlPath.includes("?") ? '' : urlPath.split("?").pop();
    // const pars = new URLSearchParams(qParams);
    url.searchParams.set('$skip', skip + data.length as any);
    url.searchParams.set('$top', pageSize as any);

    // const metadata = includeMetadata
    //     ? undefined
    //     : await db.query(`INFO FOR TABLE ${table}`);

    const entriesRead = limit + skip;
    return {
        // '@odata.metadata': metadata,
        // '@odata.context': `${url.pathname}$metadata#${table}`,
        '@odata.count': count ?? data.length ?? 0,
        '@odata.nextlink': (entriesRead) > (count as number)
            ? undefined
            : `${url.pathname}?${url.searchParams.toString()}`,
        value: data
    };
};


const ODataCRUDMethods = async (
    connection: Surreal,
    tableConfigMap: ODataV4TableConfig,
    req: express.Request,
    idGenerator?: (item: any) => string
) => {
    const isBulk = Array.isArray(req.body);
    const beforeMethod = 'before' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);
    const afterMethod = 'after' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);

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

    // If there is a preprocessor, apply it on all records to be inserted.
    items = await Promise.all(items.map(async item => {
        const { id, table, tableConfig } = checkObjectAccess(req, tableConfigMap, item);

        if (typeof tableConfig[beforeMethod] == "function") {
            item = await tableConfig[beforeMethod](req, item);
        }

        // Support a generic mutate handler
        if (["POST", "PUT", "PATCH"].includes(req.method) && tableConfig.beforeMutate) {
            item = await tableConfig.beforeMutate(req, item) as any;
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

        if (req['_auditUserOverride']) {
            db.let("fiq.user", req['_auditUserOverride']);
        }
        else {
            db.let("fiq.user", req.session.userInfo.email);
        }

        const rid = id == null ? null : new RecordId(table, id);
        let result;
        if (req.method == "POST") {
            const id = new RecordId(table, idGenerator(item));
            delete item.id;
            delete item['history'];
            result = await db.create(id, item);
        }
        else if (req.method == "PATCH") {
            item.id = new StringRecordId(item.id) as any;
            delete item['history'];
            result = await db.merge(rid, item);
        }
        else if (req.method == "PUT") {
            delete item.id;
            item['history'] = item['history']?.map(h => new StringRecordId(h));
            result = await db.upsert(rid, item);
        }
        else if (req.method == "DELETE") {
            result = await db.delete(rid);
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
    results = await Promise.all(results.map(r => {
        const {
            result,
            accessResult
        } = r;

        if (typeof accessResult.tableConfig[afterMethod] == "function") {
            accessResult.tableConfig[afterMethod](req, r);
        }
        return r;
    }));


    if (isBulk) {
        results = results.filter(r => r !== undefined);
        if (results.length == 0) {
            // TODO: Should we do anything special here?
        }
        return results;
    }
    else {
        return results[0];
    }
};

export const SurrealODataV4Middleware = (
    tableConfigMap: ODataV4TableConfig,
    connection: Surreal | ((req: express.Request) => Promise<Surreal> | Surreal),
) => {

    const router = express.Router();

    router.use(route(async (req, res, next) => {
        req.db = connection instanceof Surreal ? connection : await connection(req);
        next();
    }));

    /**
     * Metadata endpoint must be first
     * TODO: actually match odata spec
     */
    // router.get('/$metadata#:table', route(async (req, res, next) => {
    //     const table = req['_table'] as string;
    //     const db = req.db as Surreal;

    //     if (!table) {
    //         throw { status: 400, message: "Table not specified" };
    //     }

    //     const schemaFields = Object.keys((
    //         (await db.query(`INFO FOR TABLE ` + table))[0][0].result as any)?.fd
    //     );
    //     res.send(schemaFields);
    // }));

    /**
     *
     */
    router.use(route(async (req, res, next) => {
        if (req.method != "GET") return next();
        const db = req.db as Surreal;

        const { tableConfig, table, id } = checkObjectAccess(req, tableConfigMap);

        // If the target includes a colon, then we're acting on 1 record
        if (id) {
            let _r = await db.query<[[any]]>(`SELECT * FROM $id`, {
                id: new RecordId(table, id)
            });
            let [[result]] = _r;

            if (typeof tableConfig.afterGet == "function")
                result = await tableConfig.afterGet(req, result);

            if (!result) {
                // 404?
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

        if (tableConfig.filterStringProcessor) {
            const query = tableConfig.filterStringProcessor(req, url.searchParams['$filter'] || '');
            url.search = query;
        }

        const result = await RunODataV4SelectFilter(
            db,
            table,
            url.toString()
        );

        if (typeof tableConfig.afterGet == "function") {
            for (let i = 0; i < result.value.length; i++) {
                const item = result.value[i];
                result.value[i] = await tableConfig.afterGet(req, item);
            }
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
        const db = req.db as Surreal;

        const result = await ODataCRUDMethods(db, tableConfigMap, req);
        res.send(Array.isArray(result) ? result.map(r => r.result) : result.result);
    }));

    return router;
}

