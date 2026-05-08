import * as express from "express";
import { route } from './util';

import { Decimal, Duration, RecordId, Surreal, Table, Uuid } from 'surrealdb';
import { createQuery, SQLLang, type SqlOptions } from '../parser/main';
import { renderQuery } from '../parser/query-renderer';
import { ODataV4ParseError } from '../parser/utils';
import type { ODataExpressConfig, ODataExpressTable, ParsedQuery } from '../types';
import { getJSONSchema, getODataMetadata } from '../util/metadata';


const removeBlockedFields = (record: any, blockedFields: string[]) => {
    if (!record || typeof record !== 'object') return;

    for (const field of blockedFields) {
        const parts = field.split('.');
        let current = record;

        for (let i = 0; i < parts.length - 1; i++) {
            if (current && typeof current === 'object') {
                current = current[parts[i]];
            } else {
                current = undefined;
                break;
            }
        }

        if (current && typeof current === 'object') {
            delete current[parts[parts.length - 1]];
        }
    }
    return record;
};


/**
 * Keep only the allowed fields in the record, supporting dot-separated paths.
 */
const keepAllowedFields = (record: any, allowedPaths: string[]) => {
    if (!record || typeof record !== 'object' || !Array.isArray(allowedPaths) || allowedPaths.length === 0) return record;

    const result: any = Array.isArray(record) ? [] : {};

    const assignPath = (target: any, source: any, path: string[]) => {
        let curTarget = target;
        let curSource = source;
        for (let i = 0; i < path.length; i++) {
            if (curSource == null) return;
            const key = path[i];
            if (i === path.length - 1) {
                if (curSource && Object.prototype.hasOwnProperty.call(curSource, key)) {
                    if (Array.isArray(curTarget)) {
                        // Not expected for arrays at root; skip
                    } else {
                        curTarget[key] = curSource[key];
                    }
                }
            } else {
                if (!curSource || typeof curSource[key] !== 'object') return;
                if (Array.isArray(curSource[key])) {
                    // Copy arrays wholesale when path points to an array container
                    curTarget[key] = curSource[key].map((item: any) => ({ ...item }));
                    return;
                }
                curTarget[key] = curTarget[key] || {};
                curTarget = curTarget[key];
                curSource = curSource[key];
            }
        }
    };

    for (const p of allowedPaths) {
        const parts = p.split('.').filter(Boolean);
        if (parts.length === 0) continue;
        assignPath(result, record, parts);
    }

    return result;
};

/**
 * Transform field values based on fieldTypes configuration to SurrealDB primitives.
 * Supports: datetime, date, duration, decimal, uuid, record, table
 */
const transformFieldTypes = (
    record: any,
    fieldTypes: Record<string, 'datetime' | 'date' | 'duration' | 'decimal' | 'uuid' | 'record' | 'table'>
) => {
    if (!record || typeof record !== 'object' || !fieldTypes) return record;

    for (const [fieldPath, type] of Object.entries(fieldTypes)) {
        const parts = fieldPath.split('.');
        let current = record;

        // Navigate to the parent object
        for (let i = 0; i < parts.length - 1; i++) {
            if (current && typeof current === 'object') {
                current = current[parts[i]];
            } else {
                current = undefined;
                break;
            }
        }

        if (!current || typeof current !== 'object') continue;

        const fieldName = parts[parts.length - 1];
        const value = current[fieldName];

        // Skip if field doesn't exist or is null/undefined
        if (value === null || value === undefined) continue;

        try {
            switch (type) {
                case 'datetime':
                case 'date':
                    // Convert string/number to Date object - SurrealDB SDK handles Date serialization
                    current[fieldName] = new Date(value);
                    break;

                case 'duration':
                    // Convert string to Duration - SDK handles Duration serialization
                    current[fieldName] = new Duration(value);
                    break;

                case 'decimal':
                    // Convert string/number to Decimal - SDK handles Decimal serialization
                    current[fieldName] = new Decimal(value);
                    break;

                case 'uuid':
                    // Convert string to Uuid - SDK handles Uuid serialization
                    current[fieldName] = new Uuid(value);
                    break;

                case 'record':
                    // Convert string to RecordId - SDK handles RecordId serialization
                    if (typeof value === 'string') {
                        const [table, id] = value.split(':');
                        if (table && id) {
                            current[fieldName] = new RecordId(table, id);
                        }
                    }
                    break;

                case 'table':
                    // Convert string to Table - SDK handles Table serialization
                    current[fieldName] = new Table(value);
                    break;
            }
        } catch (error) {
            // Log error but don't fail the entire operation
            console.error(`Failed to transform field ${fieldPath} to type ${type}:`, error);
            console.error(`Value was:`, value);
            console.error(`Error details:`, error);
        }
    }

    return record;
};

