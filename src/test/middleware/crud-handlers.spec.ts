import { describe, expect, mock, test } from "bun:test";
import express from "express";
import request from "supertest";
import { RecordId, Surreal } from "surrealdb";
import { SurrealODataV4Middleware } from "../../express/odata-middleware";
import { ODataExpressConfig, ODataExpressTable } from "../../express/types";

function setupApp(tableConfig: ConstructorParameters<typeof ODataExpressTable>[0], idGenerator: ODataExpressConfig["idGenerator"] = () => "gen_id") {
    const mockDb = new Surreal();
    const config: ODataExpressConfig = {
        resolveDb: () => mockDb,
        tables: [new ODataExpressTable(tableConfig)],
        idGenerator
    };
    const app = express();
    app.use(express.json());
    app.use("/odata", SurrealODataV4Middleware(config));
    return { app, mockDb, config };
}

describe("Table-level CRUD Handlers", () => {

    // -------------------------------------------------------------------------
    describe("getHandler", () => {

        test("replaces default DB query for single-record GET", async () => {
            const queryMock = mock(() => ({ collect: async () => [[]] }));
            const getHandler = mock(async () => ({ id: "users:foo", name: "Custom Alice" }));

            const { app, mockDb } = setupApp({ table: "users", getHandler });
            mockDb.query = queryMock as any;

            const res = await request(app).get("/odata/users:foo");

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Custom Alice");
            expect(queryMock).not.toHaveBeenCalled();
            expect(getHandler).toHaveBeenCalledTimes(1);
        });

        test("passes req, db, and { id: RecordId } to getHandler", async () => {
            let capturedArgs: any[] = [];
            const getHandler = mock(async (req: any, db: any, record: any) => {
                capturedArgs = [req, db, record];
                return { id: "users:abc", name: "Test" };
            });

            const { app, mockDb } = setupApp({ table: "users", getHandler });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).get("/odata/users:abc");

            const record = capturedArgs[2];
            expect(record).toBeDefined();
            expect(record.id).toBeInstanceOf(RecordId);
            expect(String(record.id.table)).toBe("users");
        });

        test("returns 404 when getHandler returns null", async () => {
            const { app, mockDb } = setupApp({
                table: "users",
                getHandler: async () => null
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/users:missing");
            expect(res.status).toBe(404);
        });

        test("afterRecordGet hook still runs after getHandler", async () => {
            const afterGet = mock((_req: any, record: any) => ({ ...record, modified: true }));
            const getHandler = mock(async () => ({ id: "users:foo", name: "Alice" }));

            const { app, mockDb } = setupApp({
                table: "users",
                getHandler,
                afterRecordGet: afterGet
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/users:foo");

            expect(res.status).toBe(200);
            expect(res.body.modified).toBe(true);
            expect(afterGet).toHaveBeenCalledTimes(1);
        });

        test("does not invoke getHandler for list GET (no id in URL)", async () => {
            const queryMock = mock((q: string) => ({
                collect: async () => q.includes("count()") ? [[{ count: 0 }]] : [[]]
            }));
            const getHandler = mock(async () => ({ id: "users:foo", name: "Should Not Run" }));

            const { app, mockDb } = setupApp({ table: "users", getHandler });
            mockDb.query = queryMock as any;

            const res = await request(app).get("/odata/users");

            expect(res.status).toBe(200);
            expect(getHandler).not.toHaveBeenCalled();
            expect(queryMock).toHaveBeenCalled();
        });

        test("applies rowLevelFilter to single-record GET query", async () => {
            let capturedQuery = "";
            let capturedParams: any;
            const mockDb: any = {
                query: mock((q: string, params: any) => {
                    capturedQuery = q;
                    capturedParams = params;
                    return { collect: async () => [[]] };
                })
            };

            const config: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [new ODataExpressTable({
                    table: "users",
                    rowLevelFilter: () => ({ partial: `ownerId = $ownerId`, parameters: { ownerId: "user123" } })
                })],
                idGenerator: () => "gen_id"
            };
            const app = express();
            app.use(express.json());
            app.use("/odata", SurrealODataV4Middleware(config));

            await request(app).get("/odata/users:foo");

            expect(mockDb.query).toHaveBeenCalled();
            // The single-record query must include the row-level filter as a WHERE clause
            expect(capturedQuery).toContain("SELECT * FROM $id");
            expect(capturedQuery).toContain("WHERE");
            expect(capturedQuery).toContain("ownerId = $ownerId");
            // The filter parameters must be merged into the query params
            expect(capturedParams.ownerId).toBe("user123");
        });

        test("returns 404 when single-record GET is blocked by rowLevelFilter", async () => {
            // Simulate the DB returning no rows because the row-level filter
            // excluded the requested record.
            let capturedQuery = "";
            const mockDb: any = {
                query: mock((q: string) => {
                    capturedQuery = q;
                    return { collect: async () => [[]] };
                })
            };

            const config: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [new ODataExpressTable({
                    table: "users",
                    rowLevelFilter: () => `ownerId = 'user123'`
                })],
                idGenerator: () => "gen_id"
            };
            const app = express();
            app.use(express.json());
            app.use("/odata", SurrealODataV4Middleware(config));

            const res = await request(app).get("/odata/users:foo");

            expect(res.status).toBe(404);
            // Confirm the WHERE clause was actually applied to the query
            expect(capturedQuery).toContain("WHERE");
            expect(capturedQuery).toContain("ownerId = 'user123'");
        });

        test("rowLevelFilter does not interfere when not configured for single-record GET", async () => {
            let capturedQuery = "";
            const mockDb: any = {
                query: mock((q: string) => {
                    capturedQuery = q;
                    return { collect: async () => [[{ id: "users:foo", name: "Alice" }]] };
                })
            };

            const config: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [new ODataExpressTable({ table: "users" })],
                idGenerator: () => "gen_id"
            };
            const app = express();
            app.use(express.json());
            app.use("/odata", SurrealODataV4Middleware(config));

            const res = await request(app).get("/odata/users:foo");

            expect(res.status).toBe(200);
            expect(capturedQuery).toContain("SELECT * FROM $id");
            expect(capturedQuery).not.toContain("WHERE");
        });
    });

    // -------------------------------------------------------------------------
    describe("postHandler", () => {

        test("replaces default DB CREATE for POST", async () => {
            const queryMock = mock(() => ({ collect: async () => [[]] }));
            const postHandler = mock(async () => ({ id: "users:gen_id", name: "Custom Created" }));

            const { app, mockDb } = setupApp({ table: "users", postHandler });
            mockDb.query = queryMock as any;

            const res = await request(app).post("/odata/users").send({ name: "Alice" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Custom Created");
            expect(queryMock).not.toHaveBeenCalled();
            expect(postHandler).toHaveBeenCalledTimes(1);
        });

        test("passes req, db, and record content with generated RecordId to postHandler", async () => {
            let capturedRecord: any;
            const postHandler = mock(async (_req: any, _db: any, record: any) => {
                capturedRecord = record;
                return record;
            });

            const { app, mockDb } = setupApp({ table: "users", postHandler }, () => "newid");
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).post("/odata/users").send({ name: "Bob", age: 30 });

            expect(capturedRecord).toBeDefined();
            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("users");
            expect(capturedRecord.id.id).toBe("newid");
            expect(capturedRecord.name).toBe("Bob");
            expect(capturedRecord.age).toBe(30);
        });

        test("postHandler return value becomes response body", async () => {
            const postHandler = mock(async (_req: any, _db: any, record: any) => ({
                ...record,
                serverField: "injected"
            }));

            const { app, mockDb } = setupApp({ table: "users", postHandler });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).post("/odata/users").send({ name: "Charlie" });

            expect(res.status).toBe(200);
            expect(res.body.serverField).toBe("injected");
        });
    });

    // -------------------------------------------------------------------------
    describe("patchHandler", () => {

        test("replaces default DB UPDATE...MERGE for PATCH", async () => {
            const queryMock = mock(() => ({ collect: async () => [[]] }));
            const patchHandler = mock(async () => ({ id: "users:foo", name: "Custom Patched" }));

            const { app, mockDb } = setupApp({ table: "users", patchHandler });
            mockDb.query = queryMock as any;

            const res = await request(app).patch("/odata/users").send({ id: "users:foo", name: "Patched" });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Custom Patched");
            expect(queryMock).not.toHaveBeenCalled();
            expect(patchHandler).toHaveBeenCalledTimes(1);
        });

        test("passes record content with target RecordId to patchHandler", async () => {
            let capturedRecord: any;
            const patchHandler = mock(async (_req: any, _db: any, record: any) => {
                capturedRecord = record;
                return record;
            });

            const { app, mockDb } = setupApp({ table: "users", patchHandler });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).patch("/odata/users").send({ id: "users:bar", name: "Updated" });

            expect(capturedRecord).toBeDefined();
            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("users");
            expect(capturedRecord.name).toBe("Updated");
        });

        test("id field from body is not duplicated — record has exactly the RecordId", async () => {
            let capturedRecord: any;
            const patchHandler = mock(async (_req: any, _db: any, record: any) => {
                capturedRecord = record;
                return record;
            });

            const { app, mockDb } = setupApp({ table: "users", patchHandler });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).patch("/odata/users").send({ id: "users:baz", status: "active" });

            // The id in the record should be a RecordId, not the original "users:baz" string
            expect(capturedRecord.id).toBeInstanceOf(RecordId);
        });
    });

    // -------------------------------------------------------------------------
    describe("deleteHandler", () => {

        test("replaces default DB DELETE for DELETE", async () => {
            const queryMock = mock(() => ({ collect: async () => [[]] }));
            const deleteHandler = mock(async () => undefined);

            const { app, mockDb } = setupApp({ table: "users", deleteHandler });
            mockDb.query = queryMock as any;

            await request(app).delete("/odata/users").send({ id: "users:foo" });

            expect(deleteHandler).toHaveBeenCalledTimes(1);
            expect(queryMock).not.toHaveBeenCalled();
        });

        test("passes { id: RecordId } to deleteHandler", async () => {
            let capturedRecord: any;
            const deleteHandler = mock(async (_req: any, _db: any, record: any) => {
                capturedRecord = record;
            });

            const { app, mockDb } = setupApp({ table: "users", deleteHandler });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).delete("/odata/users").send({ id: "users:bar" });

            expect(capturedRecord).toBeDefined();
            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("users");
        });

        test("deleteHandler receives db and can perform cascading queries", async () => {
            const executedQueries: string[] = [];
            const deleteHandler = mock(async (_req: any, db: any, record: any) => {
                await db.query("DELETE child WHERE parent = $id", { id: record.id });
                await db.query("DELETE type::record($id)", { id: record.id });
            });

            const { app, mockDb } = setupApp({ table: "users", deleteHandler });
            mockDb.query = mock((...args: any[]) => {
                executedQueries.push(args[0] as string);
                return { collect: async () => [[]] };
            }) as any;

            const res = await request(app).delete("/odata/users").send({ id: "users:foo" });

            expect(deleteHandler).toHaveBeenCalledTimes(1);
            expect(executedQueries).toHaveLength(2);
            expect(executedQueries[0]).toContain("DELETE child");
            expect(executedQueries[1]).toContain("DELETE type::record");
        });
    });

    // -------------------------------------------------------------------------
    describe("fallback to default DB query when no handler set", () => {

        test("GET single uses DB when no getHandler", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "users:foo", name: "DB Alice" }]]
            }));

            const { app, mockDb } = setupApp({ table: "users" });
            mockDb.query = queryMock as any;

            const res = await request(app).get("/odata/users:foo");
            expect(res.status).toBe(200);
            expect(queryMock).toHaveBeenCalled();
            expect(res.body.name).toBe("DB Alice");
        });

        test("POST uses DB when no postHandler", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "users:gen_id", name: "DB Bob" }]]
            }));

            const { app, mockDb } = setupApp({ table: "users" });
            mockDb.query = queryMock as any;

            const res = await request(app).post("/odata/users").send({ name: "Bob" });
            expect(res.status).toBe(200);
            expect(queryMock).toHaveBeenCalled();
        });

        test("PATCH uses DB when no patchHandler", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "users:foo", name: "DB Patched" }]]
            }));

            const { app, mockDb } = setupApp({ table: "users" });
            mockDb.query = queryMock as any;

            const res = await request(app).patch("/odata/users").send({ id: "users:foo", name: "Patched" });
            expect(res.status).toBe(200);
            expect(queryMock).toHaveBeenCalled();
        });

        test("DELETE uses DB when no deleteHandler", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "users:foo" }]]
            }));

            const { app, mockDb } = setupApp({ table: "users" });
            mockDb.query = queryMock as any;

            await request(app).delete("/odata/users").send({ id: "users:foo" });
            expect(queryMock).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    describe("accessControl write shorthand", () => {
        function setupAppWithWriteAccess(roles: string[]) {
            const mockDb = new Surreal();
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "users:foo", name: "Upserted" }]]
            }));
            mockDb.query = queryMock as any;

            const config: ODataExpressConfig = {
                resolveDb: () => mockDb,
                tables: [new ODataExpressTable({
                    table: "users",
                    accessControl: { write: ["admin"] }
                })],
                idGenerator: () => "foo"
            };

            const app = express();
            app.use(express.json());
            // Inject a session before the OData middleware so checkObjectAccess sees it.
            app.use((req: any, _res, next) => {
                req.session = { profile: { roles } };
                next();
            });
            app.use("/odata", SurrealODataV4Middleware(config));

            return { app, queryMock };
        }

        test("PUT is blocked by `write` role when user lacks the role", async () => {
            const { app, queryMock } = setupAppWithWriteAccess(["user"]);

            const res = await request(app).put("/odata/users:foo").send({ name: "evil" });

            expect(res.status).toBe(403);
            expect(queryMock).not.toHaveBeenCalled();
        });

        test("PUT is allowed by `write` role when user has the role", async () => {
            const { app, queryMock } = setupAppWithWriteAccess(["admin"]);

            const res = await request(app).put("/odata/users:foo").send({ name: "ok" });

            expect(res.status).toBe(200);
            expect(queryMock).toHaveBeenCalled();
        });
    });
});
