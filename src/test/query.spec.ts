import { createQuery, SQLLang } from '../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
}

describe('Query string processing', () => {
    test('filter', () => {
        const result = parse('$filter=value eq 123');
        expect(result.where).toContain('type::field($field1) = $literal1');
    });
    test('top', () => {
        const result = parse('$top=5');
        expect(result.limit).toEqual(5);
    });
    test('skip', () => {
        const result = parse('$skip=10');
        expect(result.skip).toEqual(10);
    });
    test('skiptoken', () => {
        const result = parse('$skiptoken=llamas');
        expect(result.skipToken).toEqual("llamas");
    });
    test('count', () => {
        const result = parse('$count=true');
        expect(result.inlinecount).toEqual(true);
    });
    test('select', () => {
        const result = parse('$select=id,label');
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });
    test('orderby', () => {
        const result = parse('$orderby=id,label');
        expect(result.orderby).toContain('id ASC, label ASC');
    });
    test('format', () => {
        const result = parse('$format=atom');
        expect(result.format).toEqual('atom');
    });

    // test('search', () => {
    //     const result = parse('$search=atom');
    //     expect(result.search).toEqual('atom');
    // });

    // test('expand', () => {
    //     const result = createQuery('$filter=value eq 123');
    //     expect(result).toContain('type::field($field1) = $literal1');
    // });

    test('Multi-prop 1', () => {
        const result = parse('$filter=value eq 123&$top=5&$skip=10&$count=true&$select=id,label');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    test('Multi-prop 2', () => {
        const result = parse('$select=id,label&$filter=value eq 123&$top=5&$skip=10&$count=true');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    test('Multi-prop 3', () => {
        const result = parse('$count=true&$select=id,label&$filter=value eq 123&$top=5&$skip=10');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });

    test('Multi-prop 4', () => {
        const result = parse('$skip=10&$count=true&$select=id,label&$filter=value eq 123&$top=5');
        expect(result.where).toContain('type::field($field1) = $literal1');
        expect(result.limit).toEqual(5);
        expect(result.skip).toEqual(10);
        expect(result.inlinecount).toEqual(true);
        expect(result.select).toContain('type::field($select0), type::field($select1)');
    });
});
