
import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';
import { ODataV4ParseError } from '../parser/utils';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
};

describe('Comprehensive OData $expand Test Suite', () => {

    describe('Structure & Parsing', () => {
        it('Basic Expansion', () => {
            const result = parse('$expand=Friends');
            expect(result.includes).toHaveLength(1);
            expect(result.includes[0].navigationProperty).toBe('Friends');
        });

        it('Multiple Expansions', () => {
            const result = parse('$expand=Friends,Family,Pets');
            expect(result.includes).toHaveLength(3);
            expect(result.includes.find(i => i.navigationProperty === 'Friends')).toBeDefined();
            expect(result.includes.find(i => i.navigationProperty === 'Family')).toBeDefined();
            expect(result.includes.find(i => i.navigationProperty === 'Pets')).toBeDefined();
        });

        it('Nested Expansion', () => {
            const result = parse('$expand=Friends($expand=Photos)');
            const friends = result.includes.find(i => i.navigationProperty === 'Friends');
            expect(friends).toBeDefined();
            expect(friends?.includes).toHaveLength(1);
            expect(friends?.includes[0].navigationProperty).toBe('Photos');
        });

        it('Deep Nested Expansion', () => {
            const result = parse('$expand=A($expand=B($expand=C($expand=D)))');
            let current = result.includes[0];
            expect(current.navigationProperty).toBe('A');
            current = current.includes[0];
            expect(current.navigationProperty).toBe('B');
            current = current.includes[0];
            expect(current.navigationProperty).toBe('C');
            current = current.includes[0];
            expect(current.navigationProperty).toBe('D');
        });
    });

    describe('Expansion Options', () => {
        it('$filter inside $expand', () => {
            const result = parse('$expand=Friends($filter=Age gt 18)');
            const friends = result.includes[0];
            expect(friends.where).toContain('type::field($field1) > $literal1');
        });

        it('$select inside $expand', () => {
            const result = parse('$expand=Friends($select=Name,Age)');
            const friends = result.includes[0];
            expect(friends.select).toContain('type::field($select0)');
            expect(friends.select).toContain('type::field($select1)');
        });

        it('$orderby inside $expand', () => {
            const result = parse('$expand=Friends($orderby=Name desc)');
            const friends = result.includes[0];
            expect(friends.orderby).toContain('`Name` DESC');
        });

        it('$top and $skip inside $expand', () => {
            const result = parse('$expand=Friends($top=10;$skip=5)');
            const friends = result.includes[0];
            expect(friends.limit).toBe(10);
            expect(friends.skip).toBe(5);
        });

        it('$count inside $expand', () => {
            // $count inside expand usually means inlinecount
            const result = parse('$expand=Friends($count=true)');
            const friends = result.includes[0];
            expect(friends.inlinecount).toBe(true);
        });
    });

    describe('Complex Scenarios', () => {
        it('Multiple options combined', () => {
            const result = parse('$expand=Friends($select=Name;$filter=Age gt 18;$orderby=Age desc;$top=5)');
            const friends = result.includes[0];
            expect(friends.select).toBeDefined();
            expect(friends.where).toContain('>');
            expect(friends.orderby).toContain('DESC');
            expect(friends.limit).toBe(5);
        });

        it('Nested options with inner expansion', () => {
            const result = parse('$expand=Friends($filter=Active eq true;$expand=Photos($select=Url;$top=1))');
            const friends = result.includes[0];
            expect(friends.where).toContain('$literal1');
            expect(friends.parameters.get('$literal1')).toBe(true);

            const photos = friends.includes[0];
            expect(photos.navigationProperty).toBe('Photos');
            expect(photos.limit).toBe(1);
            expect(photos.select).toBeDefined();
        });

        it('Parallel expansions with different options', () => {
            const result = parse('$expand=Friends($select=Name),Family($select=Address)');
            const friends = result.includes.find(i => i.navigationProperty === 'Friends');
            const family = result.includes.find(i => i.navigationProperty === 'Family');

            expect(friends).toBeDefined();
            expect(friends?.select).toBeDefined();

            expect(family).toBeDefined();
            expect(family?.select).toBeDefined();
        });
    });

    describe('Advanced Expansion Scenarios', () => {
        it('Extreme Nesting (Recursive)', () => {
            // A(B(C(D...)))
            const depth = 20; // 20 levels deep
            let query = '$expand=Level0';
            for (let i = 1; i < depth; i++) {
                query = query.replace(/Level\d+$/, `Level${i - 1}($expand=Level${i})`);
            }
            // Manually construct correct string:
            // Level0($expand=Level1($expand=Level2...))
            // Actually replace logic above is flawed.
            let nested = 'Level' + (depth - 1);
            for (let i = depth - 2; i >= 0; i--) {
                nested = `Level${i}($expand=${nested})`;
            }
            // nested is now Level0($expand=Level1(...))

            const result = createQuery(`$expand=${nested}`, { type: SQLLang.SurrealDB, maxExpandDepth: 100, maxExpandCount: 100 });
            let current = result.includes[0];
            for (let i = 0; i < depth - 1; i++) {
                expect(current.navigationProperty).toBe(`Level${i}`);
                expect(current.includes).toHaveLength(1);
                current = current.includes[0];
            }
            expect(current.navigationProperty).toBe(`Level${depth - 1}`);
        });

        it('Branching Expansion', () => {
            // A(B,C(D,E))
            const result = parse('$expand=A($expand=B,C($expand=D,E))');
            const A = result.includes[0];
            expect(A.navigationProperty).toBe('A');
            expect(A.includes).toHaveLength(2);

            const B = A.includes.find(i => i.navigationProperty === 'B');
            const C = A.includes.find(i => i.navigationProperty === 'C');
            expect(B).toBeDefined();
            expect(C).toBeDefined();

            expect(C?.includes).toHaveLength(2);
            expect(C?.includes.find(i => i.navigationProperty === 'D')).toBeDefined();
            expect(C?.includes.find(i => i.navigationProperty === 'E')).toBeDefined();
        });

        it('Whitespace Handling', () => {
            const result = parse('$expand=  Friends  ( $select = Name ; $top = 5 )');
            expect(result.includes).toHaveLength(1);
            const friends = result.includes[0];
            expect(friends.navigationProperty).toBe('Friends');
            expect(friends.limit).toBe(5);
            expect(friends.select).toContain('Name'); // or parameterized
        });

        it('Parameter Collisions in Nested Filters', () => {
            // ensure we don't accidentally overwrite parameters in sibling expansions
            const result = parse('$expand=A($filter=Val eq 1),B($filter=Val eq 2)');
            const A = result.includes.find(i => i.navigationProperty === 'A');
            const B = result.includes.find(i => i.navigationProperty === 'B');

            // Check generated SQL or parameters map
            // We can check the global parameters map of the root result?
            // Actually, 'includes' are Visitors which have their own context/parameters?
            // No, `visitor.ts` shares `parameterSeed` but might use separate `parameters` map if new Visitor created?
            // Looking at `VisitExpand`: `visitor = new Visitor(this.options); visitor.parameterSeed = this.parameterSeed;`
            // So they SHARE the seed counter, but have DIFFERENT maps.
            // This is fine as long as they generate unique parameter NAMES if valid across global context (e.g. if we merged them).
            // But `ODataV4ToSurrealQL` probably merges them?
            // In `query-renderer.ts`, it iterates includes and merges parameters into the main map!
            // So names MUST be unique.

            const paramA = A!.where.match(/\$literal\d+/)?.[0];
            const paramB = B!.where.match(/\$literal\d+/)?.[0];

            expect(paramA).toBeDefined();
            expect(paramB).toBeDefined();
            expect(paramA).not.toBe(paramB); // Should be different seeds
        });
    });

    describe('Error Handling', () => {
        it('should throw on unbalanced parenthesis', () => {
            expect(() => parse('$expand=Friends(')).toThrow(ODataV4ParseError);
        });

        it('should throw on invalid option', () => {
            expect(() => parse('$expand=Friends($unknown=1)')).toThrow(); // Lexer might fail or visitor
        });

        it('should throw on missing closing parenthesis for option', () => {
            expect(() => parse('$expand=Friends($filter=Age gt 18')).toThrow();
        });

        it('should throw on malformed options separator', () => {
            // Expected ; or )
            expect(() => parse('$expand=Friends($top=1 $skip=1)')).toThrow();
        });
    });

    describe('SQL Generation (SurrealDB)', () => {
        it('Generates FETCH for simple expand', () => {
            const result = parse('$expand=Friends');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
        });

        it('Generates FETCH for multiple expands', () => {
            const result = parse('$expand=Friends,Family');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
            expect(sql).toContain('Family');
        });

        it('Generates FETCH for nested expand', () => {
            const result = parse('$expand=Friends($expand=Photos)');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends.Photos');
        });

        it('Generates FETCH for deep nested expand', () => {
            const result = parse('$expand=Friends($expand=Photos($expand=Tags))');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends.Photos.Tags');
            // Should also presumably fetch intermediate? SurrealDB `FETCH a.b.c` implies a, a.b, a.b.c?
            // Actually Surreal `FETCH` takes comma separated list.
            // checking if it generates `FETCH Friends, Friends.Photos, Friends.Photos.Tags`?
            // implementation `getFetchPaths` seems to recurse.
        });

        it('Generates valid SQL for expand with options', () => {
            const result = parse('$expand=Friends($filter=Age gt 18)');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
        });
    });
});
