import { describe, expect, test } from "bun:test";
import { renderQuery } from "../../../parser/query-renderer";
import { ParsedQuery } from "../../../types";

declare global {
    var db: any;
}

const checkExecution = async (result: any) => {
    if (globalThis.db) {
        const dbParams: any = {};
        // renderQuery returns parameters with $ prefix in keys sometimes?
        // Let's copy strictly.
        for (const k in result.parameters) {
            dbParams[k.replace(/^\$/, '')] = result.parameters[k];
        }

        try {
            await globalThis.db.query(result.entriesQuery.toString(), dbParams);
            if (result.countQuery) {
                await globalThis.db.query(result.countQuery.toString(), dbParams);
            }
        } catch (e: any) {
            if (e.message.includes("Exist") || e.message.includes("not found")) {
                throw new Error(`DB Execution failed: ${e.message}\nQuery: ${result.entriesQuery}`);
            }
            throw new Error(`DB Execution failed: ${e.message}\nQuery: ${result.entriesQuery}`);
        }
    }
};

describe("renderQuery", () => {
    test("generates basic query with default select", async () => {
        const query: ParsedQuery = {};
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table)");
        expect(result.parameters["$table"]).toBe("user");
        await checkExecution(result);
    });

    test("generates query with $select", async () => {
        const query: ParsedQuery = { select: "id, name" };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT id, name FROM type::table($table)");
        await checkExecution(result);
    });

    test("generates query with $filter", async () => {
        const query: ParsedQuery = { where: "age > 18" };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table) WHERE age > 18");
        await checkExecution(result);
    });

    test("generates query with $orderby", async () => {
        const query: ParsedQuery = { orderby: "name ASC" };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table) ORDER BY name ASC");
        await checkExecution(result);
    });

    test("generates query with $groupby", async () => {
        const query: ParsedQuery = {
            groupby: "`category`",
            select: "category"
        };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT category FROM type::table($table) GROUP BY `category`");
        await checkExecution(result);
    });

    test("generates query with $groupby and $orderby", async () => {
        const query: ParsedQuery = {
            groupby: "`category`, `region`",
            orderby: "`category` ASC",
            select: "category, region"
        };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toContain("GROUP BY `category`, `region`");
        expect(result.entriesQuery.toString()).toContain("ORDER BY `category` ASC");
        await checkExecution(result);
    });

    test("generates query with $skip (start)", async () => {
        const query: ParsedQuery = { skip: 5 };
        const result = renderQuery(query, "user");

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table) START 5");
        expect(result.skip).toBe(5);
        await checkExecution(result);
    });

    test("generates query with correct order of clauses", async () => {
        const query: ParsedQuery = {
            select: "id, created_at", // Added created_at to select
            where: "active = true",
            orderby: "created_at DESC",
            limit: 20,
            skip: 10
        };
        const result = renderQuery(query, "user");

        const q = result.entriesQuery.toString();
        // Just check full string
        expect(q).toBe("SELECT id, created_at FROM type::table($table) WHERE active = true ORDER BY created_at DESC LIMIT 20 START 10");
        await checkExecution(result);
    });

    test("generates query with fetch parameter", async () => {
        const query: ParsedQuery = {};
        const fetch = ["author", "comments"];
        const result = renderQuery(query, "user", fetch);

        expect(result.entriesQuery.toString()).toContain("FETCH type::field($fetch0), type::field($fetch1)");
        expect(result.parameters["$fetch0"]).toBe("author");
        expect(result.parameters["$fetch1"]).toBe("comments");
        await checkExecution(result);
    });

    test("generates count query", async () => {
        const query: ParsedQuery = {
            limit: 10,
            skip: 5,
            where: "active = true"
        };
        const result = renderQuery(query, "user");

        // Count query should ignore limit/skip/fetch/orderby but KEEP where
        expect(result.countQuery?.toString()).toBe("SELECT count() FROM type::table($table) WHERE active = true GROUP ALL");
        await checkExecution(result);
    });

    test("handles $expand", async () => {
        const query: ParsedQuery = {
            includes: [{
                navigationProperty: "profile",
                select: "*",
                parameters: new Map(),
                includes: []
            } as any]
        };
        const result = renderQuery(query, "user");

        // Logic appends expand path to select: select += ', ' + include.navigationProperty + '.' + include.select;
        // select default is *
        expect(result.entriesQuery.toString()).toContain(", profile.*");

        // This execution might fail if syntax is unexpected by Surreal for existing tables/fields,
        // but let's try.
        await checkExecution(result);
    });

    test("handles parameters", async () => {
        const query: ParsedQuery = {
            where: "age > $p1",
            parameters: new Map([["$p1", 18]])
        };
        const result = renderQuery(query, "user");

        expect(result.parameters["$p1"]).toBe(18);
        expect(result.entriesQuery.toString()).toContain("age > $p1");
        await checkExecution(result);
    });

    test("handles fetch with existing select", async () => {
        const query: ParsedQuery = {
            select: "id, title"
        };
        const fetch = ["author"];
        const result = renderQuery(query, "user", fetch);

        expect(result.entriesQuery.toString()).toBe("SELECT id, title FROM type::table($table) FETCH type::field($fetch0)");
        await checkExecution(result);
    });
});
