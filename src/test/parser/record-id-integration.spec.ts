import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID Integration Tests', () => {
    test('should create string parameter and use type::record() in query', () => {
        const query = '$filter=customerId eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // The parameter should be the string record ID
        expect(result.parameters.get('$literal1')).toBe('customers:alice');

        // Verify query uses type::record()
        expect(result.where).toBe('type::field($field1) = type::record($literal1)');
    });

    test('should handle multiple RecordId parameters', () => {
        const query = '$filter=customerId eq r"customers:alice" and productId eq r"products:widget"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toContain('type::record($literal1)');
        expect(result.where).toContain('type::record($literal2)');
        expect(result.parameters.get('$literal1')).toBe('customers:alice');
        expect(result.parameters.get('$literal2')).toBe('products:widget');
    });

    test('should generate correct WHERE clause with RecordId', () => {
        const query = '$filter=customerId eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toBe('type::field($field1) = type::record($literal1)');
        expect(result.parameters.get('$field1')).toBe('customerId');
        expect(result.parameters.get('$literal1')).toBe('customers:alice');
    });

    test('should handle ne operator with RecordId', () => {
        const query = '$filter=customerId ne r"customers:bob"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).toBe('type::field($field1) != type::record($literal1)');
        expect(result.parameters.get('$literal1')).toBe('customers:bob');
    });
});
