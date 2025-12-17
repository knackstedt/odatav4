import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
}

describe('Query string processing', () => {
    it('filter', () => {
        const result = parse('$filter=value eq 123');
        expect(result.where).toContain('type::field($field1) = $literal1');
    });
    it('top', () => {
        const result = parse('$top=5');
        expect(result.limit).toEqual(5);
    });
    it('skip', () => {
        const result = parse('$skip=10');
        expect(result.skip).toEqual(10);
    });
    it('skiptoken', () => {
        const result = parse('$skiptoken=llamas');
        expect(result.skipToken).toEqual("llamas");
    });
    it('count', () => {
        const result = parse('$count=true');
        expect(result.inlinecount).toEqual(true);
    });
    it('select', () => {
        const result = parse('$select=id,label');
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });
    it('orderby', () => {
        const result = parse('$orderby=id,label');
        expect(result.orderby).toContain('`id` ASC, `label` ASC');
    });
    it('format', () => {
        const result = parse('$format=atom');
        expect(result.format).toEqual('atom');
    });

    // it('search', () => {
    //     const result = parse('$search=atom');
    //     expect(result.search).toEqual('atom');
    // });

    // it('expand', () => {
    //     const result = createQuery('$filter=value eq 123');
    //     expect(result).toContain('type::field($field1) = $literal1');
    // });

    it('Multi-prop 1', () => {
        const result = parse('$filter=value eq 123&$top=5&$skip=10&$count=true&$select=id,label');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    it('Multi-prop 2', () => {
        const result = parse('$select=id,label&$filter=value eq 123&$top=5&$skip=10&$count=true');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    it('Multi-prop 3', () => {
        const result = parse('$count=true&$select=id,label&$filter=value eq 123&$top=5&$skip=10');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    it('Multi-prop 4', () => {
        const result = parse('$skip=10&$count=true&$select=id,label&$filter=value eq 123&$top=5');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });
});
