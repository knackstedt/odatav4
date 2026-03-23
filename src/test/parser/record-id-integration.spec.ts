import { describe, expect, test } from 'bun:test';
import { RecordId } from 'surrealdb';
import { createQuery, SQLLang } from '../../parser/main';

describe('Record ID Integration Tests', () => {
    test('should create RecordId objects in parameters', () => {
        const query = '$filter=customerId eq r"customers:alice"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.parameters).toBeDefined();
        
        // Get the parameter values
        const paramValues = Array.from(result.parameters.values());
        expect(paramValues.length).toBe(2); // field + literal
        
        // Find the RecordId parameter
        const recordIdParam = paramValues.find(v => v instanceof RecordId);
        expect(recordIdParam).toBeDefined();
        expect(recordIdParam).toBeInstanceOf(RecordId);
        
        // Verify the RecordId has correct table and id
        if (recordIdParam instanceof RecordId) {
            expect(recordIdParam.toString()).toBe('customers:alice');
        }
    });

    test('should handle multiple RecordId parameters', () => {
        const query = '$filter=customerId eq r"customers:alice" and productId eq r"products:widget"';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.parameters).toBeDefined();
        
        const paramValues = Array.from(result.parameters.values());
        const recordIdParams = paramValues.filter(v => v instanceof RecordId);
        
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
