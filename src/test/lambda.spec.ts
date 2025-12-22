import { beforeAll, describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

declare global {
    var db: any;
}

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
};

describe('Lambda Operators (any/all)', () => {
    const parseFilter = (f: string) => {
        const result = parse(`$filter=${f}`);
        const params = Object.fromEntries(
            Array.from(result.parameters.entries()).map(([k, v]) => [k.replace(/^\$/, ''), v])
        );
        return { where: result.where, params };
    };

    beforeAll(async () => {
        if (!globalThis.db) {
            console.warn("Skipping lambda DB tests because globalThis.db is not set.");
            return;
        }

        try {
            // Setup test data. We await the query execution.
            // Using .query() without .collect() works for execution, resolving to undefined.
            await globalThis.db.query(`
                CREATE lambda_test:1 SET
                    items = [{val: 1}, {val: 2}, {val: 3}],
                    numbers = [1, 6],
                    tags = ['urgent', 'normal'];
                CREATE lambda_test:2 SET
                    items = [{val: 10}, {val: 20}],
                    numbers = [10, 20],
                    tags = ['low'];
                CREATE lambda_test:3 SET
                    items = [],
                    numbers = [],
                    tags = [];
            `);
        } catch (e) {
            console.error("Failed to setup lambda test data", e);
        }
    });

    describe('any', () => {
        it('should handle simple any', async () => {
            const { where, params } = parseFilter("items/any(i:i/val gt 5)");
            const sql = `SELECT * FROM lambda_test WHERE ${where}`;

            // SurrealDB v2 alpha: query() returns a PendingQuery. Use collect() to get results.
            // collect() returns Promise<[Result1, Result2, ...]>
            // Since we run 1 query, we get [Result]
            // The Result content depends on client. middleware.spec.ts implies array of rows.
            const result = await globalThis.db.query(sql, params).collect();
            const rows = result[0];

            expect(rows).toBeDefined();
            expect(rows.length).toBe(1);
            expect(rows[0].id.toString()).toBe('lambda_test:2');
        });

        it('should handle any with implicit variable', async () => {
            const { where, params } = parseFilter("tags/any(t:t eq 'urgent')");
            const sql = `SELECT * FROM lambda_test WHERE ${where}`;

            const result = await globalThis.db.query(sql, params).collect();
            const rows = result[0];

            expect(rows.length).toBe(1);
            expect(rows[0].id.toString()).toBe('lambda_test:1');
        });
    });

    describe('all', () => {
        it('should handle simple all', async () => {
            const { where, params } = parseFilter("items/all(i:i/val gt 5)");
            const sql = `SELECT * FROM lambda_test WHERE ${where}`;

            const result = await globalThis.db.query(sql, params).collect();
            const rows = result[0];

            expect(rows.length).toBe(2);
            const ids = rows.map((r: any) => r.id.toString()).sort();
            expect(ids).toEqual(['lambda_test:2', 'lambda_test:3']);
        });
    });
});
