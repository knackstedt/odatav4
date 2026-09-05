import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Simple Numeric Comparisons', () => {
    test('should generate clean SQL for age > 25', () => {
        const query = '$filter=age gt 25';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should NOT contain string::is_record or string::split
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');

        // Should be a simple comparison with field and literal parameters
        expect(result.where).toContain('type::field($field1) > $literal1');
        expect(result.parameters.get('$field1')).toBe('age');
        expect(result.parameters.get('$literal1')).toBe(25);
    });

    test('should generate clean SQL for combined numeric and RecordId comparison', () => {
        const query = '$filter=age gt 25 and customerId eq r\'customers:alice\'';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should NOT contain string::is_record or string::split
        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');

        // Should contain type::record for the RecordId
        expect(result.where).toContain('type::record($literal2)');
        expect(result.where).toContain('type::field($field1) > $literal1');
        expect(result.parameters.get('$literal1')).toBe(25);
        expect(result.parameters.get('$literal2')).toBe('customers:alice');
    });

    test('should handle multiple numeric comparisons', () => {
        const query = '$filter=age gt 25 and price lt 100';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).not.toContain('string::is_record');
        expect(result.where).not.toContain('string::split');
        expect(result.where).toContain('type::field($field1) > $literal1');
        expect(result.where).toContain('type::field($field2) < $literal2');
        expect(result.parameters.get('$field1')).toBe('age');
        expect(result.parameters.get('$literal1')).toBe(25);
        expect(result.parameters.get('$field2')).toBe('price');
        expect(result.parameters.get('$literal2')).toBe(100);
    });

    test('should handle numeric equality', () => {
        const query = '$filter=age eq 30';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        expect(result.where).not.toContain('string::is_record');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.parameters.get('$field1')).toBe('age');
        expect(result.parameters.get('$literal1')).toBe(30);
    });
});
