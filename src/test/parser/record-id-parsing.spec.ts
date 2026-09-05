import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID Literal Parsing', () => {
    test('should parse r"table:id" syntax', () => {
        const query = '$filter=foreignKey eq r"table:value"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.parameters.get('$literal1')).toBe('table:value');
    });

    test('should parse r\'table:id\' syntax', () => {
        const query = '$filter=foreignKey eq r\'table:othervalue\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.parameters.get('$literal1')).toBe('table:othervalue');
    });

    test('should parse r`table:id` syntax', () => {
        const query = '$filter=foreignKey eq r`table:value`';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.parameters.get('$literal1')).toBe('table:value');
    });

    test('should parse multiple record IDs with different operators', () => {
        const query = '$filter=foreignKey eq r"table:value" and foreignKey2 ne r\'table:othervalue\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.where).toContain('type::record($literal2)');
        expect(result.where).toContain('&&'); // SurrealDB uses && for AND
        expect(result.where).toContain('!='); // ne operator
        expect(result.parameters.get('$literal1')).toBe('table:value');
        expect(result.parameters.get('$literal2')).toBe('table:othervalue');
    });

    test('should extract record ID value correctly', () => {
        const query = '$filter=foreignKey eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.parameters.get('$literal1')).toBe('customers:alice');
    });
});
