import { describe, expect, it } from 'bun:test';
import { resourcePath } from '../../parser/parser';

describe('Custom OData URI Parsing', () => {

    // Helper to safely parse and return result or throw error
    const parse = (input: string) => {
        try {
            return resourcePath(input);
        } catch (e) {
            throw e;
        }
    };

    it('should parse standard OData format with single quoted ID', () => {
        const input = "/finding('finding:01kfgn3m9wbk30t62pp2gpvghc')";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse unquoted ID in parenthesis', () => {
        const input = "/finding(finding:01kfgn3m9wbk30t62pp2gpvghc)";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse slash separated ID', () => {
        const input = "/finding/finding:01kfgn3m9wbk30t62pp2gpvghc";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse standard OData format with partial ID (quoted)', () => {
        const input = "/finding('01kfgn3m9wbk30t62pp2gpvghc')";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse unquoted partial ID in parenthesis', () => {
        const input = "/finding(01kfgn3m9wbk30t62pp2gpvghc)";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse slash separated partial ID', () => {
        const input = "/finding/01kfgn3m9wbk30t62pp2gpvghc";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse comma delimited IDs (quoted)', () => {
        const input = "/finding('from','to')";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse comma delimited IDs (unquoted)', () => {
        const input = "/finding(from,to)";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse comma delimited IDs (mixed quoted/unquoted)', () => {
        const input = "/finding('from',to)";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse colon separated ID', () => {
        const input = "/finding:01kfgn3m9wbk30t62pp2gpvghc";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });

    it('should parse record range', () => {
        const input = "/finding(12345..23456)";
        const result = parse(input);
        expect(result).toBeDefined();
        expect(result.type).toBe('ResourcePath');
        expect(result.value.resource.value.name).toBe('finding');
        expect(result.value.navigation).toBeDefined();
    });
});
