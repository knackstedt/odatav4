import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID in Function Arguments', () => {
    test('should convert RecordId in contains() function', () => {
        const query = '$filter=contains(scan, r"scan:h85bfmbybo1mzctsszakry98ge")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        expect(result.parameters).toBeDefined();

        // Check that the parameter is a string (for clean JSON serialization)
        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('scan:'));
        expect(recordIdParam).toBe('scan:h85bfmbybo1mzctsszakry98ge');
    });

    test('should convert RecordId with single quotes', () => {
        const query = "$filter=contains(items, r'products:widget123')";
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('products:'));
        expect(recordIdParam).toBe('products:widget123');
    });

    test('should convert RecordId with backticks', () => {
        const query = '$filter=contains(tags, r`tags:important`)';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('tags:'));
        expect(recordIdParam).toBe('tags:important');
    });

    test('should handle numeric RecordId in contains()', () => {
        const query = '$filter=contains(ids, r"users:123")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('users:'));
        expect(recordIdParam).toBe('users:123');
    });

    test('should handle regular strings in contains() without conversion', () => {
        const query = "$filter=contains(name, 'test')";
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        // Should be a string, not a RecordId
        const stringParam = paramValues.find(v => typeof v === 'string' && v === 'test');
        expect(stringParam).toBe('test');
    });

    test('should handle RecordId in startswith()', () => {
        const query = '$filter=startswith(prefix, r"prefix:abc")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('prefix:'));
        expect(recordIdParam).toBe('prefix:abc');
    });

    test('should handle RecordId in endswith()', () => {
        const query = '$filter=endswith(suffix, r"suffix:xyz")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v.includes('suffix:'));
        expect(recordIdParam).toBe('suffix:xyz');
    });
});
