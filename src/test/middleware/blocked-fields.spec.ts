import { describe, expect, mock, test } from "bun:test";
import express from "express";
import request from "supertest";
import { Surreal } from "surrealdb";
import { SurrealODataV4Middleware } from "../../express/odata-middleware";
import { ODataExpressConfig, ODataExpressTable } from "../../types";

describe("Blocked Fields Middleware", () => {

    // --- GET ---
    test("removes blocked fields from GET list response", async () => {
        const mockDb = new Surreal();
        const queryMock = mock((query: string) => {
            return {
                collect: async () => {
                    if (query.includes("count()")) {
                        return [[{ count: 2 }]];
                    }
                    return [[
                        { id: "users:1", name: "Alice", sensitive: "secret", nested: { secret: "hidden", public: "visible" } },
                        { id: "users:2", name: "Bob", sensitive: "top-secret", nested: { secret: "hidden2", public: "visible2" } }
                    ]];
                }
            };
        });
        mockDb.query = queryMock as any;

        const app = setupApp(mockDb);
        const res = await request(app).get("/odata/users");

        expect(res.status).toBe(200);
        const data = res.body.value;
        expect(data.length).toBe(2);

        expect(data[0].name).toBe("Alice");
        expect(data[0].sensitive).toBeUndefined();
        expect(data[0].nested.public).toBe("visible");
        expect(data[0].nested.secret).toBeUndefined();

        expect(data[1].name).toBe("Bob");
        expect(data[1].sensitive).toBeUndefined();
        expect(data[1].nested.public).toBe("visible2");
        expect(data[1].nested.secret).toBeUndefined();
    });

    test("removes blocked fields from GET single response", async () => {
        const mockDb = new Surreal();
        const queryMock = mock(() => {
            return {
                collect: async () => [
                    [{ id: "users:1", name: "Alice", sensitive: "secret", nested: { secret: "hidden", public: "visible" } }]
                ]
            };
        });
        mockDb.query = queryMock as any;

        const app = setupApp(mockDb);
        const res = await request(app).get("/odata/users:1");

        expect(res.status).toBe(200);
        expect(res.body.name).toBe("Alice");
        expect(res.body.sensitive).toBeUndefined();
        expect(res.body.nested.public).toBe("visible");
        expect(res.body.nested.secret).toBeUndefined();
    });

    // --- POST ---
    test("removes blocked fields from POST single response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:3", name: "Charlie", sensitive: "secret", nested: { secret: "hidden" } }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).post("/odata/users").send({ name: "Charlie", sensitive: "secret" });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe("Charlie");
        expect(res.body.sensitive).toBeUndefined();
        expect(res.body.nested?.secret).toBeUndefined();
    });

    test("removes blocked fields from POST batch response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:x", name: "Mocked", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).post("/odata/users").send([
            { name: "Dave", sensitive: "secret" },
            { name: "Eve", sensitive: "secret" }
        ]);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(2);
        res.body.forEach((item: any) => {
            expect(item.sensitive).toBeUndefined();
        });
    });

    // --- PUT ---
    test("removes blocked fields from PUT single response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:1", name: "AliceUpdated", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).put("/odata/users").send({ id: "users:1", name: "AliceUpdated" });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe("AliceUpdated");
        expect(res.body.sensitive).toBeUndefined();
    });

    test("removes blocked fields from PUT batch response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:x", name: "Mocked", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).put("/odata/users").send([
            { id: "users:1", name: "Alice" },
            { id: "users:2", name: "Bob" }
        ]);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        res.body.forEach((item: any) => {
            expect(item.sensitive).toBeUndefined();
        });
    });

    // --- PATCH ---
    test("removes blocked fields from PATCH single response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:1", name: "AlicePatched", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).patch("/odata/users").send({ id: "users:1", name: "AlicePatched" });

        expect(res.status).toBe(200);
        expect(res.body.sensitive).toBeUndefined();
    });

    test("removes blocked fields from PATCH batch response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:x", name: "Mocked", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).patch("/odata/users").send([
            { id: "users:1" },
            { id: "users:2" }
        ]);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        res.body.forEach((item: any) => {
            expect(item.sensitive).toBeUndefined();
        });
    });

    // --- DELETE ---
    test("removes blocked fields from DELETE single response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            // DELETE returns the record
            return {
                collect: async () => [[{ id: "users:1", name: "Alice", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).delete("/odata/users").send({ id: "users:1" });

        expect(res.status).toBe(200);
        expect(res.body.sensitive).toBeUndefined();
    });

    test("removes blocked fields from DELETE batch response", async () => {
        const mockDb = new Surreal();
        mockDb.query = mock(() => {
            return {
                collect: async () => [[{ id: "users:x", name: "Mocked", sensitive: "secret" }]]
            };
        }) as any;

        const app = setupApp(mockDb);
        const res = await request(app).delete("/odata/users").send([
            { id: "users:1" },
            { id: "users:2" }
        ]);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        res.body.forEach((item: any) => {
            expect(item.sensitive).toBeUndefined();
        });
    });

});

function setupApp(mockDb: any) {
    const config: ODataExpressConfig = {
        resolveDb: () => mockDb,
        tables: [
            new ODataExpressTable({
                table: "users",
                blockedFields: ["sensitive", "nested.secret"]
            })
        ],
        idGenerator: () => "gen_id"
    };

    const app = express();
    app.use(express.json());
    app.use("/odata", SurrealODataV4Middleware(config));

    // Mock session
    app.use((req: any, res, next) => {
        req.session = { profile: { roles: [] } };
        next();
    });
    return app;
}
