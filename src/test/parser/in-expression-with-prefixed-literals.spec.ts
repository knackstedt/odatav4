import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('IN Expression with Prefixed Literals', () => {
    test('should handle RecordId in IN expression', () => {
        const query = '$filter=customerId in (r"customers:alice", r"customers:bob")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should contain type::record() for RecordIds
        expect(result.where).toContain('type::record($param1)');
        expect(result.where).toContain('type::record($param2)');
        expect(result.parameters.get('$param1')).toBe('customers:alice');
        expect(result.parameters.get('$param2')).toBe('customers:bob');
    });

    test('should handle PrefixedDate in IN expression', () => {
        const query = '$filter=createdAt in (d"2024-01-15", d"2024-01-16")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should contain <datetime> cast
        expect(result.where).toContain('<datetime>$param1');
        expect(result.where).toContain('<datetime>$param2');
        expect(result.parameters.get('$param1')).toBe('2024-01-15');
        expect(result.parameters.get('$param2')).toBe('2024-01-16');
    });

    test('should handle PrefixedNumber in IN expression', () => {
        const query = '$filter=amount in (n"100.50", n"200.75")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Should contain <number> cast
        expect(result.where).toContain('<number>$param1');
        expect(result.where).toContain('<number>$param2');
        expect(result.parameters.get('$param1')).toBe('100.50');
        expect(result.parameters.get('$param2')).toBe('200.75');
    });

    test('should handle plain strings in IN expression', () => {
        const query = '$filter=status in ("active", "pending")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Regular strings should not have type casts
        expect(result.where).not.toContain('type::record(');
        expect(result.where).not.toContain('<datetime>');
        expect(result.where).not.toContain('<number>');
        expect(result.where).toContain('$param1');
        expect(result.where).toContain('$param2');
        expect(result.parameters.get('$param1')).toBe('active');
        expect(result.parameters.get('$param2')).toBe('pending');
    });

    test('should handle numeric values in IN expression', () => {
        const query = '$filter=age in (25, 30, 35)';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Regular numbers should not have type casts
        expect(result.where).not.toContain('<number>');
        expect(result.where).toContain('$param1');
        expect(result.where).toContain('$param2');
        expect(result.where).toContain('$param3');
        expect(result.parameters.get('$param1')).toBe(25);
        expect(result.parameters.get('$param2')).toBe(30);
        expect(result.parameters.get('$param3')).toBe(35);
    });

    test('should handle mixed prefixed types in IN expression', () => {
        const query = '$filter=field in (r"customers:alice", d"2024-01-01", n"100")';
        const result = createQuery(query, { type: SQLLang.SurrealDB });

        // Each element should have its respective type cast
        expect(result.where).toContain('type::record($param1)');
        expect(result.where).toContain('<datetime>$param2');
        expect(result.where).toContain('<number>$param3');
        expect(result.parameters.get('$param1')).toBe('customers:alice');
        expect(result.parameters.get('$param2')).toBe('2024-01-01');
        expect(result.parameters.get('$param3')).toBe('100');
    });
});
