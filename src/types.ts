import * as express from 'express';
import type { Surreal } from 'surrealdb';
import { Visitor } from './parser/visitor';

export type ODataGlobalHooks<T = any> = {
    /**
     * Hook that is called before record(s) are fetched (GET).
     */
    beforeRecordGet?: (req: express.Request) => Promise<void> | void;
    /**
     * Hook that is called after record(s) are fetched (GET).
     */
    afterRecordGet?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before record(s) are created (POST).
     */
    beforeRecordPost?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are created (POST).
     */
    afterRecordPost?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before record(s) are upserted (PUT).
     */
    beforeRecordPut?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are upserted (PUT).
     */
    afterRecordPut?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before record(s) are updated (PATCH).
     */
    beforeRecordPatch?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are updated (PATCH).
     */
    afterRecordPatch?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before record(s) are deleted (DELETE).
     */
    beforeRecordDelete?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are deleted (DELETE).
     */
    afterRecordDelete?: (req: express.Request, record: T) => Promise<T> | T;

    /**
     * Hook that is called before any mutation (POST, PUT, PATCH, DELETE).
     */
    beforeRecordMutate?: (req: express.Request, record: T) => Promise<T> | T;
    /**
     * Hook that is called after record(s) are mutated (POST, PUT, PATCH, DELETE).
     */
    afterRecordMutate?: (req: express.Request, record: T) => Promise<T> | T;
};

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
     * Optional fetch expression to use for all GET queries on this table.
     * Example: "SELECT * FROM test FETCH author, comments"
     */
    fetch?: string | string[];

    /**
     * Access control configuration for the table.
     * The roles are read from `req.session.profile.roles` which should be an array of strings.
     *
     * If a user has at least one of the roles listed for the action, they are allowed to perform that action.
     * If an empty array is specified, the action is denied for all users.
     * If the value is set to null or undefined, the action will be allowed for all users.
     *
     * The `write` role encompasses `post`, `patch` and `delete` together.
     * The `all` role ensures that the user has at least one of the listed roles, for any method.
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

        /**
         * Field-level access control: specify which roles can read specific fields.
         * Fields not listed are accessible to all users with table read permission.
         * Example: { password: ['admin'], ssn: ['admin', 'hr'] }
         */
        restrictedFields?: {
            [fieldName: string]: string[];  // roles that can read this field
        };
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
     * Row-level security filter: Inject additional WHERE clause conditions based on user context.
     * This is useful for multi-tenant apps or restricting users to their own data.
     * Example: (req) => ({ partial: `ownerId = $ownerId`, parameters: { ownerId: req.session.userId } })
     * The returned string will be AND'd with the user's $filter query.
     */
    rowLevelFilter?: (req: express.Request) => string | { partial: string, parameters: Record<string, any>; };

    /**
     * Whitelist of fields allowed in $orderby to prevent field enumeration attacks.
     * If specified, only these fields can be used in $orderby clauses.
     * If not specified, all fields are allowed (default behavior).
     */
    allowedOrderByFields?: string[];

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
     * Function to resolve the SurrealDB instance to use for each request.
     * @param recordId
     * @returns
     */
    resolveDb: (req: express.Request) => Surreal | Promise<Surreal>,

    /**
     * The tables to create endpoints for.
     */
    tables: ODataExpressTable<any>[];

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
    hooks?: ODataGlobalHooks;

    /**
     * Maximum page size for $top to prevent excessive data retrieval.
     * Default: 500
     */
    maxPageSize?: number;

    /**
     * Maximum depth of nested $expand clauses to prevent stack overflow/DoS.
     * Default: 5
     */
    maxExpandDepth?: number;

    /**
     * Maximum total number of expanded items in a single request.
     * Default: 10
     */
    maxExpandCount?: number;

    /**
     * Maximum value for $skip to prevent excessive seek operations.
     * Default: 1000000
     */
    maxSkip?: number;
};


export interface ParsedQuery {
    select?: string;
    where?: string;
    orderby?: string;
    groupby?: string;
    limit?: number;
    skip?: number;
    includes?: Visitor[];
    format?: string;
    count?: boolean;
    skipToken?: string;
    search?: string;
    parameters?: Map<string, any>;
}


