import * as express from 'express';
import Surreal from 'surrealdb';

export type ODataExpressHooks<T = Record<any, any>> = {
    selectQuery: (sql: string) => Promise<T[]>,
    verifyRecordId: (id: string) => boolean,
    generateRecordId: (item: T) => Promise<string> | string,

    // executeSql: (sql: string, params: any[]) => Promise<Record | Record[]>,
    // skipJSONSerialization: boolean
};

export type ODataExpressAction = "CREATE" | "READ" | "UPDATE" | "DELETE" | "ALL";


class ODataExpressTableConfig<T = unknown> {
    /**
     * The table that this configuration applies to.
     */
    table: string;
    /**
     * Optional URI segment to use instead of the table name.
     * By default it will use the table name as the URI segment.
     */
    uriSegment?: string;

    /**
     * Access control configuration for the table.
     * The roles are read from `req.session.profile.roles` which is an array of strings.
     *
     * If a user has at least one of the roles listed for the action, they are allowed to perform that action.
     * If no roles are specified for an action, it is assumed that the action is allowed for all users.
     * If an empty array is specified, the action is denied for all users.
     *
     * The `write` role encompasses `post`, `patch` and `delete` together.
     * The `all` role ensures that the user has at least one of the listed roles, for ANY of the methods.
     */
    accessControl?: {
        read?: string[],
        post?: string[],
        patch?: string[],
        delete?: string[],

        /**
         * Shorthand to specify roles that can perform write actions (post, put, patch, delete).
         */
        write?: string[];
        /**
         * Shorthand to specify roles that can perform any action (get, post, put, patch, delete).
         */
        all?: string[];
    };

    /**
     * Optional metadata to associate to the table for use in hooks etc.
     */
    tableMetadata?: any;

    // disableReadEntryEndpoint?: boolean;
    // disableReadEntriesEndpoint?: boolean;
    // disableCreateEntryEndpoint?: boolean;
    // disableCreateEntriesEndpoint?: boolean;
    // disableUpdateEntryEndpoint?: boolean;
    // disableUpdateEntriesEndpoint?: boolean;
    // disableDeleteEntryEndpoint?: boolean;
    // disableDeleteEntriesEndpoint?: boolean;

    /**
     * Hook that is called after record(s) are fetched (GET).
     * May be used to perform additional processing, logging, etc.
     */
    afterRecordGet?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are created (POST).
     */
    afterRecordPost?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are upserted (PUT).
     */
    afterRecordPut?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are updated (PATCH).
     */
    afterRecordPatch?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are deleted (DELETE).
     */
    afterRecordDelete?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are mutated (POST, PUT, PATCH, DELETE).
     */
    afterRecordMutate?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before record(s) are fetched (GET).
     * May be used to perform additional validation, logging, etc.
     */
    beforeRecordGet?: (req: express.Request) => Promise<void> | void;
    /**
     * Hook that is called before record(s) are created (POST).
     */
    beforeRecordPost?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called before record(s) are upserted (PUT).
     */
    beforeRecordPut?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called before record(s) are updated (PATCH).
     */
    beforeRecordPatch?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called before record(s) are deleted (DELETE).
     */
    beforeRecordDelete?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called before any mutation (POST, PUT, PATCH, DELETE).
     */
    beforeRecordMutate?: (req: express.Request, record: T) => Promise<T> | T;
}


/**
 * This class is a wrapper for table configurations to allow type safety.
 */
export class ODataExpressTable<T> extends ODataExpressTableConfig<T> {

    constructor(
        private readonly config: ODataExpressTableConfig<T>
    ) {
        super();
        Object.assign(this, config);
        Object.seal(this);
    }
}

export type ODataExpressConfig = {
    /**
     *
     * @param recordId
     * @returns
     */
    resolveDb: (req: express.Request) => Surreal | Promise<Surreal>,

    /**
     * The table mapping to use.
     */
    tables: ODataExpressTable<any>[]

    /**
     * Method to generate IDs for new records if no ID is provided.
     * By default it will use SurrealDB's built-in ID generation in ULID mode.
     */
    idGenerator?: (item: Record<any, any>) => Promise<string> | string,

    /**
     * Optional variables to pass to every query.
     * Can be a static object or a function that returns an object or a promise of an object.
     */
    variables?: Record<any, any> | ((req: express.Request, item: Record<any, any>) => Record<any, any> | Promise<Record<any, any>>);

    /**
     * Global hooks that apply to all tables.
     */
    // hooks?: ODataExpressHooks,
    /**
     * Default page size for $top if not specified in the query.
     */
    // defaultPageSize?: number,
    /**
     * Maximum page size for $top to prevent excessive data retrieval.
     */
    // maxPageSize?: number
};

