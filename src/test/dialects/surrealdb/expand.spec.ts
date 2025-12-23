import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { renderQuery } from '../../../parser/query-renderer';
import { ODataV4ParseError } from '../../../parser/utils';

declare global {
    var db: any;
}

const parse = async (input: string) => {
    const query = createQuery(input, { type: SQLLang.SurrealDB });

    if (globalThis.db) {
        // Try to execute. We need a table. 'user' exists.
        // We can use renderQuery if Visitor is compatible, or use query.from() if it exists.
        // The existing tests use result.from('Users'). Let's use that if available.
        // If not, we might need to rely on what renderQuery does.
        // But renderQuery requires ParsedQuery which Visitor implements structure-wise.

        // However, result.from might just return the string.
        // Let's rely on renderQuery for execution safety/consistency if possible,
        // OR just try to run what .from('user') returns.

        const rendered = renderQuery(query as any, 'user');
        const sql = rendered.entriesQuery.toString();
        const params = rendered.parameters;

        // Clean params
        const dbParams: any = {};
        if (params instanceof Map) {
            params.forEach((v, k) => {
                dbParams[k.replace(/^\$/, '')] = v;
            });
        } else if (params) {
            for (const k in params) {
                dbParams[k.replace(/^\$/, '')] = params[k];
            }
        }

        try {
            await globalThis.db.query(sql, dbParams);
        } catch (e: any) {
            throw new Error(`DB Execution Failed: ${e.message}\nQuery: ${sql}`);
        }
    }

    return query;
};