const formatTimeoutValue = (timeout: string | number) => {
    if (timeout == null) return undefined;
    if (typeof timeout === 'number') return `${timeout}ms`;

    // Check if it's already in a valid format (e.g., "5s", "1000ms")
    const trimmed = timeout.trim();
    // As of 3.0.0 these do not support decimals.
    if (/^\d+(ns|µs|us|ms|s|m|h|d)$/.test(trimmed)) {
        return trimmed;
    }

    throw new Error(`Invalid timeout value: ${timeout}`);
};

const withTimeout = (sql: string, timeout: string | number) => {
    if (!timeout) return sql;

    const timeoutSafe = formatTimeoutValue(timeout);
    return `${sql} TIMEOUT ${timeoutSafe}`;
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
    urlPath: string,
    options?: SqlOptions
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
        type: SQLLang.SurrealDB,
        ...options
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
    fetch = [] as string | string[],
    options?: SqlOptions,
    customSelect?: Record<string, string>
) => {
    const parsed = typeof urlPath === 'string'
        ? parseODataRequest(urlPath, options)
        : urlPath;

    return {
        ...parsed,
        ...renderQuery(parsed, table, fetch, false, customSelect)
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
    options?: { maxPageSize?: number; timeout?: string | number; customSelect?: Record<string, string>; } & SqlOptions
) => {

    // Ensure we have a parsed query object
    if (!parsed) {
        parsed = parseODataRequest(urlPath, options);
    }

    // Apply maxPageSize - server-driven limit
    if (options?.maxPageSize !== undefined && options.maxPageSize > 0) {
        if (parsed.limit === undefined || parsed.limit > options.maxPageSize) {
            parsed.limit = options.maxPageSize;
        }
    }

    const converterResult = await ODataV4ToSurrealQL(
        table,
        parsed,
        fetch,
        options,
        options?.customSelect
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
            db.query(withTimeout(countQuery.toString(), options?.timeout), parameters).collect<any[]>(),
            db.query(withTimeout(entriesQuery.toString(), options?.timeout), parameters).collect<any[]>()
        ]);

        // SurrealDB's returns an array of result arrays, one for each query.
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


export const ODataCRUDMethods = async (
    connection: Surreal,
    config: ODataExpressConfig,
    req: express.Request
) => {
    let {
        tables,
        idGenerator,
        hooks
    } = config;

    const isBulk = Array.isArray(req.body);
    const beforeMethod = 'beforeRecord' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);
    const afterMethod = 'afterRecord' + req.method.slice(0, 1) + req.method.toLowerCase().slice(1);

    const accessResult = Symbol("private");

    let items: {
        id: string,
        [accessResult]: ReturnType<typeof checkObjectAccess>;
    }[] = isBulk ? req.body : [req.body];

    if (req.method === "DELETE" && !req.body) {
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

        if (typeof hooks?.[beforeMethod] === "function") {
            await hooks[beforeMethod](req, item);
        }

        if (typeof tableConfig[beforeMethod] === "function") {
            item = await tableConfig[beforeMethod](req, item);
        }

        // Support a generic mutate handler
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
            if (typeof hooks?.beforeRecordMutate === "function") {
                await hooks.beforeRecordMutate(req, item);
            }
            if (typeof tableConfig.beforeRecordMutate === "function") {
                item = await tableConfig.beforeRecordMutate(req, item) as any;
            }
        }

        item[accessResult] = {
            id, table, tableConfig
        };
        return item;
    }));

    // Get all of the data
    let results = await Promise.all(items.map(async (item) => {
        const { id, table, tableConfig } = item[accessResult];
        const db = connection;

        const rid = id == null ? null : new RecordId(table, id);

        const variables = await (
            typeof config.variables === 'function'
                ? config.variables(req, item)
                : config.variables
        ) || [];

        const timeout = tableConfig.timeout ?? config.timeout;

        idGenerator ??= async () => {
            return db.query<[string]>('RETURN rand::ulid().lowercase()')
                .then(r => r[0]);
        };

        let result;
        if (req.method === "POST") {
            const newId = new RecordId(table, await idGenerator(item));
            delete item.id;

            // Apply field type transformations if configured
            if (tableConfig.fieldTypes) {
                transformFieldTypes(item, tableConfig.fieldTypes);
            }

            if (typeof tableConfig.postHandler === 'function') {
                result = await tableConfig.postHandler(req, db, { ...item, id: newId });
            } else {
                const results = await db.query(withTimeout(`CREATE type::record($id) CONTENT $content`, timeout), {
                    id: newId,
                    content: item,
                    ...variables
                }).collect();
                const popped = results.pop();
                result = Array.isArray(popped) && popped.length > 0 ? popped[0] : null;
            }
        }
        else if (req.method === "PATCH") {
            // if (!item.id) {
            //     throw { status: 400, message: "ID is required in body for PATCH" };
            // }

            delete item.id;

            // Apply field type transformations if configured
            if (tableConfig.fieldTypes) {
                transformFieldTypes(item, tableConfig.fieldTypes);
            }

            if (typeof tableConfig.patchHandler === 'function') {
                result = await tableConfig.patchHandler(req, db, { ...item, id: rid });
            } else {
                const results = await db.query(withTimeout(`UPDATE type::record($id) MERGE $content`, timeout), {
                    id: rid,
                    content: item,
                    ...variables
                }).collect();
                result = results.pop()[0];
            }
        }
        else if (req.method === "PUT") {
            delete item.id;

            // Apply field type transformations if configured
            if (tableConfig.fieldTypes) {
                transformFieldTypes(item, tableConfig.fieldTypes);
            }

            const results = await db.query(withTimeout(`UPSERT type::record($id) CONTENT $content`, timeout), {
                id: rid,
                content: item,
                ...variables
            }).collect();
            result = results.pop()[0];
        }
        else if (req.method === "DELETE") {
            if (typeof tableConfig.deleteHandler === 'function') {
                result = await tableConfig.deleteHandler(req, db, { id: rid } as any);
            } else {
                const results = await db.query(withTimeout(`DELETE type::record($id)`, timeout), {
                    id: rid,
                    ...variables
                }).collect();
                result = results.pop()[0];
            }
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
            if (typeof accessResult.tableConfig.afterRecordMutate === "function") {
                await accessResult.tableConfig.afterRecordMutate(req, result);
            }
            if (typeof hooks?.afterRecordMutate === "function") {
                await hooks.afterRecordMutate(req, result);
            }
        }
        if (typeof accessResult.tableConfig[afterMethod] === "function") {
            await accessResult.tableConfig[afterMethod](req, result);
        }
        if (typeof hooks?.[afterMethod] === "function") {
            await hooks[afterMethod](req, result);
        }

        return r;
    }));


    if (isBulk) {
        if (config.tables) {
            results.forEach(r => {
                if (r?.accessResult?.tableConfig?.blockedFields) {
                    removeBlockedFields(r.result, r.accessResult.tableConfig.blockedFields);
                }
                if (r?.accessResult?.tableConfig?.allowedFieldPaths && r.accessResult.tableConfig.allowedFieldPaths.length > 0) {
                    r.result = keepAllowedFields(r.result, r.accessResult.tableConfig.allowedFieldPaths);
                }
            });
        }

        // Apply responseFormatter if configured (table level takes precedence)
        results = await Promise.all(results.map(async r => {
            if (r?.accessResult?.tableConfig?.responseFormatter) {
                r.result = await r.accessResult.tableConfig.responseFormatter(req, r.result);
            }
            if (r?.result !== undefined && config.hooks?.responseFormatter) {
                r.result = await config.hooks.responseFormatter(req, r.result);
            }
            return r;
        }));

        results = results.filter(r => !!r && r.result !== undefined);
        return results;
    }
    else {
        if (results[0]?.accessResult?.tableConfig?.blockedFields) {
            removeBlockedFields(results[0].result, results[0].accessResult.tableConfig.blockedFields);
        }
        if (results[0]?.accessResult?.tableConfig?.allowedFieldPaths && results[0].accessResult.tableConfig.allowedFieldPaths.length > 0) {
            results[0].result = keepAllowedFields(results[0].result, results[0].accessResult.tableConfig.allowedFieldPaths);
        }

        // Apply responseFormatter if configured (table level takes precedence)
        if (results[0]?.accessResult?.tableConfig?.responseFormatter) {
            results[0].result = await results[0].accessResult.tableConfig.responseFormatter(req, results[0].result);
        }
        if (results[0]?.result !== undefined && config.hooks?.responseFormatter) {
            results[0].result = await config.hooks.responseFormatter(req, results[0].result);
        }

        return results[0];
    }
};

