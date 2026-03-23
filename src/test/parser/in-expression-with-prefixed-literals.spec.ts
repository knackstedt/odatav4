import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('IN Expression with Prefixed Literals', () => {
    test('should handle RecordId in IN expression', () => {
        const query = '$filter=customerId in (r"customers:alice", r"customers:bob")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Should contain type::record() for RecordIds
        expect(result.where).toContain('type::record(');
        
        // Should have string parameters
        const paramValues = Array.from(result.parameters.values());
        expect(paramValues).toContain('customers:alice');
        expect(paramValues).toContain('customers:bob');
    });

    test('should handle PrefixedDate in IN expression', () => {
        const query = '$filter=createdAt in (d"2024-01-15", d"2024-01-16")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Should contain <datetime> cast
        expect(result.where).toContain('<datetime>');
        
        // Should have string parameters
        const paramValues = Array.from(result.parameters.values());
        expect(paramValues).toContain('2024-01-15');
        expect(paramValues).toContain('2024-01-16');
    });

    test('should handle PrefixedNumber in IN expression', () => {
        const query = '$filter=amount in (n"100.50", n"200.75")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Should contain <number> cast
        expect(result.where).toContain('<number>');
        
        // Should have string parameters
        const paramValues = Array.from(result.parameters.values());
        expect(paramValues).toContain('100.50');
        expect(paramValues).toContain('200.75');
    });

    test('should handle mixed types in IN expression', () => {
        const query = '$filter=status in ("active", "pending")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Regular strings should not have type casts
        expect(result.where).not.toContain('type::record(');
        expect(result.where).not.toContain('<datetime>');
        expect(result.where).not.toContain('<number>');
    });

    test('should handle numeric values in IN expression', () => {
        const query = '$filter=age in (25, 30, 35)';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Regular numbers should not have type casts
        expect(result.where).not.toContain('<number>');
    });
});
