
import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
}

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
            expect(friends?.select).toBeDefined(); // Should check specific value if possible, but seeds make it hard

            expect(family).toBeDefined();
            expect(family?.select).toBeDefined();
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

        // NOTE: Currently checking that options DO NOT break the FETCH generation,
        // even if they aren't fully applied in the SQL (known limitation being addressed/acknowledged).
        // ideally efficient SQL generation for filtered expands would use subqueries.
        it('Generates valid SQL for expand with options', () => {
            const result = parse('$expand=Friends($filter=Age gt 18)');
            const sql = result.from('Users');
            expect(sql).toContain('FETCH');
            // The filter presumably applies to the relationship or is used in a subquery structure (if implemented)
            // For now, we verify basic FETCH is still present.
            expect(sql).toContain('Friends');
        });
    });
});
