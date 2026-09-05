
export enum SQLLang {
    ANSI,
    MsSql,
    MySql,
    PostgreSql,
    Oracle,
    SurrealDB,
    NodeSqlite
}

export interface SqlOptions {
    useParameters?: boolean;
    type?: SQLLang;
    maxExpandDepth?: number;
    maxExpandCount?: number;
    maxPageSize?: number;
    maxSkip?: number;
    maxParameters?: number;
    enableSearch?: boolean;
    fieldAliases?: Record<string, string>;
}
