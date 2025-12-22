import { describe, expect, test } from "bun:test";
import { createQuery } from "../../parser/main";
import { ODataV4ParseError } from "../../parser/utils";

describe("DoS Protection", () => {

    describe("Recursion Depth Limits", () => {
        test("should allow recursion up to default limit (5)", () => {
            // A(B(C(D(E)))) -> Depth 4 (Wait, is it 0-indexed?)
            // A (depth 0) -> B (depth 1) -> ...
            // Let's test a clear chain.
            const query = "$expand=A($expand=B($expand=C($expand=D($expand=E))))";
            expect(() => createQuery(query)).not.toThrow();
        });

        test("should throw when recursion exceeds default limit", () => {
            // A->B->C->D->E->F (Depth 6 if root is 1? Or 5 if root is 0?)
            // Implementation uses: visitor.expandDepth = this.expandDepth + 1;
            // Root visitor has depth 0?
            // VisitExpand does: if (this.expandDepth >= maxDepth)
            // Initial visitor has depth 0.
            // When expanding A, it creates child with depth 1.
            // Recursion happens inside the options of A.
            // So A is processed by child (depth 1).
            // A's options ($expand=B) are processed by visitor with depth 1.
            // VisitExpand called on visitor(depth 1). Check: 1 >= 5? False.
            // B creates child with depth 2.
            // ...
            // E creates child with depth 5.
            // E's options ($expand=F) processed by visitor(depth 5).
            // VisitExpand called on visitor(depth 5). Check: 5 >= 5? True! Throw!
            // So chain of length 6 (A->B->C->D->E->F) should fail if max is 5.

            const query = "$expand=A($expand=B($expand=C($expand=D($expand=E($expand=F)))))";
            expect(() => createQuery(query)).toThrow(ODataV4ParseError);
            expect(() => createQuery(query)).toThrow("Maximum expansion depth of 5 exceeded");
        });

        test("should respect configured maxExpandDepth", () => {
            const query = "$expand=A($expand=B)";
            // Depth 2. Default is 5. Should pass normally.
            expect(() => createQuery(query)).not.toThrow();

            // Configured limit 1
            // A (depth 1) ok.
            // A's options ($expand=B). Visitor(depth 1) calls VisitExpand. 1 >= 1? True. Throw.
            expect(() => createQuery(query, { maxExpandDepth: 1 })).toThrow("Maximum expansion depth of 1 exceeded");
        });
    });

    describe("Expansion Count Limits", () => {
        test("should allow expansions up to default limit (10)", () => {
            // 10 expansions
            const query = "$expand=A,B,C,D,E,F,G,H,I,J";
            expect(() => createQuery(query)).not.toThrow();
        });

        test("should throw when expansions exceed default limit", () => {
            // 11 expansions
            const query = "$expand=A,B,C,D,E,F,G,H,I,J,K";
            expect(() => createQuery(query)).toThrow(ODataV4ParseError);
            expect(() => createQuery(query)).toThrow("Maximum expansion count of 10 exceeded");
        });

        test("should count nested expansions towards the total", () => {
            // A, B(C, D)
            // A=1, B=2, C=3, D=4
            const query = "$expand=A,B($expand=C,D)";
            // If limit is 3, this should fail.
            expect(() => createQuery(query, { maxExpandCount: 3 })).toThrow("Maximum expansion count of 3 exceeded");
        });

        test("should respect configured maxExpandCount", () => {
            const query = "$expand=A,B";
            expect(() => createQuery(query, { maxExpandCount: 1 })).toThrow("Maximum expansion count of 1 exceeded");
        });
    });
});
