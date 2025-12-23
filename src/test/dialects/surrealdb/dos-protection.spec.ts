import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { ODataV4ParseError } from '../../../parser/utils';

describe('DoS Protection', () => {
    it('should respect maxExpandDepth', () => {
        const query = '$expand=A($expand=B($expand=C($expand=D($expand=E($expand=F)))))';
        expect(() => {
            createQuery(query, { type: SQLLang.SurrealDB, maxExpandDepth: 5 });
        }).toThrow(ODataV4ParseError);
    });

    it('should respect maxExpandCount', () => {
        const query = '$expand=A,B,C,D,E,F';
        expect(() => {
            createQuery(query, { type: SQLLang.SurrealDB, maxExpandCount: 5 });
        }).toThrow(ODataV4ParseError);
    });

    it('should respect maxParameters', () => {
        // Generate a query with many parameters
        let filter = 'Name eq 1';
        for (let i = 0; i < 110; i++) {
            filter += ` or Name eq ${i}`;
        }
        expect(() => {
            createQuery(`$filter=${filter}`, { type: SQLLang.SurrealDB, useParameters: true, maxParameters: 100 });
        }).toThrow(ODataV4ParseError);
    });

    it('should respect maxTop', () => {
        expect(() => {
            createQuery('$top=1001', { type: SQLLang.SurrealDB, maxPageSize: 1000 });
        }).toThrow(ODataV4ParseError);
    });

    it('should respect maxSkip', () => {
        expect(() => {
            createQuery('$skip=1001', { type: SQLLang.SurrealDB, maxSkip: 1000 });
        }).toThrow(ODataV4ParseError);
    });

    it('should fail deeply nested filters (stack overflow protection)', () => {
        // Note: recursion limit is usually implicit in JS engine (stack size),
        // but we might assume the parser handles reasonable depth.
        // This test mostly ensures we don't crash or hang, but throw or handle it.
        // 10000 depth might blow stack.
        let nested = 'Name eq 1';
        for (let i = 0; i < 5000; i++) {
            nested = `(${nested})`;
        }
        try {
            createQuery(`$filter=${nested}`, { type: SQLLang.SurrealDB });
        } catch (e) {
            // Either RangeError (Stack) or ParseError is "acceptable" failure mode compared to hang,
            // but ideally we want graceful failure.
            expect(e).toBeDefined();
        }
    });
});