export const SurrealODataV4Middleware = (
    config: ODataExpressConfig
) => {
    const connection = config.resolveDb;
    const tables: (ODataExpressTable<any> & { _fields?: { type: string; }; })[] = config.tables;
    const $odata = Symbol("odata");
    const $db = Symbol("db");

    if (!connection) {
        throw new Error("No connection resolver specified");
    }

    const router: express.Router & { config: ODataExpressConfig; } = express.Router() as any;
    router.config = config;

    router.use(route(async (req, res, next) => {
        try {
            req[$odata] = parseODataRequest(req.url);
        } catch (e) {
            // Ignore parsing errors here, they will be caught later if needed
        }
        req[$db] = connection instanceof Surreal ? connection : await connection(req);
        next();
    }));

    /**
     * OData Metadata Endpoint
     */
    router.get('/$metadata#:table', route(async (req, res, next) => {
        const db = req[$db] as Surreal;
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
        const db = req[$db] as Surreal;
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
        const db = req[$db] as Surreal;

        const { tableConfig, table, id } = checkObjectAccess(req, tables);

        if (typeof config.hooks?.beforeRecordGet === "function") {
            await config.hooks.beforeRecordGet(req);
        }

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
            const tmo = tableConfig.timeout ?? router.config.timeout;
            let result;
            if (typeof tableConfig.getHandler === 'function') {
                result = await tableConfig.getHandler(req, db, { id: new RecordId(table, id) } as any);
            } else {
                let _r = await db.query(withTimeout(query, tmo), {
                    ...params,
                    id: new RecordId(table, id)
                }).collect<any[][]>();
                result = _r?.[0]?.[0];
            }

            if (!result) {
                res.status(404).send({ error: { message: "Not Found" } });
                return;
            }

            if (typeof tableConfig.afterRecordGet === "function")
                result = await tableConfig.afterRecordGet(req, result);

            if (typeof config.hooks?.afterRecordGet === "function")
                result = await config.hooks.afterRecordGet(req, result);

            // Filter restricted fields based on user roles
            if (tableConfig.accessControl?.restrictedFields) {
                const userRoles = req['session']?.profile?.roles ?? [];
                const restrictedFields = tableConfig.accessControl.restrictedFields;

                for (const [fieldName, allowedRoles] of Object.entries(restrictedFields)) {
                    const hasAccess = allowedRoles.some(role => userRoles.includes(role));
                    if (!hasAccess) {
                        delete result[fieldName];
                    }
                }
            }

            // Filter blocked fields
            if (tableConfig.blockedFields) {
                removeBlockedFields(result, tableConfig.blockedFields);
            }

            // Apply allowed field paths if configured
            if (tableConfig.allowedFieldPaths && tableConfig.allowedFieldPaths.length > 0) {
                result = keepAllowedFields(result, tableConfig.allowedFieldPaths);
            }

            // Apply responseFormatter if configured (table level takes precedence)
            if (typeof tableConfig.responseFormatter === 'function') {
                result = await tableConfig.responseFormatter(req, result);
            }
            if (result !== undefined && typeof config.hooks?.responseFormatter === 'function') {
                result = await config.hooks.responseFormatter(req, result);
            }

            if (result === undefined) {
                res.status(404).send({ error: { message: "Not Found" } });
                return;
            }

            res.contentType("application/json");
            res.send(JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') return value.toString();
                if (value instanceof RecordId) return value.toString();
                return value;
            }));
            return;
        }

        let url = new URL(req.protocol + "://" + req.hostname + req.originalUrl);

        // Validate $orderby fields if allowedOrderByFields is configured
        if (tableConfig.allowedOrderByFields && req[$odata]?.orderby) {
            // Extract field names from orderby string
            const orderbyFields = req[$odata].orderby
                .split(',')
                .map((f: string) => f.trim().split(/\s+/)[0]); // Get field name, strip ASC/DESC

            const invalidFields = orderbyFields.filter(
                (field: string) => !tableConfig.allowedOrderByFields.includes(field)
            );

            if (invalidFields.length > 0) {
                throw new ODataV4ParseError({
                    msg: `Invalid $orderby field(s): ${invalidFields.join(', ')}. Allowed fields: ${tableConfig.allowedOrderByFields.join(', ')}`
                });
            }
        }

        // Re-parse the query with fieldAliases if configured
        let parsedQuery = req[$odata];
        if (tableConfig.fieldAliases) {
            parsedQuery = parseODataRequest(url.toString(), {
                fieldAliases: tableConfig.fieldAliases
            });
        }

        // Inject row-level filter if configured
        if (typeof tableConfig.rowLevelFilter === 'function') {
            const rowFilter = await (async () => {
                const filterResult = tableConfig.rowLevelFilter(req);
                return filterResult;
            })();

            let additionalWhere: string;
            let additionalParams: Record<string, any> = {};

            if (typeof rowFilter === 'string') {
                additionalWhere = rowFilter;
            }
            else {
                additionalWhere = rowFilter.partial;
                additionalParams = rowFilter.parameters || {};
            }

            // Merge row-level filter with user's $filter
            if (parsedQuery.where) {
                parsedQuery.where = `(${parsedQuery.where}) AND (${additionalWhere})`;
            }
            else {
                parsedQuery.where = additionalWhere;
            }

            // Merge parameters
            for (const [key, value] of Object.entries(additionalParams)) {
                parsedQuery.parameters.set(key, value);
            }
        }

        const result = await RunODataV4SelectFilter(
            db,
            table,
            url.toString(),
            tableConfig.fetch,
            parsedQuery,
            {
                ...config,
                fieldAliases: tableConfig.fieldAliases,
                customSelect: tableConfig.customSelect
            }
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

        if (typeof config.hooks?.afterRecordGet === "function") {
            const batchSize = 10;
            const processedValues = [];

            for (let i = 0; i < result.value.length; i += batchSize) {
                const batch = result.value.slice(i, i + batchSize);
                const processedBatch = await Promise.all(batch.map(v => config.hooks!.afterRecordGet!(req, v)));
                processedValues.push(...processedBatch);
            }
            result.value = processedValues;
        }

        // Filter restricted fields based on user roles
        if (tableConfig.accessControl?.restrictedFields) {
            const userRoles = req['session']?.profile?.roles ?? [];
            const restrictedFields = tableConfig.accessControl.restrictedFields;

            result.value = result.value.map(record => {
                const filteredRecord = { ...record };

                for (const [fieldName, allowedRoles] of Object.entries(restrictedFields)) {
                    const hasAccess = allowedRoles.some(role => userRoles.includes(role));
                    if (!hasAccess) {
                        delete filteredRecord[fieldName];
                    }
                }

                return filteredRecord;
            });
        }

        // Filter blocked fields
        if (tableConfig.blockedFields) {
            result.value.forEach(record => removeBlockedFields(record, tableConfig.blockedFields!));
        }

        // Apply allowed field paths if configured
        if (tableConfig.allowedFieldPaths && tableConfig.allowedFieldPaths.length > 0) {
            result.value = result.value.map(record => keepAllowedFields(record, tableConfig.allowedFieldPaths!));
        }

        // Apply responseFormatter if configured (table level takes precedence)
        if (typeof tableConfig.responseFormatter === 'function') {
            const batchSize = 10;
            const processedValues = [];
            for (let i = 0; i < result.value.length; i += batchSize) {
                const batch = result.value.slice(i, i + batchSize);
                const processedBatch = await Promise.all(
                    batch.map(v => tableConfig.responseFormatter!(req, v))
                );
                processedValues.push(...processedBatch.filter(v => v !== undefined));
            }
            result.value = processedValues;
        }
        if (typeof config.hooks?.responseFormatter === 'function') {
            const batchSize = 10;
            const processedValues = [];
            for (let i = 0; i < result.value.length; i += batchSize) {
                const batch = result.value.slice(i, i + batchSize);
                const processedBatch = await Promise.all(
                    batch.map(v => config.hooks!.responseFormatter!(req, v))
                );
                processedValues.push(...processedBatch.filter(v => v !== undefined));
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
        const db = req[$db] as Surreal;

        const result = await ODataCRUDMethods(db, config, req);
        res.send(Array.isArray(result) ? result.map(r => r.result) : result.result);
    }));

    // Error handler for parsing errors
    router.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err instanceof ODataV4ParseError || (err.message && err.message.startsWith("ODataV4ParseError"))) {
            res.status(400).send({ error: { message: err.message } });
        }
        else if (err.status) {
            res.status(err.status).send({ error: { message: err.message } });
        }
        else {
            next(err);
        }
    });

    return router;
}

