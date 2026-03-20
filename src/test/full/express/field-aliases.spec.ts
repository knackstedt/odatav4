import { beforeAll, describe, expect, test } from "bun:test";
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../../../express/odata-middleware';
import { ODataExpressConfig, ODataExpressTable } from '../../../types';

let app: Express;
let db: Surreal;

beforeAll(async () => {
    // Use the global db if available, otherwise create a new one
    if ((global as any).db) {
        db = (global as any).db;
    } else {
        db = new Surreal();
        await db.connect('memory');
        await db.use({ namespace: 'test', database: 'test' });
    }

    // Create test tables with graph relationships
    await db.query(`
        DEFINE TABLE scan SCHEMAFULL;
        DEFINE FIELD id ON TABLE scan TYPE record<scan>;
        DEFINE FIELD value ON TABLE scan TYPE int;
        DEFINE FIELD name ON TABLE scan TYPE string;

        DEFINE TABLE finding SCHEMAFULL;
        DEFINE FIELD id ON TABLE finding TYPE record<finding>;
        DEFINE FIELD severity ON TABLE finding TYPE int;
        DEFINE FIELD description ON TABLE finding TYPE string;

        DEFINE TABLE on SCHEMAFULL TYPE RELATION IN scan OUT finding;
        DEFINE FIELD id ON TABLE on TYPE record;
        DEFINE FIELD timestamp ON TABLE on TYPE datetime;
    `);

    // Insert test data with relationships
    await db.query(`
        LET $scan1 = CREATE scan:1 SET value = 100, name = 'Scan 1';
        LET $scan2 = CREATE scan:2 SET value = 200, name = 'Scan 2';
        LET $scan3 = CREATE scan:3 SET value = 300, name = 'Scan 3';

        LET $finding1 = CREATE finding:1 SET severity = 5, description = 'Critical issue';
        LET $finding2 = CREATE finding:2 SET severity = 3, description = 'Medium issue';
        LET $finding3 = CREATE finding:3 SET severity = 1, description = 'Low issue';

        RELATE $scan1->on->$finding1 SET timestamp = time::now();
        RELATE $scan1->on->$finding2 SET timestamp = time::now();
        RELATE $scan2->on->$finding2 SET timestamp = time::now();
        RELATE $scan3->on->$finding3 SET timestamp = time::now();
    `);

    // Setup Express app with field aliases
    const config: ODataExpressConfig = {
        resolveDb: async () => db,
        tables: [
            new ODataExpressTable({
                table: "scan",
                fieldAliases: {
                    // Map 'finding' to the graph traversal expression
                    finding: "->on->finding",
                    // Map 'findingSeverity' to traverse and get severity
                    findingSeverity: "->on->finding->severity"
                }
            }),
            new ODataExpressTable({
                table: "finding"
            })
        ]
    };

    app = express();
    app.use(express.json());
    app.use("/api/odata", SurrealODataV4Middleware(config));
});

