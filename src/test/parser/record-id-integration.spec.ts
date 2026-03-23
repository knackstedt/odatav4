import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID Integration Tests', () => {
    test('should create string parameter and use type::record() in query', () => {
        const query = '$filter=customerId eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        expect(result.parameters).toBeDefined();

        // Check that the parameter is a string
        const paramValues = Array.from(result.parameters.values());
        const recordIdParam = paramValues.find(v => typeof v === 'string' && v === 'customers:alice');
        expect(recordIdParam).toBe('customers:alice');

        // Verify query uses type::record()
        expect(result.where).toContain('type::record(');
    });

    test('should handle multiple RecordId parameters', () => {
        const query = '$filter=customerId eq r"customers:alice" and productId eq r"products:widget"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result).toBeDefined();
        expect(result.parameters).toBeDefined();

        const paramValues = Array.from(result.parameters.values());
        const recordIdParams = paramValues.filter(v => typeof v === 'string' && (v.includes(':') && !v.includes('customerId') && !v.includes('productId')));

        expect(recordIdParams.length).toBe(2);
    });

    test('should generate correct WHERE clause with RecordId', () => {
        const query = '$filter=customerId eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toBeDefined();
        expect(result.where).toContain('type::field');
        expect(result.where).toContain('=');
        expect(result.where).toContain('$literal');
    });

    test('should handle ne operator with RecordId', () => {
        const query = '$filter=customerId ne r"customers:bob"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toBeDefined();
        expect(result.where).toContain('!=');
    });
});
