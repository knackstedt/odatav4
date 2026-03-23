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
});
