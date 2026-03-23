import { describe, expect, test } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

describe('Prefixed Literal Parsing', () => {
    describe('Date Literals', () => {
        test('should parse d"YYYY-MM-DD" syntax', () => {
            const query = '$filter=createdAt eq d"2024-01-15"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
            expect(result.parameters).toBeDefined();
        });

        test('should parse d\'YYYY-MM-DD\' syntax', () => {
            const query = '$filter=createdAt eq d\'2024-01-15\'';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
        });

        test('should parse d`YYYY-MM-DD` syntax', () => {
            const query = '$filter=createdAt eq d`2024-01-15`';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
        });

        test('should parse datetime with time', () => {
            const query = '$filter=createdAt eq d"2024-01-15T10:30:00Z"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.parameters).toBeDefined();

            const paramValues = Array.from(result.parameters.values());
            // Date should be kept as string to preserve nanosecond precision
            const dateParam = paramValues.find(v => typeof v === 'string' && v.includes('2024-01-15'));
            expect(dateParam).toBeDefined();
            expect(dateParam).toBe('2024-01-15T10:30:00Z');
        });

        test('should handle multiple date filters', () => {
            const query = '$filter=createdAt ge d"2024-01-01" and createdAt lt d"2024-12-31"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
            expect(result.where).toContain('>=');
            expect(result.where).toContain('<');
        });
    });

    describe('Number Literals', () => {
        test('should parse n"123" syntax', () => {
            const query = '$filter=price eq n"99.99"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
            expect(result.parameters).toBeDefined();
        });

        test('should parse n\'123\' syntax', () => {
            const query = '$filter=price eq n\'99.99\'';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
        });

        test('should parse n`123` syntax', () => {
            const query = '$filter=price eq n`99.99`';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
        });

        test('should extract number value correctly', () => {
            const query = '$filter=price eq n"123.45"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.parameters).toBeDefined();

            const paramValues = Array.from(result.parameters.values());
            // Number should be kept as string to preserve decimal precision
            const numberParam = paramValues.find(v => v === '123.45');
            expect(numberParam).toBe('123.45');
        });

        test('should handle integer numbers', () => {
            const query = '$filter=quantity eq n"5"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            const paramValues = Array.from(result.parameters.values());
            const numberParam = paramValues.find(v => v === '5');
            expect(numberParam).toBe('5');
        });

        test('should handle negative numbers', () => {
            const query = '$filter=balance eq n"-50.25"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            const paramValues = Array.from(result.parameters.values());
            const numberParam = paramValues.find(v => v === '-50.25');
            expect(numberParam).toBe('-50.25');
        });

        test('should preserve large integer precision', () => {
            const query = '$filter=bigNumber eq n"9007199254740992"'; // Number larger than MAX_SAFE_INTEGER
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            const paramValues = Array.from(result.parameters.values());
            const numberParam = paramValues.find(v => v === '9007199254740992');
            expect(numberParam).toBe('9007199254740992');
        });

        test('should preserve decimal precision', () => {
            const query = '$filter=preciseAmount eq n"123.456789012345"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            const paramValues = Array.from(result.parameters.values());
            const numberParam = paramValues.find(v => v === '123.456789012345');
            expect(numberParam).toBe('123.456789012345');
        });
    });

    describe('Mixed Prefixed Literals', () => {
        test('should handle record ID, date, and number together', () => {
            const query = '$filter=customerId eq r"customers:alice" and createdAt ge d"2024-01-01" and price lt n"100"';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
            expect(result.parameters).toBeDefined();

            const paramValues = Array.from(result.parameters.values());
            expect(paramValues.length).toBeGreaterThan(0);
        });

        test('should handle different quote styles together', () => {
            const query = '$filter=id eq r"table:id" and date eq d\'2024-01-15\' and amount eq n`99.99`';
            const result = createQuery(query, { type: SQLLang.SurrealDB });

            expect(result).toBeDefined();
            expect(result.where).toBeDefined();
        });
    });
});
