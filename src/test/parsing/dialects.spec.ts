
import { describe, expect, it } from "bun:test";
import { createQuery } from "../../parser/main";
import { SQLLang } from "../../parser/visitors";

describe("Dialect SQL Generation", () => {
    const odataQuery = "$filter=indexof(Name, 'John') gt -1";

    it("should generate MsSql syntax for indexof", () => {
        const result = createQuery(odataQuery, {}, SQLLang.MsSql);
        // MsSqlVisitor forces useParameters: true, so literals are bound as
        // parameters rather than inlined (prevents SQL injection).
        expect(result.where).toContain("(CHARINDEX($literal1, [Name]) - 1) > $literal2");
        expect(result.parameters.get("$literal1")).toBe("John");
        expect(result.parameters.get("$literal2")).toBe(-1);
    });

    it("should generate MySql syntax for indexof", () => {
        const result = createQuery(odataQuery, {}, SQLLang.MySql);
        expect(result.where).toContain("(LOCATE('John', [Name]) - 1) > -1");
    });

    it("should generate PostgreSql syntax for indexof", () => {
        const result = createQuery(odataQuery, {}, SQLLang.PostgreSql);
        expect(result.where).toContain("(POSITION('John' IN [Name]) - 1) > -1");
    });

    it("should generate ANSI syntax (default) for indexof", () => {
        const result = createQuery(odataQuery, {});
        // Default Visitor uses LOCATE as implemented in visitor.ts generic VisitMethodCallExpression
        expect(result.where).toContain("(LOCATE('John', [Name]) - 1) > -1");
    });

    it("should generate Oracle syntax for indexof", () => {
        // OracleVisitor overrides indexof to use INSTR (Oracle's native string search)
        const result = createQuery(odataQuery, { useParameters: true }, SQLLang.Oracle);
        expect(result.where).toContain("INSTR");
    });
});
