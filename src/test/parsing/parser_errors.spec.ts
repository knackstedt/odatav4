import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
}

describe('Parser Error Handling', () => {
    it('throws error for invalid GUID format', () => {
        expect(() => parse('$filter=id eq 12345678-1234-1234-1234-1234567890ZZ')).toThrow("ODataV4ParseError");
    });

    it('throws error for invalid Date format', () => {
        expect(() => parse('$filter=date eq 2020-13-01')).toThrow("ODataV4ParseError");
    });
});
