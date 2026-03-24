import { beforeEach, describe, expect, mock, test } from "bun:test";
import express from "express";
import request from "supertest";
import { Surreal } from "surrealdb";
import { RunODataV4SelectFilter, SurrealODataV4Middleware } from "../../express/odata-middleware";
import { ODataExpressConfig, ODataExpressTable } from "../../types";

describe("Custom Select Middleware Integration", () => {
    describe("RunODataV4SelectFilter with customSelect", () => {
        let mockDb: any;

        beforeEach(() => {
            mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) {
                                return [[{ count: 10 }]];
                            }
                            return [[
                                {
                                    id: "finding:1",
                                    name: "Test Finding",
                                    canonical_finding: { id: "canonical:1", name: "Canonical 1" }
                                },
                                {
                                    id: "finding:2",
                                    name: "Test Finding 2",
                                    canonical_finding: { id: "canonical:2", name: "Canonical 2" }
                                }
                            ]];
                        })
                    };
                })
            } as any;
        });

        test("should pass customSelect to query generation", async () => {
            const result = await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                    }
                }
            );

            expect(mockDb.query).toHaveBeenCalled();
            // First call is count query, second call is entries query
            const entriesQuery = mockDb.query.mock.calls[1][0];

            expect(entriesQuery.toString()).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        });

        test("should generate correct query with multiple custom selects", async () => {
            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding",
                        "(->related_to->issue.id)[0]": "related_issue"
                    }
                }
            );

            const entriesQuery = mockDb.query.mock.calls[1][0];
            expect(entriesQuery.toString()).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(entriesQuery.toString()).toContain("(->related_to->issue.id)[0] AS related_issue");
        });

        test("should work with filters and custom select", async () => {
            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding?$filter=status eq 'active'",
                [],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                    }
                }
            );

            const entriesQuery = mockDb.query.mock.calls[1][0];
            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("WHERE");
        });

        test("should work with orderby and custom select", async () => {
            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding?$orderby=created_at desc",
                [],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                    }
                }
            );

            const entriesQuery = mockDb.query.mock.calls[1][0];
            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("ORDER BY");
        });

        test("should work with fetch and custom select", async () => {
            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                ["author", "comments"],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                    }
                }
            );

            const entriesQuery = mockDb.query.mock.calls[1][0];
            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("FETCH");
        });

        test("should return data with custom select fields", async () => {
            const result = await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                {
                    customSelect: {
                        "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                    }
                }
            );

            expect(result.value).toHaveLength(2);
            expect(result.value[0]).toHaveProperty("canonical_finding");
            expect(result.value[1]).toHaveProperty("canonical_finding");
        });
    });

    describe("SurrealODataV4Middleware with customSelect", () => {
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
                                {
                                    id: "finding:1",
                                    name: "Finding 1",
                                    canonical_finding: { id: "canonical:1", name: "Canonical 1" }
                                },
                                {
                                    id: "finding:2",
                                    name: "Finding 2",
                                    canonical_finding: { id: "canonical:2", name: "Canonical 2" }
                                }
                            ]];
                        })
                    };
                })
            } as any;

            const config: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "finding",
                        customSelect: {
                            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                        }
                    })
                ]
            };

            app = express();
            app.use(express.json());
            app.use("/odata", SurrealODataV4Middleware(config));
        });

        test("should apply custom select in GET request", async () => {
            const response = await request(app)
                .get("/odata/finding")
                .expect(200);

            expect(mockDb.query).toHaveBeenCalled();
            const calls = (mockDb.query as any).mock.calls;

            // Second call is the entries query (first is count)
            const entriesQuery = calls[1][0];
            expect(entriesQuery.toString()).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        });

        test("should apply custom select with filter", async () => {
            await request(app)
                .get("/odata/finding?$filter=status eq 'active'")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("WHERE");
        });

        test("should apply custom select with orderby", async () => {
            await request(app)
                .get("/odata/finding?$orderby=created_at desc")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            expect(entriesQuery.toString()).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        });

        test("should apply custom select with pagination", async () => {
            await request(app)
                .get("/odata/finding?$top=10&$skip=5")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("LIMIT 10");
            expect(queryStr).toContain("START 5");
        });

        test("should return data with custom select fields", async () => {
            const response = await request(app)
                .get("/odata/finding")
                .expect(200);

            expect(response.body.value).toHaveLength(2);
            expect(response.body.value[0]).toHaveProperty("canonical_finding");
            expect(response.body.value[1]).toHaveProperty("canonical_finding");
        });

        test("should work with multiple custom select expressions", async () => {
            const configMultiple: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "finding",
                        customSelect: {
                            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding",
                            "(->related_to->issue.id)[0]": "related_issue",
                            "count(->has_tag)": "tag_count"
                        }
                    })
                ]
            };

            const app2 = express();
            app2.use(express.json());
            app2.use("/odata", SurrealODataV4Middleware(configMultiple));

            await request(app2)
                .get("/odata/finding")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("(->related_to->issue.id)[0] AS related_issue");
            expect(queryStr).toContain("count(->has_tag) AS tag_count");
        });

        test("should not affect tables without custom select", async () => {
            const configNoCustom: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "other"
                    })
                ]
            };

            const app2 = express();
            app2.use(express.json());
            app2.use("/odata", SurrealODataV4Middleware(configNoCustom));

            await request(app2)
                .get("/odata/other")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const lastQuery = calls[calls.length - 1];

            expect(lastQuery[0].toString()).not.toContain("AS canonical_finding");
        });

        test("should combine with fetch configuration", async () => {
            const configWithFetch: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "finding",
                        fetch: ["author", "comments"],
                        customSelect: {
                            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                        }
                    })
                ]
            };

            const app3 = express();
            app3.use(express.json());
            app3.use("/odata", SurrealODataV4Middleware(configWithFetch));

            await request(app3)
                .get("/odata/finding")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("FETCH");
        });

        test("should combine with fieldAliases", async () => {
            const configWithAliases: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "finding",
                        fieldAliases: {
                            scan: "->on->scan"
                        },
                        customSelect: {
                            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                        }
                    })
                ]
            };

            const app4 = express();
            app4.use(express.json());
            app4.use("/odata", SurrealODataV4Middleware(configWithAliases));

            await request(app4)
                .get("/odata/finding?$filter=scan eq 123")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("->on->scan");
        });

        test("should combine with rowLevelFilter", async () => {
            const configWithRowFilter: ODataExpressConfig = {
                resolveDb: async () => mockDb,
                tables: [
                    new ODataExpressTable({
                        table: "finding",
                        rowLevelFilter: (req) => "ownerId = 'user123'",
                        customSelect: {
                            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
                        }
                    })
                ]
            };

            const app5 = express();
            app5.use(express.json());
            app5.use("/odata", SurrealODataV4Middleware(configWithRowFilter));

            await request(app5)
                .get("/odata/finding")
                .expect(200);

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
            expect(queryStr).toContain("ownerId = 'user123'");
        });
    });

    describe("Custom select edge cases and security", () => {
        test("should handle empty customSelect object", async () => {
            const mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) return [[{ count: 0 }]];
                            return [[]];
                        })
                    };
                })
            } as any;

            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                { customSelect: {} }
            );

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            expect(entriesQuery.toString()).toBe("SELECT * FROM type::table($table)");
        });

        test("should handle undefined customSelect", async () => {
            const mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) return [[{ count: 0 }]];
                            return [[]];
                        })
                    };
                })
            } as any;

            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                { customSelect: undefined }
            );

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            expect(entriesQuery.toString()).toBe("SELECT * FROM type::table($table)");
        });

        test("should handle complex SurrealDB expressions", async () => {
            const mockDb = {
                query: mock((sql: string, params: any) => {
                    return {
                        collect: mock(async () => {
                            if (sql.includes("COUNT")) return [[{ count: 0 }]];
                            return [[]];
                        })
                    };
                })
            } as any;

            await RunODataV4SelectFilter(
                mockDb,
                "finding",
                "/finding",
                [],
                undefined,
                {
                    customSelect: {
                        "count(->has_finding)": "finding_count",
                        "math::max(->has_finding->finding.severity)": "max_severity"
                    }
                }
            );

            const calls = (mockDb.query as any).mock.calls;
            const entriesQuery = calls[1][0];

            const queryStr = entriesQuery.toString();
            expect(queryStr).toContain("count(->has_finding) AS finding_count");
            expect(queryStr).toContain("math::max(->has_finding->finding.severity) AS max_severity");
        });
    });
});
