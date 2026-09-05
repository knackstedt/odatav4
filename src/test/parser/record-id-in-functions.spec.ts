import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID in Function Arguments', () => {
    test('should convert RecordId in contains() function', () => {
        const query = '$filter=contains(scan, r"scan:h85bfmbybo1mzctsszakry98ge")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // The parameter should be the string record ID
        expect(result.parameters.get('$param1')).toBe('scan:h85bfmbybo1mzctsszakry98ge');

        // Verify the WHERE clause wraps the parameter with type::record()
        expect(result.where).toBe('type::field($field1) CONTAINS type::record($param1)');
    });

    test('should convert RecordId with single quotes', () => {
        const query = "$filter=contains(items, r'products:widget123')";
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('CONTAINS type::record($param1)');
        expect(result.parameters.get('$param1')).toBe('products:widget123');
    });

    test('should convert RecordId with backticks', () => {
        const query = '$filter=contains(tags, r`tags:important`)';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('CONTAINS type::record($param1)');
        expect(result.parameters.get('$param1')).toBe('tags:important');
    });

    test('should handle numeric RecordId in contains()', () => {
        const query = '$filter=contains(ids, r"users:123")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('CONTAINS type::record($param1)');
        expect(result.parameters.get('$param1')).toBe('users:123');
    });

    test('should handle regular strings in contains() without conversion', () => {
        const query = "$filter=contains(name, 'test')";
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should use type::string, NOT type::record
        expect(result.where).toContain('type::string($param1)');
        expect(result.where).not.toContain('type::record(');
        expect(result.parameters.get('$param1')).toBe('test');
    });

    test('should handle RecordId in startswith()', () => {
        const query = '$filter=startswith(prefix, r"prefix:abc")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('string::starts_with(type::field($field1), type::record($param1))');
        expect(result.parameters.get('$param1')).toBe('prefix:abc');
    });

    test('should handle RecordId in endswith()', () => {
        const query = '$filter=endswith(suffix, r"suffix:xyz")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('string::ends_with(type::field($field1), type::record($param1))');
        expect(result.parameters.get('$param1')).toBe('suffix:xyz');
    });
});
