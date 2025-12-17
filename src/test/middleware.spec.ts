import { describe, expect, test, mock } from "bun:test";
import { parseODataRequest, ODataV4ToSurrealQL, RunODataV4SelectFilter } from "../express/odata-middleware";
import { Surreal } from "surrealdb";

describe("OData Middleware", () => {
    describe("parseODataRequest", () => {
        test("parses simple query options", () => {
            const parsed = parseODataRequest("/table?$top=10&$skip=5&$select=id,name");
            expect(parsed.limit).toBe(10);
            expect(parsed.skip).toBe(5);
            // Fields are parameterized in SurrealDB mode
            expect(parsed.select).toContain("type::field($select");
            expect(params(parsed).includes("id")).toBe(true);
            expect(params(parsed).includes("name")).toBe(true);
        });

        test("parses filter expression", () => {
            const parsed = parseODataRequest("/table?$filter=age gt 18");
            expect(parsed.where).toContain("type::field($field");
            expect(parsed.where).toContain("$literal");

            const p = params(parsed);
            expect(p.includes("age")).toBe(true);
            // 18 might be string or number depending on parser
            expect(p.some(v => v == 18 || v == "18")).toBe(true);
        });

        test("parses orderby", () => {
            const parsed = parseODataRequest("/table?$orderby=name asc");
            // Orderby fields are backticked
            expect(parsed.orderby).toContain("`name` ASC");
        });

        test("parses search", () => {
            const parsed = parseODataRequest("/table?$search=testing");
            expect(parsed.search).toBe("testing");
        });

        test("parses format", () => {
            const parsed = parseODataRequest("/table?$format=json");
            expect(parsed.format).toBe("json");
        });

        test("parses count", () => {
            const parsed = parseODataRequest("/table?$count=true");
            expect(parsed.count).toBe(true);
        });

        test("handles full URL", () => {
            const parsed = parseODataRequest("http://localhost/api/odata/table?$top=1");
            expect(parsed.limit).toBe(1);
        });

        test("handles empty query", () => {
            const parsed = parseODataRequest("/table");
            expect(parsed.limit).toBeUndefined();
            expect(parsed.skip).toBeUndefined();
            expect(parsed.where).toBeUndefined();
        });
    });

    describe("ODataV4ToSurrealQL", () => {
        test("generates basic query", () => {
            const result = ODataV4ToSurrealQL("users", "/users?$select=id,name&$filter=active eq true");

            expect(result.entriesQuery).toContain("type::field($select");
            expect(result.entriesQuery).toContain("type::table($table)");

            const vals = Object.values(result.parameters);
            expect(result.parameters["$table"]).toBe("users");
            expect(vals).toContain("id");
            expect(vals).toContain("name");
            expect(vals).toContain("active");
            // boolean true might vary
            expect(vals.some(v => v === true)).toBe(true);
        });

        test("generates query from ParsedQuery", () => {
            const parsed = parseODataRequest("/users?$top=5");
            const result = ODataV4ToSurrealQL("users", parsed);

            expect(result.entriesQuery).toContain("LIMIT 5");
            expect(result.limit).toBe(5);
        });

        test("handles expansion", () => {
            const result = ODataV4ToSurrealQL("posts", "/posts?$expand=author");
            // Check that it selects the expanded field
            expect(result.entriesQuery).toContain("author.*");
            // We do NOT expect FETCH unless explicitly requested or implemented
        });

        test("handles fetch parameter", () => {
            const result = ODataV4ToSurrealQL("posts", "/posts", ["comments"]);
            // Expect parameterized FETCH
            expect(result.entriesQuery).toContain("FETCH");
            expect(result.entriesQuery).toContain("$fetch");

            expect(Object.values(result.parameters)).toContain("comments");
        });
    });

    describe("RunODataV4SelectFilter", () => {
        test("executes query against db", async () => {
            const mockDb = new Surreal();
            // Mock returns a synchronous object with collect
            const queryMock = mock(() => {
                return {
                    collect: async () => [[{ count: 0 }], []]
                }
            });
            mockDb.query = queryMock as any;

            await RunODataV4SelectFilter(mockDb, "users", "/users?$top=10");

            expect(queryMock).toHaveBeenCalled();
            const calls = queryMock.mock.calls as any[];
            const queries = calls.map(c => c[0]);

            expect(queries.some(q => q.includes("LIMIT 10"))).toBe(true);
        });

        test("calculates nextLink", async () => {
            const mockDb = new Surreal();
            mockDb.query = mock((query: string) => {
                return {
                    collect: async () => {
                        if (typeof query === 'string' && query.includes("count()")) {
                            return [[{ count: 20 }]];
                        } else {
                            return [Array(10).fill({ id: 1 })]; // data
                        }
                    }
                }
            }) as any;

            const result = await RunODataV4SelectFilter(mockDb, "users", "/users?$top=10&$skip=0");

            expect(result['@odata.count']).toBe(20);
            const decodedNextLink = decodeURIComponent(result['@odata.nextlink']!);
            expect(decodedNextLink).toContain("$skip=10");
        });

        test("respects parsed query input", async () => {
            const mockDb = new Surreal();
            const queryMock = mock(() => {
                return {
                    collect: async () => [[{ count: 0 }], []]
                }
            });
            mockDb.query = queryMock as any;

            const parsed = parseODataRequest("/users?$filter=id eq 1");
            await RunODataV4SelectFilter(mockDb, "users", "/users", [], parsed);

            const calls = queryMock.mock.calls as any[];
            const queries = calls.map(c => c[0]);
            expect(queries.some(q => q.includes("$field"))).toBe(true);
        });
    });

    // Helper to get parameters array
    function params(parsed: any) {
        return Array.from(parsed.parameters?.values() || []);
    }
});
