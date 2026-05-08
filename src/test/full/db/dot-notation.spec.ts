import { beforeAll, describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { renderQuery } from '../../../parser/query-renderer';

declare global { var db: any; }

const TABLE = 'dot_notation_test';
const opts = { type: SQLLang.SurrealDB };

/**
 * Execute an OData query string against the test table and return rows + metadata.
 * Parameters are stripped of the leading "$" to satisfy SurrealDB's query() API.
 */
const execQuery = async (odata: string) => {
    const q = createQuery(odata, opts);
    const r = renderQuery(q, TABLE);
    const params: Record<string, any> = {};
    for (const [k, v] of Object.entries(r.parameters)) {
        params[k.replace(/^\$/, '')] = v;
    }
    const result = await globalThis.db.query(r.entriesQuery.toString(), params);
    return { rows: result[0] as any[], sql: r.entriesQuery.toString(), query: q };
};

describe('Dot Notation (plain, no backticks)', () => {
    beforeAll(async () => {
        if (!globalThis.db) {
            console.warn('Skipping dot notation DB tests - globalThis.db not set');
            return;
        }

        await globalThis.db.query(`
            CREATE ${TABLE}:1 SET
                lemon  = { lime: 1 },
                lime   = { bar: 10, crime: 'a', toast: { pie: 5 } },
                toast  = { foo: { bar: 'hello' } };
            CREATE ${TABLE}:2 SET
                lemon  = { lime: 2 },
                lime   = { bar: 20, crime: 'b', toast: { pie: 15 } },
                toast  = { foo: { bar: 'world' } };
            CREATE ${TABLE}:3 SET
                lemon  = { lime: 3 },
                lime   = { bar: 5, crime: 'c', toast: { pie: 10 } },
                toast  = { foo: { bar: 'test' } };
        `);
    });

    // ─────────────────────────────────────────────
    // SQL structure assertions (no DB required)
    // ─────────────────────────────────────────────
    describe('generated SQL structure', () => {
        it('$filter: simple nested field produces type::field with dotted param', () => {
            const q = createQuery('$filter=lemon.lime eq 1', opts);
            expect(q.where).toContain('type::field($field1)');
            const val = q.parameters.get('$field1');
            expect(val).toBe('lemon.lime');
        });

        it('$filter: two nested fields compared', () => {
            const q = createQuery('$filter=lime.bar gt lime.toast.pie', opts);
            expect(q.where).toContain('type::field($field1)');
            expect(q.where).toContain('type::field($field2)');
            expect(q.parameters.get('$field1')).toBe('lime.bar');
            expect(q.parameters.get('$field2')).toBe('lime.toast.pie');
        });

        it('$filter: AND with nested fields', () => {
            const q = createQuery('$filter=lemon.lime eq 1 AND lime.bar gt lime.toast.pie', opts);
            expect(q.where).toMatch(/\(.*&&.*\)/);
        });

        it('$select: namespace.* passes through as-is', () => {
            const q = createQuery('$select=lime.*', opts);
            expect(q.select).toBe('lime.*');
        });

        it('$select: plain dotted field uses type::field with nested AS clause', () => {
            const q = createQuery('$select=toast.foo.bar', opts);
            expect(q.select).toBe('type::field($field1) AS `toast`.`foo`.`bar`');
            expect(q.parameters.get('$field1')).toBe('`toast`.`foo`.`bar`');
        });

        it('$select: combined namespace.* and dotted field', () => {
            const q = createQuery('$select=lime.*,toast.foo.bar', opts);
            expect(q.select).toContain('lime.*');
            expect(q.select).toContain('type::field($field1) AS `toast`.`foo`.`bar`');
        });

        it('$orderby: dotted field uses per-segment backtick quoting', () => {
            const q = createQuery('$orderby=lime.crime', opts);
            expect(q.orderby).toBe('`lime`.`crime` ASC');
        });

        it('$orderby: deep dotted field uses per-segment backtick quoting', () => {
            const q = createQuery('$orderby=lime.toast.pie', opts);
            expect(q.orderby).toBe('`lime`.`toast`.`pie` ASC');
        });

        it('$groupby: dotted field uses per-segment backtick quoting', () => {
            const q = createQuery('$groupby=lemon.lime', opts);
            expect(q.groupby).toBe('`lemon`.`lime`');
        });
    });

    // ─────────────────────────────────────────────
    // Full DB execution assertions
    // ─────────────────────────────────────────────
    describe('$filter execution', () => {
        it('simple nested field equality', async () => {
            if (!globalThis.db) return;
            const { rows, sql } = await execQuery('$filter=lemon.lime eq 1');
            expect(sql).toContain('type::field($field1)');
            expect(rows).toHaveLength(1);
            expect(rows[0].lemon.lime).toBe(1);
        });

        it('nested field greater-than', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$filter=lime.bar gt 8');
            expect(rows).toHaveLength(2);
            for (const r of rows) expect(r.lime.bar).toBeGreaterThan(8);
        });

        it('comparing two nested fields across different depths', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$filter=lime.bar gt lime.toast.pie');
            for (const r of rows) expect(r.lime.bar).toBeGreaterThan(r.lime.toast.pie);
        });

        it('AND: combining two nested field filters', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$filter=lemon.lime eq 1 AND lime.bar gt lime.toast.pie');
            expect(rows).toHaveLength(1);
            expect(rows[0].lemon.lime).toBe(1);
        });

        it('three-level deep field access', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$filter=lime.toast.pie gt 7');
            expect(rows.length).toBeGreaterThan(0);
            for (const r of rows) expect(r.lime.toast.pie).toBeGreaterThan(7);
        });
    });

    describe('$select execution', () => {
        it('namespace.* selects all sub-object fields', async () => {
            if (!globalThis.db) return;
            const { rows, sql } = await execQuery('$select=lime.*');
            expect(sql).toContain('lime.*');
            expect(rows).toHaveLength(3);
            for (const r of rows) {
                expect(r.lime).toBeDefined();
                expect(r.lime.bar).toBeDefined();
                expect(r.lime.crime).toBeDefined();
            }
        });

        it('dotted field produces nested key in result', async () => {
            if (!globalThis.db) return;
            const { rows, sql } = await execQuery('$select=toast.foo.bar');
            expect(sql).toContain('AS `toast`.`foo`.`bar`');
            expect(rows).toHaveLength(3);
            for (const r of rows) {
                expect(r.toast?.foo?.bar).toBeDefined();
            }
        });

        it('combined namespace.* and dotted field', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$select=lime.*,toast.foo.bar');
            expect(rows).toHaveLength(3);
            for (const r of rows) {
                expect(r.lime).toBeDefined();
                expect(r.toast?.foo?.bar).toBeDefined();
            }
        });

        it('two-level dotted field', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$select=lemon.lime');
            expect(rows).toHaveLength(3);
            for (const r of rows) {
                expect(r.lemon?.lime).toBeDefined();
            }
        });
    });

    describe('$orderby execution', () => {
        it('orders ascending by nested field', async () => {
            if (!globalThis.db) return;
            const { rows, sql } = await execQuery('$orderby=lime.crime');
            expect(sql).toContain('`lime`.`crime`');
            expect(rows).toHaveLength(3);
            expect(rows[0].lime.crime).toBe('a');
            expect(rows[1].lime.crime).toBe('b');
            expect(rows[2].lime.crime).toBe('c');
        });

        it('orders descending by nested field', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$orderby=lime.crime desc');
            expect(rows).toHaveLength(3);
            expect(rows[0].lime.crime).toBe('c');
            expect(rows[2].lime.crime).toBe('a');
        });

        it('orders by numeric nested field', async () => {
            if (!globalThis.db) return;
            const { rows } = await execQuery('$orderby=lemon.lime asc');
            expect(rows).toHaveLength(3);
            expect(rows[0].lemon.lime).toBe(1);
            expect(rows[1].lemon.lime).toBe(2);
            expect(rows[2].lemon.lime).toBe(3);
        });
    });

    describe('$groupby execution', () => {
        it('groups by nested scalar field', async () => {
            if (!globalThis.db) return;
            // SurrealDB requires explicit fields in SELECT when using GROUP BY (no SELECT *)
            const { rows, sql } = await execQuery('$select=lemon.lime&$groupby=lemon.lime');
            expect(sql).toContain('GROUP BY `lemon`.`lime`');
            expect(rows.length).toBe(3);
            for (const r of rows) expect(r.lemon?.lime).toBeDefined();
        });
    });

    describe('combined query (all params)', () => {
        it('filter + select + orderby with dot notation', async () => {
            if (!globalThis.db) return;
            const { rows, sql } = await execQuery(
                '$filter=lime.bar gt 8&$select=lemon.lime,lime.*&$orderby=lemon.lime asc'
            );
            expect(sql).toContain('type::field($field1)');
            expect(sql).toContain('lime.*');
            expect(sql).toContain('`lemon`.`lime`');
            expect(rows.length).toBeGreaterThan(0);
            for (const r of rows) expect(r.lime.bar).toBeGreaterThan(8);
        });
    });
});
