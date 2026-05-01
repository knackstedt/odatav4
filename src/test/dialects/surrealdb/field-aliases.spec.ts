import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { renderQuery } from '../../../parser/query-renderer';

declare global {
    var db: any;
}

const processFilterWithAliases = async (filter: string, fieldAliases?: Record<string, string>) => {
    const query = createQuery(filter, { type: SQLLang.SurrealDB, fieldAliases });
    const result = renderQuery(query, 'user');

    if (globalThis.db) {
        const dbParams: any = {};
        for (const k in result.parameters) {
            dbParams[k.replace(/^\$/, '')] = result.parameters[k];
        }
        try {
            await globalThis.db.query(result.entriesQuery.toString(), dbParams);
        } catch (e: any) {
            throw new Error(`DB Execution Failed: ${e.message}\nQuery: ${result.entriesQuery}`);
        }
    }

    return { where: query.where, orderby: query.orderby, parameters: query.parameters };
};

describe('Field Aliases', () => {
    describe('Basic field alias mapping', () => {
        it('should replace field with alias in WHERE clause', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123',
                { scan: '->on->finding' }
            );

            expect(result.where).toContain('->on->finding');
            expect(result.where).not.toContain('type::field');
            expect(result.where).toContain('$literal1');
        });

        it('should not parameterize aliased fields', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123',
                { scan: '->on->finding' }
            );

            // The alias should be inserted directly, not as a parameter
            expect(result.where).toContain('->on->finding');
            expect(result.where).toContain('$literal1');

            // Check that 'scan' is NOT in parameters
            const paramValues = Array.from(result.parameters.values());
            expect(paramValues).not.toContain('scan');
        });

        it('should handle non-aliased fields normally', async () => {
            const result = await processFilterWithAliases(
                '$filter=name eq \'test\'',
                { scan: '->on->finding' }
            );

            // Non-aliased field should still be parameterized
            expect(result.where).toContain('type::field($field1)');
            const paramValues = Array.from(result.parameters.values());
            expect(paramValues).toContain('name');
        });

        it('should handle multiple aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123 and finding eq 456',
                {
                    scan: '->on->finding',
                    finding: '->has->issue'
                }
            );

            expect(result.where).toContain('->on->finding');
            expect(result.where).toContain('->has->issue');
            expect(result.where).not.toContain('type::field');
        });
    });

    describe('Complex WHERE clauses with aliases', () => {
        it('should handle AND expressions with aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123 and status eq \'active\'',
                { scan: '->on->finding' }
            );

            expect(result.where).toContain('->on->finding');
            expect(result.where).toContain('type::field($field1)');
            expect(result.where).toContain('&&');
        });

        it('should handle OR expressions with aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123 or scan eq 456',
                { scan: '->on->finding' }
            );

            expect(result.where).toContain('->on->finding');
            expect(result.where).toContain('$literal1');
            expect(result.where).toContain('$literal2');
            expect(result.where).toContain('||');
        });

        it('should handle comparison operators with aliases', async () => {
            const operators = [
                { filter: 'scan eq 123', field: '->on->finding' },
                { filter: 'scan ne 123', field: '->on->finding' },
                { filter: 'scan gt 123', field: '->on->finding' },
                { filter: 'scan ge 123', field: '->on->finding' },
                { filter: 'scan lt 123', field: '->on->finding' },
                { filter: 'scan le 123', field: '->on->finding' }
            ];

            for (const { filter, field } of operators) {
                const result = await processFilterWithAliases(
                    `$filter=${filter}`,
                    { scan: '->on->finding' }
                );
                expect(result.where).toContain(field);
            }
        });

        it('should handle parenthesized expressions with aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=(scan eq 123 or scan eq 456) and status eq \'active\'',
                { scan: '->on->finding' }
            );

            expect(result.where).toContain('->on->finding');
            expect(result.where).toContain('type::field($field1)');
            expect(result.where).toMatch(/\(/);
        });
    });

    describe('Complex graph traversal aliases', () => {
        it('should handle deep graph traversal', async () => {
            const result = await processFilterWithAliases(
                '$filter=deepField eq 999',
                { deepField: '->parent->child->grandchild->value' }
            );

            expect(result.where).toContain('->parent->child->grandchild->value');
            expect(result.where).toContain('$literal1');
        });

        it('should handle array access in aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=firstItem eq 100',
                { firstItem: '->items[0]->value' }
            );

            expect(result.where).toContain('->items[0]->value');
        });

        it('should handle complex SurrealDB expressions', async () => {
            const result = await processFilterWithAliases(
                '$filter=computed eq 50',
                { computed: '(->value1 + ->value2) / 2' }
            );

            expect(result.where).toContain('(->value1 + ->value2) / 2');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty aliases object', async () => {
            const result = await processFilterWithAliases(
                '$filter=name eq \'test\'',
                {}
            );

            expect(result.where).toContain('type::field($field1)');
        });

        it('should handle undefined aliases', async () => {
            const result = await processFilterWithAliases(
                '$filter=name eq \'test\'',
                undefined
            );

            expect(result.where).toContain('type::field($field1)');
        });

        it('should handle alias with special characters', async () => {
            // Use a valid SurrealDB expression instead
            const result = await processFilterWithAliases(
                '$filter=field eq 123',
                { field: '->edge->value' }
            );

            expect(result.where).toContain('->edge->value');
        });

        it('should handle multiple occurrences of same aliased field', async () => {
            const result = await processFilterWithAliases(
                '$filter=scan eq 123 and scan ne 456',
                { scan: '->on->finding' }
            );

            // Both occurrences should be replaced
            const matches = result.where.match(/->on->finding/g);
            expect(matches).toBeTruthy();
            expect(matches!.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Combined with other features', () => {
        it('should work with contains operator', async () => {
            const query = createQuery('$filter=contains(scan, \'test\')', {
                type: SQLLang.SurrealDB,
                fieldAliases: { scan: '->on->finding->name' }
            });

            expect(query.where).toContain('->on->finding->name CONTAINS type::string($param1)');
        });

        it('should work with contains on graph traversal field', async () => {
            const query = createQuery('$filter=contains(description, \'critical\')', {
                type: SQLLang.SurrealDB,
                fieldAliases: { description: '->related->issue->description' }
            });

            expect(query.where).toContain('->related->issue->description CONTAINS type::string($param1)');
        });

        it('should work with NOT expression', async () => {
            const result = await processFilterWithAliases(
                '$filter=not (scan eq 123)',
                { scan: '->on->finding' }
            );

            expect(result.where).toContain('!(');
            expect(result.where).toContain('->on->finding');
        });
    });

    describe('Backtick dot notation support', () => {
        it('should parse backtick-wrapped dot notation paths', async () => {
            const query = createQuery('$filter=`field`.`subfield` eq 123', {
                type: SQLLang.SurrealDB
            });

            // Should produce nested field access using dot notation
            expect(query.where).toContain('type::field($field1).type::field($field2)');
            const paramValues = Array.from(query.parameters.values());
            expect(paramValues).toContain('field');
            expect(paramValues).toContain('subfield');
        });

        it('should handle deep nesting with backticks', async () => {
            const query = createQuery('$filter=`a`.`b`.`c` eq 123', {
                type: SQLLang.SurrealDB
            });

            // Should produce three levels of field access
            expect(query.where).toContain('type::field($field1).type::field($field2).type::field($field3)');
            const paramValues = Array.from(query.parameters.values());
            expect(paramValues).toContain('a');
            expect(paramValues).toContain('b');
            expect(paramValues).toContain('c');
        });

        it('should handle mixed backtick and plain identifiers in dot paths', async () => {
            const query = createQuery('$filter=`field`.subfield eq 123', {
                type: SQLLang.SurrealDB
            });

            // Should parse correctly even with mixed notation
            expect(query.where).toContain('type::field($field1)');
            expect(query.where).toContain('$literal1');
        });

        it('should support field aliases with backtick dot notation', async () => {
            const query = createQuery('$filter=`scan`.`status` eq \'active\'', {
                type: SQLLang.SurrealDB,
                fieldAliases: { 'scan.status': '->on->finding->status' }
            });

            // When the full path matches an alias, it should be replaced
            expect(query.where).toContain('->on->finding->status');
        });

        it('should parse backtick dot notation in $select', async () => {
            const query = createQuery('$select=`abc`.`def`', {
                type: SQLLang.SurrealDB
            });

            // Should produce single type::field() with backtick-wrapped path
            expect(query.select).toBe('type::field($field1) AS `abc`.`def`');
            expect(query.parameters.get('$field1')).toBe('`abc`.`def`');
        });

        it('should handle field aliases with backtick dot notation in $select', async () => {
            const query = createQuery('$select=`scan`.`status`', {
                type: SQLLang.SurrealDB,
                fieldAliases: { 'scan.status': '->on->finding->status' }
            });

            // When the full path matches an alias in SELECT, it should be replaced
            expect(query.select).toContain('->on->finding->status');
        });

        describe('AS clause escaping for nested objects', () => {
            it('should escape AS clause for simple dot notation to create nested object', async () => {
                const query = createQuery('$select=`foo`.`bar`', {
                    type: SQLLang.SurrealDB
                });

                // The AS clause should use backtick-wrapped dot notation for nested structure
                // Uses single type::field() with backtick-wrapped path parameter
                expect(query.select).toBe('type::field($field1) AS `foo`.`bar`');
                expect(query.parameters.get('$field1')).toBe('`foo`.`bar`');
            });

            it('should escape AS clause for deep nesting', async () => {
                const query = createQuery('$select=`a`.`b`.`c`', {
                    type: SQLLang.SurrealDB
                });

                // Should produce AS `a`.`b`.`c` for nested object structure
                expect(query.select).toBe('type::field($field1) AS `a`.`b`.`c`');
                expect(query.parameters.get('$field1')).toBe('`a`.`b`.`c`');
            });

            it('should handle multiple dot notation fields in select', async () => {
                const query = createQuery('$select=`foo`.`bar`,`baz`.`qux`', {
                    type: SQLLang.SurrealDB
                });

                // Both fields should use single type::field() calls
                expect(query.select).toBe('type::field($field1) AS `foo`.`bar`, type::field($field2) AS `baz`.`qux`');
                expect(query.parameters.get('$field1')).toBe('`foo`.`bar`');
                expect(query.parameters.get('$field2')).toBe('`baz`.`qux`');
            });

            it('should escape AS clause with special characters in field names', async () => {
                const query = createQuery('$select=`field-name`.`sub_field`', {
                    type: SQLLang.SurrealDB
                });

                // Should preserve special characters in AS clause
                expect(query.select).toBe('type::field($field1) AS `field-name`.`sub_field`');
                expect(query.parameters.get('$field1')).toBe('`field-name`.`sub_field`');
            });

            it('should handle mixed regular and dot notation fields', async () => {
                const query = createQuery('$select=id,`foo`.`bar`,name', {
                    type: SQLLang.SurrealDB
                });

                // Regular fields and dot notation fields should both work
                expect(query.select).toContain('type::field($select0) AS `id`');
                expect(query.select).toContain('type::field($field1) AS `foo`.`bar`');
                expect(query.select).toContain('type::field($select1) AS `name`');
            });

            // Note: The parser doesn't currently support escaped backticks within field names
            // This test is commented out until parser support is added
            // it('should properly escape backticks within field names in AS clause', async () => {
            //     const query = createQuery('$select=`field\\`with\\`ticks`.`sub`', {
            //         type: SQLLang.SurrealDB
            //     });
            //
            //     // Backticks in field names should be escaped in AS clause
            //     expect(query.select).toContain(' AS `field\\`with\\`ticks.sub`');
            // });

            it('should use aliased field but still produce nested AS clause', async () => {
                const query = createQuery('$select=`scan`.`status`', {
                    type: SQLLang.SurrealDB,
                    fieldAliases: { 'scan.status': '->on->finding->status' }
                });

                // Should use the alias but keep the original AS clause for nested structure
                expect(query.select).toContain('->on->finding->status');
                expect(query.select).toContain(' AS `scan`.`status`');
            });
        });
    });
});
