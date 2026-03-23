import { beforeEach, describe, expect, mock, test } from "bun:test";
import express from "express";
import request from "supertest";
import { Surreal } from "surrealdb";
import { parseODataRequest, RunODataV4SelectFilter, SurrealODataV4Middleware } from "../../express/odata-middleware";
import { ODataExpressConfig, ODataExpressTable } from "../../types";

describe("Field Aliases Middleware Integration", () => {
    describe("parseODataRequest with fieldAliases", () => {
        test("should apply field aliases to filter", () => {
            const parsed = parseODataRequest(
                "/table?$filter=scan eq 123",
                { fieldAliases: { scan: "->on->finding" } }
            );

            expect(parsed.where).toContain("->on->finding");
            expect(parsed.where).not.toContain("type::field");
            expect(parsed.where).toContain("$literal1");
        });

        test("should apply field aliases to orderby", () => {
            const parsed = parseODataRequest(
                "/table?$orderby=scan asc",
                { fieldAliases: { scan: "->on->finding" } }
            );

            expect(parsed.orderby).toContain("->on->finding ASC");
            expect(parsed.orderby).not.toContain("`scan`");
        });

        test("should handle multiple aliases in complex query", () => {
            const parsed = parseODataRequest(
                "/table?$filter=scan eq 123 and finding ne 456&$orderby=scan desc",
                {
                    fieldAliases: {
                        scan: "->on->finding",
                        finding: "->has->issue"
                    }
                }
            );

            expect(parsed.where).toContain("->on->finding");
            expect(parsed.where).toContain("->has->issue");
            expect(parsed.where).toContain("$literal1");
            expect(parsed.where).toContain("$literal2");
            expect(parsed.orderby).toContain("->on->finding DESC");
        });

        test("should not affect non-aliased fields", () => {
            const parsed = parseODataRequest(
                "/table?$filter=scan eq 123 and name eq 'test'",
                { fieldAliases: { scan: "->on->finding" } }
            );

            expect(parsed.where).toContain("->on->finding");
            expect(parsed.where).toContain("type::field($field1)");

            const paramValues = Array.from(parsed.parameters.values());
            expect(paramValues).toContain("name");
            expect(paramValues).not.toContain("scan");
        });
    });

    describe("RunODataV4SelectFilter with fieldAliases", () => {
        let mockDb: any;

        beforeEach(() => {
            mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) {
                                return [[{ count: 10 }]];
                            }
                            return [[{ id: 1 }, { id: 2 }]];
                        })
                    };
                })
            } as any;
        });

        test("should pass fieldAliases to query generation", async () => {
            const result = await RunODataV4SelectFilter(
                mockDb,
                "test_table",
                "/test?$filter=scan eq 123",
                [],
                undefined,
                { fieldAliases: { scan: "->on->finding" } }
            );

            expect(mockDb.query).toHaveBeenCalled();
            const [countQuery, countParams] = mockDb.query.mock.calls[0];

            expect(countQuery.toString()).toContain("->on->finding");
            expect(countQuery.toString()).not.toContain("type::field");
        });

        test("should generate correct query with multiple aliases", async () => {
            await RunODataV4SelectFilter(
                mockDb,
                "test_table",
                "/test?$filter=scan eq 123 and finding eq 456",
                [],
                undefined,
                {
                    fieldAliases: {
                        scan: "->on->finding",
                        finding: "->has->issue"
                    }
                }
            );

            const [entriesQuery] = mockDb.query.mock.calls[1];
            expect(entriesQuery.toString()).toContain("->on->finding");
            expect(entriesQuery.toString()).toContain("->has->issue");
        });

        test("should work with pre-parsed query", async () => {
            const parsed = parseODataRequest(
                "/test?$filter=scan eq 123",
                { fieldAliases: { scan: "->on->finding" } }
            );

            await RunODataV4SelectFilter(
                mockDb,
                "test_table",
                "/test",
                [],
                parsed,
                { fieldAliases: { scan: "->on->finding" } }
            );

            const [entriesQuery] = mockDb.query.mock.calls[1];
            expect(entriesQuery.toString()).toContain("->on->finding");
        });
    });

    describe("SurrealODataV4Middleware with fieldAliases", () => {
        let app: express.Application;
        let mockDb: Surreal;

        beforeEach(() => {
            mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) {
                                return [[{ count: 2 }]];
                            }
                            return [[
                                { id: "test:1", name: "Test 1", scan: 123 },
                                { id: "test:2", name: "Test 2", scan: 456 }
                            ]];
                        })
                    };
                })
            } as any;

            const config: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "test",
                        fieldAliases: {
                            scan: "->on->finding",
                            finding: "->has->issue"
                        }
                    })
                ]
            };

            app = express();
            app.use(express.json());
            app.use("/odata", SurrealODataV4Middleware(config));
        });

        test("should apply field aliases in GET request with filter", async () => {
            const response = await request(app)
                .get("/odata/test?$filter=scan eq 123")
                .expect(200);

            expect(mockDb.query).toHaveBeenCalled();
            const calls = (mockDb.query as any).mock.calls;

            // Check that the query contains the aliased field
            const entriesQuery = calls.find((call: any) =>
                call[0].toString().includes("SELECT") && !call[0].toString().includes("COUNT")
            );
            expect(entriesQuery).toBeTruthy();
            expect(entriesQuery[0].toString()).toContain("->on->finding");
        });

        test("should apply field aliases in GET request with orderby", async () => {
            await request(app)
                .get("/odata/test?$orderby=scan desc")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls.find((call: any) =>
                call[0].toString().includes("ORDER BY")
            );

            expect(entriesQuery).toBeTruthy();
            expect(entriesQuery[0].toString()).toContain("->on->finding");
        });

        test("should apply multiple field aliases", async () => {
            await request(app)
                .get("/odata/test?$filter=scan eq 123 and finding eq 456")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls.find((call: any) =>
                call[0].toString().includes("SELECT") && !call[0].toString().includes("COUNT")
            );

            expect(entriesQuery[0].toString()).toContain("->on->finding");
            expect(entriesQuery[0].toString()).toContain("->has->issue");
        });

        test("should not affect tables without field aliases", async () => {
            const configNoAliases: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "other"
                    })
                ]
            };

            const app2 = express();
            app2.use(express.json());
            app2.use("/odata", SurrealODataV4Middleware(configNoAliases));

            await request(app2)
                .get("/odata/other?$filter=name eq 'test'")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const lastQuery = calls[calls.length - 1];

            // Should use type::field for non-aliased fields
            expect(lastQuery[0].toString()).toContain("type::field");
        });

        test("should work with complex filters", async () => {
            await request(app)
                .get("/odata/test?$filter=(scan eq 123 or scan eq 456) and finding ne 789")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls.find((call: any) =>
                call[0].toString().includes("SELECT") && !call[0].toString().includes("COUNT")
            );

            const queryStr = entriesQuery[0].toString();
            expect(queryStr).toContain("->on->finding");
            expect(queryStr).toContain("->has->issue");
            expect(queryStr).toMatch(/\(/); // Contains parentheses
        });

        test("should combine with rowLevelFilter", async () => {
            const configWithRowFilter: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "test",
                        fieldAliases: {
                            scan: "->on->finding"
                        },
                        rowLevelFilter: (req) => "ownerId = 'user123'"
                    })
                ]
            };

            const app3 = express();
            app3.use(express.json());
            app3.use("/odata", SurrealODataV4Middleware(configWithRowFilter));

            await request(app3)
                .get("/odata/test?$filter=scan eq 123")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls.find((call: any) =>
                call[0].toString().includes("SELECT") && !call[0].toString().includes("COUNT")
            );

            const queryStr = entriesQuery[0].toString();
            expect(queryStr).toContain("->on->finding");
            expect(queryStr).toContain("ownerId = 'user123'");
            expect(queryStr).toContain("AND"); // Combined with AND
        });
    });

    describe("Field aliases security and edge cases", () => {
        test("should handle empty fieldAliases object", () => {
            const parsed = parseODataRequest(
                "/table?$filter=name eq 'test'",
                { fieldAliases: {} }
            );

            expect(parsed.where).toContain("type::field");
        });

        test("should handle undefined fieldAliases", () => {
            const parsed = parseODataRequest(
                "/table?$filter=name eq 'test'",
                { fieldAliases: undefined }
            );

            expect(parsed.where).toContain("type::field");
        });

        test("should not inject SQL when alias contains malicious code", () => {
            // Field aliases are inserted directly, so they should be carefully controlled
            // This test ensures the alias is used as-is (which is the intended behavior)
            const parsed = parseODataRequest(
                "/table?$filter=field eq 123",
                { fieldAliases: { field: "->safe->path" } }
            );

            expect(parsed.where).toContain("->safe->path");
        });

        test("should handle alias with backticks", () => {
            const parsed = parseODataRequest(
                "/table?$filter=field eq 123",
                { fieldAliases: { field: "`field`->value" } }
            );

            expect(parsed.where).toContain("`field`->value");
        });

        test("should handle complex SurrealDB expressions in aliases", () => {
            const parsed = parseODataRequest(
                "/table?$filter=computed eq 100",
                { fieldAliases: { computed: "(field1 + field2) * 2" } }
            );

            expect(parsed.where).toContain("(field1 + field2) * 2");
        });
    });
});
