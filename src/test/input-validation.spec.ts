import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';
import { ODataV4ParseError } from '../parser/utils';

describe('Input Validation & Security Limits', () => {

    describe('$top Validation (#6)', () => {
        it('should allow $top up to default limit (500)', () => {
            expect(() => createQuery('$top=500', { type: SQLLang.SurrealDB })).not.toThrow();
            expect(() => createQuery('$top=250', { type: SQLLang.SurrealDB })).not.toThrow();
            expect(() => createQuery('$top=1', { type: SQLLang.SurrealDB })).not.toThrow();
        });

        it('should reject $top exceeding default limit (500)', () => {
            expect(() => createQuery('$top=501', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery('$top=99999999', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
        });

        it('should respect custom maxPageSize limit', () => {
            expect(() => createQuery('$top=100', { type: SQLLang.SurrealDB, maxPageSize: 50 }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery('$top=50', { type: SQLLang.SurrealDB, maxPageSize: 50 }))
                .not.toThrow();
        });

        it('should include limit value in error message', () => {
            try {
                createQuery('$top=20000', { type: SQLLang.SurrealDB });
                expect(true).toBe(false); // Should not reach here
            } catch (e: any) {
                expect(e.message).toContain('500');
            }
        });
    });

    describe('$skip Validation (#6)', () => {
        it('should allow $skip up to default limit (1000000)', () => {
            expect(() => createQuery('$skip=1000000', { type: SQLLang.SurrealDB })).not.toThrow();
            expect(() => createQuery('$skip=500000', { type: SQLLang.SurrealDB })).not.toThrow();
            expect(() => createQuery('$skip=0', { type: SQLLang.SurrealDB })).not.toThrow();
        });

        it('should reject $skip exceeding default limit', () => {
            expect(() => createQuery('$skip=1000001', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery('$skip=99999999', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
        });

        it('should reject negative $skip', () => {
            expect(() => createQuery('$skip=-1', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery('$skip=-100', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
        });

        it('should respect custom maxSkip limit', () => {
            expect(() => createQuery('$skip=10000', { type: SQLLang.SurrealDB, maxSkip: 5000 }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery('$skip=5000', { type: SQLLang.SurrealDB, maxSkip: 5000 }))
                .not.toThrow();
        });
    });

    describe('$search Security (#1)', () => {
        it('should reject $search by default', () => {
            expect(() => createQuery('$search=test', { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
        });

        it('should reject $search with meaningful error', () => {
            try {
                createQuery('$search=foo', { type: SQLLang.SurrealDB });
                expect(true).toBe(false);
            } catch (e: any) {
                expect(e.message).toContain('disabled');
            }
        });

        it('should allow $search when explicitly enabled', () => {
            expect(() => createQuery('$search=test', { type: SQLLang.SurrealDB, enableSearch: true }))
                .not.toThrow();
        });
    });

    describe('Parameter Limit (#10)', () => {
        it('should allow queries up to default parameter limit (1000)', () => {
            // Create a filter with many parameters
            const filters = Array.from({ length: 500 }, (_, i) => `field${i} eq ${i}`);
            const query = `$filter=${filters.join(' and ')}`;
            expect(() => createQuery(query, { type: SQLLang.SurrealDB })).not.toThrow();
        });

        it('should reject queries exceeding parameter limit', () => {
            // This creates 1001 parameters (exceeds default 1000)
            const filters = Array.from({ length: 1001 }, (_, i) => `field${i} eq ${i}`);
            const query = `$filter=${filters.join(' and ')}`;
            expect(() => createQuery(query, { type: SQLLang.SurrealDB }))
                .toThrow(ODataV4ParseError);
        });

        it('should respect custom maxParameters limit', () => {
            const filters = Array.from({ length: 50 }, (_, i) => `field${i} eq ${i}`);
            const query = `$filter=${filters.join(' and ')}`;

            expect(() => createQuery(query, { type: SQLLang.SurrealDB, maxParameters: 25 }))
                .toThrow(ODataV4ParseError);
            expect(() => createQuery(query, { type: SQLLang.SurrealDB, maxParameters: 100 }))
                .not.toThrow();
        });

        it('should include limit in error message', () => {
            const filters = Array.from({ length: 1001 }, (_, i) => `field${i} eq ${i}`);
            const query = `$filter=${filters.join(' and ')}`;

            try {
                createQuery(query, { type: SQLLang.SurrealDB });
                expect(true).toBe(false);
            } catch (e: any) {
                expect(e.message).toContain('parameter limit');
                expect(e.message).toContain('1000');
            }
        });
    });

    describe('Combined Validation', () => {
        it('should validate all limits together', () => {
            const filters = Array.from({ length: 50 }, (_, i) => `f${i} eq ${i}`);
            const query = `$filter=${filters.join(' and ')}&$top=100&$skip=1000`;

            expect(() => createQuery(query, {
                type: SQLLang.SurrealDB,
                maxPageSize: 50,
                maxSkip: 500,
                maxParameters: 25
            })).toThrow(ODataV4ParseError);

            expect(() => createQuery(query, {
                type: SQLLang.SurrealDB,
                maxPageSize: 200,
                maxSkip: 2000,
                maxParameters: 100
            })).not.toThrow();
        });
    });
});
