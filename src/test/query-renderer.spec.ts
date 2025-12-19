import { describe, expect, test } from "bun:test";
import { renderQuery } from "../parser/query-renderer";
import { ParsedQuery } from "../types";

describe("renderQuery", () => {
    test("generates basic query with default select", () => {
        const query: ParsedQuery = {};
        const result = renderQuery(query, "mytable");

        expect(result.entriesQuery).toBe("SELECT * FROM type::table($table)");
        expect(result.parameters["$table"]).toBe("mytable");
    });

    test("generates query with $select", () => {
        const query: ParsedQuery = { select: "id, name" };
        const result = renderQuery(query, "mytable");

        expect(result.entriesQuery).toBe("SELECT id, name FROM type::table($table)");
    });

    test("generates query with $filter", () => {
        const query: ParsedQuery = { where: "age > 18" };
        const result = renderQuery(query, "mytable");

        expect(result.entriesQuery).toBe("SELECT * FROM type::table($table) WHERE age > 18");
    });

    test("generates query with $orderby", () => {
        const query: ParsedQuery = { orderby: "name ASC" };
        const result = renderQuery(query, "mytable");

        expect(result.entriesQuery).toBe("SELECT * FROM type::table($table) ORDER BY name ASC");
    });

    test("generates query with $groupby", () => {
        const query: ParsedQuery = { groupby: "`category`" };
        const result = renderQuery(query, "products");

        expect(result.entriesQuery).toBe("SELECT * FROM type::table($table) GROUP BY `category`");
    });

    test("generates query with $groupby and $orderby", () => {
        const query: ParsedQuery = {
            groupby: "`category`, `region`",
            orderby: "`category` ASC"
        };
        const result = renderQuery(query, "sales");

        expect(result.entriesQuery).toContain("GROUP BY `category`, `region`");
        expect(result.entriesQuery).toContain("ORDER BY `category` ASC");
    });

    test("count query includes GROUP BY", () => {
        const query: ParsedQuery = { groupby: "`status`", where: "active = true" };
        const result = renderQuery(query, "orders");

        expect(result.countQuery).toContain("WHERE active = true");
        expect(result.countQuery).toContain("GROUP BY `status`");
        expect(result.countQuery).toContain("GROUP ALL");
    });

    test("generates query with $skip (start)", () => {
        const query: ParsedQuery = { skip: 5 };
        const result = renderQuery(query, "mytable");

        expect(result.entriesQuery).toBe("SELECT * FROM type::table($table) START 5");
        expect(result.skip).toBe(5);
    });

    test("generates query with correct order of clauses", () => {
        const query: ParsedQuery = {
            select: "id",
            where: "active = true",
            orderby: "created_at DESC",
            limit: 20,
            skip: 10
        };
        const result = renderQuery(query, "mytable");

        // Order: SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ... START ...
        const expected = "SELECT id FROM type::table($table) WHERE active = true ORDER BY created_at DESC LIMIT 20 START 10";
        expect(result.entriesQuery).toBe(expected);
    });

    test("generates query with fetch parameter", () => {
        const query: ParsedQuery = {};
        const fetch = ["author", "comments"];
        const result = renderQuery(query, "posts", fetch);

        // Fetch adds FETCH clause at the end
        expect(result.entriesQuery).toContain("SELECT * FROM type::table($table) FETCH type::field($fetch0), type::field($fetch1)");
        expect(result.parameters["$fetch0"]).toBe("author");
        expect(result.parameters["$fetch1"]).toBe("comments");
    });

    test("generates count query", () => {
        const query: ParsedQuery = { where: "score > 50" };
        const result = renderQuery(query, "scores");

        expect(result.countQuery).toBe("SELECT count() FROM type::table($table) WHERE score > 50 GROUP ALL");
    });

    test("handles $expand", () => {
        // Mocking Visitor structure for includes is complex,
        // but renderQuery expects ParsedQuery with optional includes array
        const query: ParsedQuery = {
            includes: [{
                navigationProperty: "profile",
                select: "*",
                parameters: new Map(),
                includes: []
            } as any]
        };
        const result = renderQuery(query, "users");

        // Logic appends expand path to select
        expect(result.entriesQuery).toContain("profile.*");
    });

    test("handles parameters", () => {
        const params = new Map<string, any>();
        params.set("p1", "value1");

        const query: ParsedQuery = { parameters: params };
        const result = renderQuery(query, "mytable");

        expect(result.parameters["p1"]).toBe("value1");
        expect(result.parameters["$table"]).toBe("mytable");
    });

    test("handles fetch with existing select", () => {
        const query: ParsedQuery = { select: "id, title" };
        const result = renderQuery(query, "posts", ["author"]);

        expect(result.entriesQuery).toContain("SELECT id, title FROM type::table($table) FETCH type::field($fetch0)");
    });
});
