
import { describe, expect, it } from "bun:test";
import { createQuery } from "../../parser/main";
import { SQLLang } from "../../parser/visitors";

describe("Dialect SQL Generation", () => {
    const odataQuery = "$filter=indexof(Name, 'John') gt -1";

    it("should generate MsSql syntax for indexof", () => {
        const result = createQuery(odataQuery, {}, SQLLang.MsSql);
        expect(result.where).toContain("(CHARINDEX('John', [Name]) - 1) > -1");
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
        // OracleVisitor extends Visitor and uses default implementation currently
        const result = createQuery(odataQuery, { useParameters: true }, SQLLang.Oracle);
        // It might be different if I implemented specific Oracle logic, but I didn't override MethodCallExpression in OracleVisitor.
        // It should match generic Visitor.
        expect(result.where).toContain("LOCATE");
    });
});
