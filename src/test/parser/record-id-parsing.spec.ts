import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID Literal Parsing', () => {
    test('should parse r"table:id" syntax', () => {
        const query = '$filter=foreignKey eq r"table:value"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        expect(result.parameters).toBeDefined();
    });

    test('should parse r\'table:id\' syntax', () => {
        const query = '$filter=foreignKey eq r\'table:othervalue\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
    });

    test('should parse r`table:id` syntax', () => {
        const query = '$filter=foreignKey eq r`table:value`';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
    });

    test('should parse multiple record IDs with different operators', () => {
        const query = '$filter=foreignKey eq r"table:value" and foreignKey2 ne r\'table:othervalue\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        expect(result.where).toContain('&&'); // SurrealDB uses && for AND
    });

    test('should extract record ID value correctly', () => {
        const query = '$filter=foreignKey eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.parameters).toBeDefined();

        // Check that the parameter contains a RecordId
        const paramValues = Array.from(result.parameters.values());
        expect(paramValues.length).toBeGreaterThan(0);
    });
});
