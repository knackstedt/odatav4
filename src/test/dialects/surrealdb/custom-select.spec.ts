import { describe, expect, test } from "bun:test";
import { renderQuery } from "../../../parser/query-renderer";
import { ParsedQuery } from "../../../types";

declare global {
    var db: any;
}

const checkExecution = async (result: any) => {
    if (globalThis.db) {
        const dbParams: any = {};
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

describe("renderQuery with customSelect", () => {
    test("generates query with single custom select expression", async () => {
        const query: ParsedQuery = {};
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        expect(result.entriesQuery.toString()).toBe(
            "SELECT *, (->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding FROM type::table($table)"
        );
        expect(result.parameters["$table"]).toBe("finding");
    });

    test("generates query with multiple custom select expressions", async () => {
        const query: ParsedQuery = {};
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding",
            "(->related_to->issue.id)[0]": "related_issue"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        expect(queryStr).toContain("(->related_to->issue.id)[0] AS related_issue");
    });

    test("combines custom select with explicit select fields", async () => {
        const query: ParsedQuery = { select: "id, name" };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        expect(result.entriesQuery.toString()).toBe(
            "SELECT id, name, (->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding FROM type::table($table)"
        );
    });

    test("combines custom select with where clause", async () => {
        const query: ParsedQuery = { where: "status = 'active'" };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        expect(queryStr).toContain("WHERE status = 'active'");
    });

    test("combines custom select with orderby and limit", async () => {
        const query: ParsedQuery = {
            orderby: "created_at DESC",
            limit: 10
        };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        expect(queryStr).toContain("ORDER BY created_at DESC");
        expect(queryStr).toContain("LIMIT 10");
    });

    test("combines custom select with fetch", async () => {
        const query: ParsedQuery = {};
        const fetch = ["author", "comments"];
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", fetch, false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
        expect(queryStr).toContain("FETCH type::field($fetch0), type::field($fetch1)");
        expect(result.parameters["$fetch0"]).toBe("author");
        expect(result.parameters["$fetch1"]).toBe("comments");
    });

    test("handles empty customSelect object", async () => {
        const query: ParsedQuery = {};
        const customSelect = {};
        const result = renderQuery(query, "finding", [], false, customSelect);

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table)");
    });

    test("handles undefined customSelect", async () => {
        const query: ParsedQuery = {};
        const result = renderQuery(query, "finding", [], false, undefined);

        expect(result.entriesQuery.toString()).toBe("SELECT * FROM type::table($table)");
    });

    test("supports complex SurrealDB expressions", async () => {
        const query: ParsedQuery = {};
        const customSelect = {
            "count(->has_finding)": "finding_count",
            "math::max(->has_finding->finding.severity)": "max_severity",
            "(field1 + field2) * 100": "computed_value"
        };
        const result = renderQuery(query, "scan", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("count(->has_finding) AS finding_count");
        expect(queryStr).toContain("math::max(->has_finding->finding.severity) AS max_severity");
        expect(queryStr).toContain("(field1 + field2) * 100 AS computed_value");
    });

    test("supports array indexing and slicing", async () => {
        const query: ParsedQuery = {};
        const customSelect = {
            "tags[0]": "first_tag",
            "items[0..5]": "first_five_items",
            "nested.array[*].field": "all_fields"
        };
        const result = renderQuery(query, "test", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("tags[0] AS first_tag");
        expect(queryStr).toContain("items[0..5] AS first_five_items");
        expect(queryStr).toContain("nested.array[*].field AS all_fields");
    });

    test("combines custom select with expand", async () => {
        const query: ParsedQuery = {
            includes: [{
                navigationProperty: "profile",
                select: "*",
                parameters: new Map(),
                includes: []
            } as any]
        };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("profile.*");
        expect(queryStr).toContain("(->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding");
    });

    test("generates correct clause order with all options", async () => {
        const query: ParsedQuery = {
            select: "id, name",
            where: "active = true",
            orderby: "created_at DESC",
            limit: 20,
            skip: 10
        };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", ["author"], false, customSelect);

        const queryStr = result.entriesQuery.toString();
        expect(queryStr).toContain("SELECT id, name, (->has_canonical_finding->canonical_finding.*)[0] AS canonical_finding FROM type::table($table) WHERE active = true ORDER BY created_at DESC LIMIT 20 START 10 FETCH");
    });

    test("count query is not affected by custom select", async () => {
        const query: ParsedQuery = {
            where: "active = true"
        };
        const customSelect = {
            "(->has_canonical_finding->canonical_finding.*)[0]": "canonical_finding"
        };
        const result = renderQuery(query, "finding", [], false, customSelect);

        expect(result.countQuery?.toString()).toBe("SELECT count() FROM type::table($table) WHERE active = true GROUP ALL");
        expect(result.countQuery?.toString()).not.toContain("canonical_finding");
    });
});
