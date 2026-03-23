import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Simple Numeric Comparisons', () => {
    test('should generate clean SQL for age > 25', () => {
        const query = '$filter=age gt 25';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Should NOT contain string::is_record or string::split
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');
        
        // Should be a simple comparison
        expect(result.where).toContain('>');
        expect(result.where).toContain('type::field');
    });

    test('should generate clean SQL for combined numeric and RecordId comparison', () => {
        const query = '$filter=age gt 25 and customerId eq r\'customers:alice\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).toBeDefined();
        
        // Should NOT contain string::is_record or string::split
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');
        
        // Should contain type::record for the RecordId
        expect(result.where).toContain('type::record');
        
        // Should have clean numeric comparison
        expect(result.where).toContain('>');
    });

    test('should handle multiple numeric comparisons', () => {
        const query = '$filter=age gt 25 and price lt 100';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');
    });

    test('should handle numeric equality', () => {
        const query = '$filter=age eq 30';
        const result = createQuery(query, { type: SQLLang.SurrealDB });
        
        expect(result).toBeDefined();
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).toContain('=');
    });
});
