import { describe, expect, mock, test } from "bun:test";
import express from "express";
import request from "supertest";
import { RecordId, Surreal } from "surrealdb";
import { SurrealODataV4Middleware } from "../../express/odata-middleware";
import { ODataExpressConfig, ODataExpressTable } from "../../types";

/**
 * Tests for OData key predicate URL format:
 *   GET,PATCH,DELETE /odata/table(r'table:id')
 *   GET,PATCH,DELETE /odata/table(r"table:id")
 *   GET,PATCH,DELETE /odata/table(r'id')    — record literal without table prefix
 *
 * This is the standard OData entity-key syntax as an alternative to /odata/table:id.
 */

function setupApp(tableConfig: ConstructorParameters<typeof ODataExpressTable>[0]) {
    const mockDb = new Surreal();
    const config: ODataExpressConfig = {
        resolveDb: () => mockDb,
        tables: [new ODataExpressTable(tableConfig)],
        idGenerator: () => "gen_id"
    };
    const app = express();
    app.use(express.json());
    app.use("/odata", SurrealODataV4Middleware(config));
    return { app, mockDb };
}

const RECORD_RESULT = { id: "scan_def:abc123", name: "Test Record" };

describe("OData Key Predicate URL Format — table(r'table:id')", () => {

    // -------------------------------------------------------------------------
    describe("GET", () => {

        test("r'table:id' single quotes returns 200 with record", async () => {
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async () => RECORD_RESULT
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/scan_def(r'scan_def:abc123')");

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Test Record");
        });

        test("r\"table:id\" double quotes returns 200 with record", async () => {
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async () => RECORD_RESULT
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            // double quotes encoded as %22 in the URL
            const res = await request(app).get("/odata/scan_def(r%22scan_def:abc123%22)");

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Test Record");
        });

        test("r'id' without table prefix in literal returns 200 with record", async () => {
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async () => RECORD_RESULT
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/scan_def(r'abc123')");

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Test Record");
        });

        test("returns 404 when getHandler returns null", async () => {
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async () => null
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/scan_def(r'scan_def:missing')");

            expect(res.status).toBe(404);
        });

        test("falls back to DB query and returns 404 for unknown record", async () => {
            const { app, mockDb } = setupApp({ table: "scan_def" });
            mockDb.query = mock(() => ({
                collect: async () => [[]] // empty result → 404
            })) as any;

            const res = await request(app).get("/odata/scan_def(r'scan_def:unknown')");

            expect(res.status).toBe(404);
        });

        test("getHandler receives a RecordId with the correct table and id", async () => {
            let capturedRecord: any;
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async (_req: any, _db: any, record: any) => {
                    capturedRecord = record;
                    return RECORD_RESULT;
                }
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).get("/odata/scan_def(r'scan_def:abc123')");

            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("scan_def");
            expect(String(capturedRecord.id.id)).toBe("abc123");
        });

        test("getHandler receives correct RecordId when literal omits the table prefix", async () => {
            let capturedRecord: any;
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async (_req: any, _db: any, record: any) => {
                    capturedRecord = record;
                    return RECORD_RESULT;
                }
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).get("/odata/scan_def(r'abc123')");

            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("scan_def");
            expect(String(capturedRecord.id.id)).toBe("abc123");
        });
    });

    // -------------------------------------------------------------------------
    describe("PATCH", () => {

        test("r'table:id' with no id in body targets the correct record", async () => {
            let capturedRecord: any;
            const { app, mockDb } = setupApp({
                table: "scan_def",
                patchHandler: async (_req: any, _db: any, record: any) => {
                    capturedRecord = record;
                    return { ...record, updated: true };
                }
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app)
                .patch("/odata/scan_def(r'scan_def:abc123')")
                .send({ name: "Updated" });

            expect(res.status).toBe(200);
            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("scan_def");
            expect(String(capturedRecord.id.id)).toBe("abc123");
            expect(capturedRecord.name).toBe("Updated");
        });

        test("r'table:id' with matching id in body targets the correct record", async () => {
            let capturedRecord: any;
            const { app, mockDb } = setupApp({
                table: "scan_def",
                patchHandler: async (_req: any, _db: any, record: any) => {
                    capturedRecord = record;
                    return record;
                }
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app)
                .patch("/odata/scan_def(r'scan_def:abc123')")
                .send({ id: "scan_def:abc123", name: "Updated" });

            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("scan_def");
            expect(String(capturedRecord.id.id)).toBe("abc123");
        });

        test("r'table:id' routes to correct DB UPDATE when no patchHandler set", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "scan_def:abc123", name: "DB Patched" }]]
            }));
            const { app, mockDb } = setupApp({ table: "scan_def" });
            mockDb.query = queryMock as any;

            const res = await request(app)
                .patch("/odata/scan_def(r'scan_def:abc123')")
                .send({ name: "Patched" });

            expect(res.status).toBe(200);
            expect(queryMock).toHaveBeenCalled();
            // Verify the query received the correct RecordId
            const [[_sql, params]] = queryMock.mock.calls as any[];
            expect(params.id).toBeInstanceOf(RecordId);
            expect(String(params.id.table)).toBe("scan_def");
            expect(String(params.id.id)).toBe("abc123");
        });
    });

    // -------------------------------------------------------------------------
    describe("DELETE", () => {

        test("r'table:id' without request body succeeds", async () => {
            const deleteHandler = mock(async () => undefined);
            const { app, mockDb } = setupApp({
                table: "scan_def",
                deleteHandler
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app)
                .delete("/odata/scan_def(r'scan_def:abc123')");

            expect(deleteHandler).toHaveBeenCalledTimes(1);
        });

        test("r'table:id' without body — deleteHandler receives correct RecordId", async () => {
            let capturedRecord: any;
            const { app, mockDb } = setupApp({
                table: "scan_def",
                deleteHandler: async (_req: any, _db: any, record: any) => {
                    capturedRecord = record;
                }
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).delete("/odata/scan_def(r'scan_def:abc123')");

            expect(capturedRecord.id).toBeInstanceOf(RecordId);
            expect(String(capturedRecord.id.table)).toBe("scan_def");
            expect(String(capturedRecord.id.id)).toBe("abc123");
        });

        test("r'table:id' with request body succeeds", async () => {
            const deleteHandler = mock(async () => undefined);
            const { app, mockDb } = setupApp({
                table: "scan_def",
                deleteHandler
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app)
                .delete("/odata/scan_def(r'scan_def:abc123')")
                .send({ id: "scan_def:abc123" });

            expect(deleteHandler).toHaveBeenCalledTimes(1);
        });

        test("r'table:id' routes to correct DB DELETE when no deleteHandler set", async () => {
            const queryMock = mock(() => ({
                collect: async () => [[{ id: "scan_def:abc123" }]]
            }));
            const { app, mockDb } = setupApp({ table: "scan_def" });
            mockDb.query = queryMock as any;

            await request(app).delete("/odata/scan_def(r'scan_def:abc123')");

            expect(queryMock).toHaveBeenCalled();
            const [[_sql, params]] = queryMock.mock.calls as any[];
            expect(params.id).toBeInstanceOf(RecordId);
            expect(String(params.id.table)).toBe("scan_def");
            expect(String(params.id.id)).toBe("abc123");
        });
    });

    // -------------------------------------------------------------------------
    describe("colon-separated format still works after the change", () => {

        test("GET /odata/table:id still resolves correctly", async () => {
            const { app, mockDb } = setupApp({
                table: "scan_def",
                getHandler: async () => RECORD_RESULT
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            const res = await request(app).get("/odata/scan_def:abc123");

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Test Record");
        });

        test("DELETE /odata/table:id without body still works", async () => {
            const deleteHandler = mock(async () => undefined);
            const { app, mockDb } = setupApp({
                table: "scan_def",
                deleteHandler
            });
            mockDb.query = mock(() => ({ collect: async () => [[]] })) as any;

            await request(app).delete("/odata/scan_def:abc123");

            expect(deleteHandler).toHaveBeenCalledTimes(1);
        });
    });
});