describe("Field Aliases - End-to-End Tests", () => {
    describe("Basic field alias filtering", () => {
        test("should filter using aliased field for graph traversal", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=finding eq 'finding:1'")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);

            // Should return scan:1 which is related to finding:1
            const scanIds = response.body.value.map((s: any) => s.id);
            expect(scanIds).toContain("scan:1");
        });

        test("should filter using nested graph traversal alias", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity eq 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);

            // Should return scan:1 which has finding with severity 5
            const scanIds = response.body.value.map((s: any) => s.id);
            expect(scanIds).toContain("scan:1");
        });

        test("should filter using comparison operators with aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity gt 2")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);

            // Should return scans with findings having severity > 2
            const scanIds = response.body.value.map((s: any) => s.id);
            expect(scanIds.length).toBeGreaterThan(0);
        });

        test("should combine aliased and non-aliased fields", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 3 and value lt 250")
                .expect(200);

            expect(response.body.value).toBeArray();

            // Should filter by both graph traversal and regular field
            response.body.value.forEach((scan: any) => {
                expect(scan.value).toBeLessThan(250);
            });
        });
    });

    describe("Complex filtering with aliases", () => {
        test("should handle OR expressions with aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity eq 5 or findingSeverity eq 1")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);

            const scanIds = response.body.value.map((s: any) => s.id);
            // Should include scan:1 (severity 5) and scan:3 (severity 1)
            expect(scanIds).toContain("scan:1");
            expect(scanIds).toContain("scan:3");
        });

        test("should handle parenthesized expressions with aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=(findingSeverity eq 5 or findingSeverity eq 3) and value le 200")
                .expect(200);

            expect(response.body.value).toBeArray();

            response.body.value.forEach((scan: any) => {
                expect(scan.value).toBeLessThanOrEqual(200);
            });
        });

        test("should handle NOT expressions with aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=not(findingSeverity eq 5)")
                .expect(200);

            expect(response.body.value).toBeArray();

            // Should not include scan:1 which has severity 5
            const scanIds = response.body.value.map((s: any) => s.id);
            expect(scanIds).not.toContain("scan:1");
        });
    });

    describe("ORDER BY with aliases", () => {
        test("should order by aliased field", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$orderby=findingSeverity desc&$top=10")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);
        });

        test("should order by multiple fields including aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$orderby=findingSeverity desc,value asc")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });

    describe("Combined query options with aliases", () => {
        test("should handle filter, orderby, top, and skip with aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 1&$orderby=findingSeverity desc&$top=2&$skip=0")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeLessThanOrEqual(2);
        });

        test("should handle count with aliased filter", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 3&$count=true")
                .expect(200);

            expect(response.body['@odata.count']).toBeDefined();
            expect(typeof response.body['@odata.count']).toBe('number');
            expect(response.body.value).toBeArray();
        });
    });

    describe("Tables without aliases", () => {
        test("should work normally for tables without field aliases", async () => {
            const response = await request(app)
                .get("/api/odata/finding?$filter=severity eq 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);

            response.body.value.forEach((finding: any) => {
                expect(finding.severity).toBe(5);
            });
        });

        test("should handle orderby for non-aliased tables", async () => {
            const response = await request(app)
                .get("/api/odata/finding?$orderby=severity desc")
                .expect(200);

            expect(response.body.value).toBeArray();

            // Verify ordering
            for (let i = 1; i < response.body.value.length; i++) {
                expect(response.body.value[i-1].severity).toBeGreaterThanOrEqual(
                    response.body.value[i].severity
                );
            }
        });
    });

    describe("Error handling", () => {
        test("should handle invalid filter syntax gracefully", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity eq")
                .expect(400);

            expect(response.body.error).toBeDefined();
        });

        test("should handle non-existent fields in aliases", async () => {
            // This should execute but may return empty results or error depending on SurrealDB behavior
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity eq 999");

            // Should not crash - either 200 with empty results or 400/500
            expect([200, 400, 500]).toContain(response.status);
        });
    });

    describe("Real-world scenarios", () => {
        test("should filter scans by related finding properties", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 3 and value ge 100&$orderby=value asc")
                .expect(200);

            expect(response.body.value).toBeArray();

            // Verify results match both conditions
            response.body.value.forEach((scan: any) => {
                expect(scan.value).toBeGreaterThanOrEqual(100);
            });
        });

        test("should support pagination with aliased filters", async () => {
            // First page
            const page1 = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 1&$top=1&$skip=0")
                .expect(200);

            expect(page1.body.value).toBeArray();
            expect(page1.body.value.length).toBe(1);

            // Second page
            const page2 = await request(app)
                .get("/api/odata/scan?$filter=findingSeverity ge 1&$top=1&$skip=1")
                .expect(200);

            expect(page2.body.value).toBeArray();

            // Pages should have different results
            if (page2.body.value.length > 0) {
                expect(page1.body.value[0].id).not.toBe(page2.body.value[0].id);
            }
        });

        test("should handle complex business logic with multiple aliases", async () => {
            const response = await request(app)
                .get("/api/odata/scan?$filter=(findingSeverity eq 5 and value lt 150) or (findingSeverity eq 1 and value gt 250)")
                .expect(200);

            expect(response.body.value).toBeArray();

            // Verify complex logic
            response.body.value.forEach((scan: any) => {
                const matchesFirstCondition = scan.value < 150;
                const matchesSecondCondition = scan.value > 250;
                expect(matchesFirstCondition || matchesSecondCondition).toBe(true);
            });
        });
    });
});