describe('Comprehensive OData $expand Test Suite', () => {

    describe('Structure & Parsing', () => {
        it('Basic Expansion', async () => {
            const result = await parse('$expand=Friends');
            expect(result.includes).toHaveLength(1);
            expect(result.includes[0].navigationProperty).toBe('Friends');
        });

        it('Multiple Expansions', async () => {
            const result = await parse('$expand=Friends,Family,Pets');
            expect(result.includes).toHaveLength(3);
            expect(result.includes.find(i => i.navigationProperty === 'Friends')).toBeDefined();
            expect(result.includes.find(i => i.navigationProperty === 'Family')).toBeDefined();
            expect(result.includes.find(i => i.navigationProperty === 'Pets')).toBeDefined();
        });

        it('Nested Expansion', async () => {
            const result = await parse('$expand=Friends($expand=Photos)');
            const friends = result.includes.find(i => i.navigationProperty === 'Friends');
            expect(friends).toBeDefined();
            expect(friends?.includes).toHaveLength(1);
            expect(friends?.includes[0].navigationProperty).toBe('Photos');
        });

        it('Deep Nested Expansion', async () => {
            const result = await parse('$expand=A($expand=B($expand=C($expand=D)))');
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
        it('$filter inside $expand', async () => {
            const result = await parse('$expand=Friends($filter=Age gt 18)');
            const friends = result.includes[0];
            expect(friends.where).toContain('type::field($field1) > $literal1');
        });

        it('$select inside $expand', async () => {
            const result = await parse('$expand=Friends($select=Name,Age),Shipper($select=Name)');
            const friends = result.includes[0];
            const shipper = result.includes[1];
            expect(friends.select).toContain('type::field($select_expanded_0) AS `Name`');
            expect(friends.select).toContain('type::field($select_expanded_1) AS `Age`');
            expect(shipper.select).toContain('type::field($select_expanded_2) AS `Name`');
        });

        it('$orderby inside $expand', async () => {
            const result = await parse('$expand=Friends($orderby=Name desc)');
            const friends = result.includes[0];
            expect(friends.orderby).toContain('`Name` DESC');
        });

        it('$top and $skip inside $expand', async () => {
            const result = await parse('$expand=Friends($top=10;$skip=5)');
            const friends = result.includes[0];
            expect(friends.limit).toBe(10);
            expect(friends.skip).toBe(5);
        });

        it('$count inside $expand', async () => {
            // $count inside expand usually means inlinecount
            const result = await parse('$expand=Friends($count=true)');
            const friends = result.includes[0];
            expect(friends.inlinecount).toBe(true);
        });
    });

    describe('Complex Scenarios', () => {
        it('Multiple options combined', async () => {
            const result = await parse('$expand=Friends($select=Name;$filter=Age gt 18;$orderby=Age desc;$top=5)');
            const friends = result.includes[0];
            expect(friends.select).toBeDefined();
            expect(friends.where).toContain('>');
            expect(friends.orderby).toContain('DESC');
            expect(friends.limit).toBe(5);
        });

        it('Nested options with inner expansion', async () => {
            const result = await parse('$expand=Friends($filter=Active eq true;$expand=Photos($select=Url;$top=1))');
            const friends = result.includes[0];
            expect(friends.where).toContain('$literal1');
            expect(friends.parameters.get('$literal1')).toBe(true);

            const photos = friends.includes[0];
            expect(photos.navigationProperty).toBe('Photos');
            expect(photos.limit).toBe(1);
            expect(photos.select).toBeDefined();
        });

        it('Parallel expansions with different options', async () => {
            const result = await parse('$expand=Friends($select=Name),Family($select=Address)');
            const friends = result.includes.find(i => i.navigationProperty === 'Friends');
            const family = result.includes.find(i => i.navigationProperty === 'Family');

            expect(friends).toBeDefined();
            expect(friends?.select).toBeDefined();

            expect(family).toBeDefined();
            expect(family?.select).toBeDefined();
        });
    });

    describe('Advanced Expansion Scenarios', () => {
        it('Extreme Nesting (Recursive)', async () => {
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
            // Manual check for recursion, no DB check needed or we can await if we change this to parse()
            // But this calls createQuery directly to pass options.
            // Let's use await parse pattern if possible or just manual.

            let current = result.includes[0];
            for (let i = 0; i < depth - 1; i++) {
                expect(current.navigationProperty).toBe(`Level${i}`);
                expect(current.includes).toHaveLength(1);
                current = current.includes[0];
            }
            expect(current.navigationProperty).toBe(`Level${depth - 1}`);
        });

        it('Branching Expansion', async () => {
            // A(B,C(D,E))
            const result = await parse('$expand=A($expand=B,C($expand=D,E))');
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

        it('Whitespace Handling', async () => {
            const result = await parse('$expand=  Friends  ( $select = Name ; $top = 5 )');
            expect(result.includes).toHaveLength(1);
            const friends = result.includes[0];
            expect(friends.navigationProperty).toBe('Friends');
            expect(friends.limit).toBe(5);
            expect(friends.select).toContain('Name');
        });

        it('Parameter Collisions in Nested Filters', async () => {
            // ensure we don't accidentally overwrite parameters in sibling expansions
            const result = await parse('$expand=A($filter=Val eq 1),B($filter=Val eq 2)');
            const A = result.includes.find(i => i.navigationProperty === 'A');
            const B = result.includes.find(i => i.navigationProperty === 'B');

            const paramA = A!.where.match(/\$literal\d+/)?.[0];
            const paramB = B!.where.match(/\$literal\d+/)?.[0];

            expect(paramA).toBeDefined();
            expect(paramB).toBeDefined();
            expect(paramA).not.toBe(paramB);
        });
    });

    describe('Error Handling', () => {
        it('should throw on unbalanced parenthesis', () => {
            expect(parse('$expand=Friends(')).rejects.toThrow(ODataV4ParseError);
        });

        it('should throw on invalid option', () => {
            expect(parse('$expand=Friends($unknown=1)')).rejects.toThrow();
        });

        it('should throw on missing closing parenthesis for option', () => {
            expect(parse('$expand=Friends($filter=Age gt 18')).rejects.toThrow();
        });

        it('should throw on malformed options separator', () => {
            expect(parse('$expand=Friends($top=1 $skip=1)')).rejects.toThrow();
        });
    });

    describe('SQL Generation (SurrealDB)', () => {
        it('Generates FETCH for simple expand', async () => {
            const result = await parse('$expand=Friends');
            const sql = (result as any).from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
        });

        it('Generates FETCH for multiple expands', async () => {
            const result = await parse('$expand=Friends,Family');
            const sql = (result as any).from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
            expect(sql).toContain('Family');
        });

        it('Generates FETCH for nested expand', async () => {
            const result = await parse('$expand=Friends($expand=Photos)');
            const sql = (result as any).from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends.Photos');
        });

        it('Generates FETCH for deep nested expand', async () => {
            const result = await parse('$expand=Friends($expand=Photos($expand=Tags))');
            const sql = (result as any).from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends.Photos.Tags');
        });

        it('Generates valid SQL for expand with options', async () => {
            const result = await parse('$expand=Friends($filter=Age gt 18)');
            const sql = (result as any).from('Users');
            expect(sql).toContain('FETCH');
            expect(sql).toContain('Friends');
        });
    });
});
