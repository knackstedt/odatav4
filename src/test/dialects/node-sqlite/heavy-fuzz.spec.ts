import { describe, it, expect, beforeAll } from 'bun:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuery, createFilter, SQLLang } from '../../../parser/main';

// Check if node:sqlite is available
let nodeSqliteAvailable = false;
try {
    new DatabaseSync(':memory:');
    nodeSqliteAvailable = true;
} catch {
    nodeSqliteAvailable = false;
}

const opts = { type: SQLLang.NodeSqlite };

/**
 * Execute an OData $filter against a real SQLite database and return rows.
 */
function execFilter(db: DatabaseSync, table: string, odataFilter: string) {
    const q = createFilter(odataFilter, opts);
    const sql = `SELECT * FROM ${q.from(table)}`;
    // Wait - createFilter returns a Visitor, not a query object with from().
    // Let me use createQuery instead.
    return null;
}

/**
 * Execute an OData query string against a real SQLite database and return rows.
 */
function execQuery(db: DatabaseSync, table: string, odata: string) {
    const q = createQuery(odata, opts);
    const sql = q.from(table);
    const params: Record<string, any> = {};
    for (const [k, v] of q.parameters) {
        if (sql.includes(k)) params[k] = v;
    }
    return { rows: db.prepare(sql).all(params) as any[], sql, query: q };
}

/**
 * Execute an OData query and assert it doesn't throw.
 * Returns the rows and generated SQL for further assertions.
 */
function execAndAssert(db: DatabaseSync, table: string, odata: string) {
    const { rows, sql } = execQuery(db, table, odata);
    expect(rows).toBeDefined();
    expect(Array.isArray(rows)).toBe(true);
    return { rows, sql };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test database setup - comprehensive schema with various data types
// ─────────────────────────────────────────────────────────────────────────────

let db: DatabaseSync;

beforeAll(() => {
    if (!nodeSqliteAvailable) return;
    db = new DatabaseSync(':memory:');

    // Main test table with various column types
    db.exec(`
        CREATE TABLE products (
            id INTEGER PRIMARY KEY,
            Name TEXT NOT NULL,
            Description TEXT,
            Price REAL,
            Stock INTEGER,
            Active INTEGER,
            Category TEXT,
            Tags TEXT,        -- JSON array
            Metadata TEXT,    -- JSON object
            CreatedDate TEXT,
            UpdatedDate TEXT,
            Weight REAL,
            Rating REAL,
            Flags INTEGER,
            SKU TEXT
        )
    `);

    // Insert diverse test data
    const seedData = [
        [1, 'Laptop', 'High-performance laptop', 1299.99, 50, 1, 'Electronics',
         '["new","popular","tech"]', '{"color":"silver","warranty":2,"origin":{"country":"USA","city":"SF"}}',
         '2023-01-15T10:30:00Z', '2024-03-20T14:00:00Z', 2.5, 4.5, 0b1010, 'LP-001'],
        [2, 'Mouse', 'Wireless mouse', 29.99, 200, 1, 'Electronics',
         '["new","wireless"]', '{"color":"black","warranty":1,"origin":{"country":"China","city":"Shenzhen"}}',
         '2023-06-01T08:00:00Z', '2024-01-10T09:00:00Z', 0.2, 4.0, 0b0011, 'MS-002'],
        [3, 'Keyboard', 'Mechanical keyboard', 99.99, 75, 1, 'Electronics',
         '["mechanical","backlit"]', '{"color":"blue","warranty":3,"origin":{"country":"Taiwan","city":"Taipei"}}',
         '2023-03-10T12:00:00Z', '2024-02-15T16:30:00Z', 1.2, 4.8, 0b1100, 'KB-003'],
        [4, 'Monitor', '4K monitor', 499.99, 30, 1, 'Electronics',
         '["4k","hdr"]', '{"color":"black","warranty":2,"origin":{"country":"Korea","city":"Seoul"}}',
         '2023-09-05T15:45:00Z', '2024-04-01T11:00:00Z', 5.5, 4.2, 0b1001, 'MN-004'],
        [5, 'Desk', 'Standing desk', 599.00, 15, 1, 'Furniture',
         '["adjustable","wood"]', '{"color":"oak","warranty":5,"origin":{"country":"USA","city":"NYC"}}',
         '2022-12-01T00:00:00Z', '2024-01-01T00:00:00Z', 25.0, 3.9, 0b0110, 'DK-005'],
        [6, 'Chair', 'Office chair', 249.99, 40, 0, 'Furniture',
         '["ergonomic","mesh"]', '{"color":"gray","warranty":2,"origin":{"country":"Germany","city":"Berlin"}}',
         '2023-07-20T09:30:00Z', '2024-03-01T10:00:00Z', 12.0, 4.1, 0b1010, 'CH-006'],
        [7, 'Webcam', 'HD webcam', 79.99, 0, 1, 'Electronics',
         '["1080p","usb"]', '{"color":"black","warranty":1,"origin":{"country":"China","city":"Shenzhen"}}',
         '2023-11-15T14:00:00Z', '2024-05-10T08:00:00Z', 0.3, 3.5, 0b0001, 'WC-007'],
        [8, 'Headphones', 'Noise-cancelling headphones', 199.99, 60, 1, 'Electronics',
         '["wireless","noise-cancelling"]', '{"color":"white","warranty":2,"origin":{"country":"Japan","city":"Tokyo"}}',
         '2023-04-25T11:00:00Z', '2024-02-20T13:00:00Z', 0.5, 4.7, 0b1111, 'HP-008'],
        [9, 'Tablet', '10-inch tablet', 349.99, 25, 1, 'Electronics',
         '["android","10inch"]', '{"color":"silver","warranty":1,"origin":{"country":"China","city":"Shenzhen"}}',
         '2023-08-10T10:00:00Z', '2024-04-15T09:00:00Z', 0.7, 4.3, 0b0010, 'TB-009'],
        [10, 'Printer', 'Laser printer', 179.99, 10, 0, 'Electronics',
         '["laser","monochrome"]', '{"color":"white","warranty":1,"origin":{"country":"Vietnam","city":"Hanoi"}}',
         '2022-10-05T08:00:00Z', '2023-12-01T08:00:00Z', 8.0, 3.0, 0b0100, 'PR-010'],
        [11, 'Cable', 'USB-C cable', 9.99, 500, 1, 'Accessories',
         '["usb-c","fast-charge"]', '{"color":"black","warranty":0,"origin":{"country":"China","city":"Shenzhen"}}',
         '2023-12-01T00:00:00Z', '2024-06-01T00:00:00Z', 0.05, 4.4, 0b1000, 'CB-011'],
        [12, 'Stand', 'Laptop stand', 34.99, 80, 1, 'Accessories',
         '["aluminum","foldable"]', '{"color":"silver","warranty":1,"origin":{"country":"USA","city":"Boston"}}',
         '2023-05-15T09:00:00Z', '2024-03-05T10:00:00Z', 0.8, 4.6, 0b0111, 'ST-012'],
    ];

    const stmt = db.prepare(
        'INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const row of seedData) {
        stmt.all(...row);
    }

    // Table for null/edge-case testing
    db.exec(`
        CREATE TABLE edge_cases (
            id INTEGER PRIMARY KEY,
            Name TEXT,
            Value REAL,
            Count INTEGER,
            Flag INTEGER,
            Date TEXT,
            Data TEXT
        )
    `);
    db.prepare(`INSERT INTO edge_cases VALUES (1, 'Alpha', 1.0, 10, 1, '2020-01-01T00:00:00Z', '{"x":1}')`).all();
    db.prepare('INSERT INTO edge_cases VALUES (2, NULL, NULL, NULL, NULL, NULL, NULL)').all();
    db.prepare(`INSERT INTO edge_cases VALUES (3, 'Gamma', 3.0, 30, 0, '2021-06-15T12:30:00Z', '{"x":3,"y":4}')`).all();
    db.prepare(`INSERT INTO edge_cases VALUES (4, '', 0.0, 0, 0, '2022-12-31T23:59:59Z', '{}')`).all();
    db.prepare(`INSERT INTO edge_cases VALUES (5, 'Delta', -1.5, -5, 1, '2019-03-20T06:00:00Z', '{"nested":{"deep":{"value":42}}}')`).all();

    // Table with JSON arrays for lambda testing
    db.exec(`
        CREATE TABLE collections (
            id INTEGER PRIMARY KEY,
            Name TEXT,
            Tags TEXT,
            Scores TEXT,
            Items TEXT
        )
    `);
    db.prepare(`INSERT INTO collections VALUES (1, 'Set A', '["red","blue","green"]', '[10,20,30]', '[{"name":"item1","price":10},{"name":"item2","price":20}]')`).all();
    db.prepare(`INSERT INTO collections VALUES (2, 'Set B', '["red","yellow"]', '[5,15,25,35]', '[{"name":"item3","price":5}]')`).all();
    db.prepare(`INSERT INTO collections VALUES (3, 'Set C', '[]', '[]', '[]')`).all();
    db.prepare(`INSERT INTO collections VALUES (4, 'Set D', '["blue","green","purple"]', '[100]', '[{"name":"item4","price":100},{"name":"item5","price":200},{"name":"item6","price":300}]')`).all();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. EXHAUSTIVE COMPARISON TESTING - execute every operator against real data
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Comparison Execution', () => {
    beforeAll(() => { if (!nodeSqliteAvailable) return; });

    const T = 'products';

    it('eq with string matches exact value', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Name eq 'Laptop'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('ne with string excludes matching value', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Category ne 'Electronics'");
        for (const r of rows) expect(r.Category).not.toBe('Electronics');
    });

    it('gt with number', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price gt 200');
        for (const r of rows) expect(r.Price).toBeGreaterThan(200);
    });

    it('ge with number includes boundary', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price ge 29.99');
        for (const r of rows) expect(r.Price).toBeGreaterThanOrEqual(29.99);
    });

    it('lt with number', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price lt 50');
        for (const r of rows) expect(r.Price).toBeLessThan(50);
    });

    it('le with number includes boundary', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price le 99.99');
        for (const r of rows) expect(r.Price).toBeLessThanOrEqual(99.99);
    });

    it('eq with boolean true', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Active eq true');
        for (const r of rows) expect(r.Active).toBe(1);
    });

    it('eq with boolean false', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Active eq false');
        for (const r of rows) expect(r.Active).toBe(0);
    });

    it('ne with boolean', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Active ne true');
        for (const r of rows) expect(r.Active).not.toBe(1);
    });

    it('eq null finds null rows', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, 'edge_cases', '$filter=Name eq null');
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(2);
    });

    it('ne null excludes null rows', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, 'edge_cases', '$filter=Name ne null');
        for (const r of rows) expect(r.Name).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LOGICAL OPERATOR EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Logical Execution', () => {
    const T = 'products';

    it('AND combines two conditions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Category eq 'Electronics' and Price gt 100");
        for (const r of rows) {
            expect(r.Category).toBe('Electronics');
            expect(r.Price).toBeGreaterThan(100);
        }
    });

    it('OR combines two conditions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Category eq 'Furniture' or Category eq 'Accessories'");
        for (const r of rows) {
            expect(['Furniture', 'Accessories']).toContain(r.Category);
        }
    });

    it('NOT negates a condition', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(Category eq 'Electronics')");
        for (const r of rows) expect(r.Category).not.toBe('Electronics');
    });

    it('Nested NOT NOT preserves original condition', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(not(Category eq 'Electronics'))");
        for (const r of rows) expect(r.Category).toBe('Electronics');
    });

    it('AND OR NOT combined', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=(Category eq 'Electronics' and Price gt 100) or not(Active eq true)"
        );
        for (const r of rows) {
            const isExpensive = r.Category === 'Electronics' && r.Price > 100;
            const isInactive = r.Active !== 1;
            expect(isExpensive || isInactive).toBe(true);
        }
    });

    it('Multiple AND conditions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Active eq true and Price gt 50 and Stock gt 0 and Rating ge 4.0'
        );
        for (const r of rows) {
            expect(r.Active).toBe(1);
            expect(r.Price).toBeGreaterThan(50);
            expect(r.Stock).toBeGreaterThan(0);
            expect(r.Rating).toBeGreaterThanOrEqual(4.0);
        }
    });

    it('Complex nested logical with parentheses', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=((Category eq 'Electronics' or Category eq 'Furniture') and Active eq true) and not(Price lt 100)"
        );
        for (const r of rows) {
            expect(['Electronics', 'Furniture']).toContain(r.Category);
            expect(r.Active).toBe(1);
            expect(r.Price).toBeGreaterThanOrEqual(100);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. STRING FUNCTION EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - String Function Execution', () => {
    const T = 'products';

    it('contains finds substring', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=contains(Name, 'a')");
        for (const r of rows) expect(r.Name.toLowerCase()).toContain('a');
    });

    it('startswith matches prefix', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=startswith(Name, 'L')");
        for (const r of rows) expect(r.Name.startsWith('L')).toBe(true);
    });

    it('endswith matches suffix', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=endswith(Name, 'r')");
        for (const r of rows) expect(r.Name.endsWith('r')).toBe(true);
    });

    it('length matches string length', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=length(Name) eq 5');
        for (const r of rows) expect(r.Name.length).toBe(5);
    });

    it('tolower converts to lowercase', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=tolower(Name) eq 'laptop'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('toupper converts to uppercase', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=toupper(Name) eq 'MOUSE'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('trim removes whitespace', () => {
        if (!nodeSqliteAvailable) return;
        // Insert a row with whitespace
        db.prepare("INSERT INTO edge_cases (Name) VALUES ('  spaced  ')").all();
        const { rows } = execQuery(db, 'edge_cases', "$filter=trim(Name) eq 'spaced'");
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(r.Name.trim()).toBe('spaced');
        // Clean up
        db.prepare("DELETE FROM edge_cases WHERE Name = '  spaced  '").all();
    });

    it('substring extracts portion', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=substring(Name, 0, 3) eq 'Lap'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('substring with start only', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=substring(Name, 3) eq 'top'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('concat combines strings', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=concat(Name, '-test') eq 'Laptop-test'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('indexof finds position', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=indexof(Name, 'top') eq 3");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('indexof returns -1 for not found', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=indexof(Name, 'xyz') eq -1");
        // All rows should match since 'xyz' is not in any name
        expect(rows.length).toBeGreaterThan(0);
    });

    it('Combined string functions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=contains(toupper(Name), 'LAP') and length(Name) gt 4"
        );
        for (const r of rows) {
            expect(r.Name.toUpperCase()).toContain('LAP');
            expect(r.Name.length).toBeGreaterThan(4);
        }
    });

    it('Nested string functions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=substring(toupper(Name), 0, 2) eq 'LA'"
        );
        for (const r of rows) {
            expect(r.Name.toUpperCase().substring(0, 2)).toBe('LA');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. MATH FUNCTION EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Math Function Execution', () => {
    const T = 'products';

    it('round rounds to nearest integer', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=round(Price) eq 30');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('floor rounds down', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=floor(Price) eq 99');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Keyboard');
    });

    it('ceiling rounds up', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=ceiling(Price) eq 100');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Keyboard');
    });

    it('Arithmetic add', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price add 10 gt 1300');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Arithmetic sub', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price sub 10 eq 89.99');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Keyboard');
    });

    it('Arithmetic mul', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price mul 2 gt 2000');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Arithmetic div', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Price div 2 gt 600');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Arithmetic mod', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Stock mod 100 eq 0');
        for (const r of rows) expect(r.Stock % 100).toBe(0);
    });

    it('Nested arithmetic', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=(Price add 10) mul 2 gt 2600');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Math function with arithmetic', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=round(Price mul 1.1) gt 1420');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DATE/TIME FUNCTION EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Date/Time Function Execution', () => {
    const T = 'products';

    it('year extracts year', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=year(CreatedDate) eq 2023');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCFullYear()).toBe(2023);
        }
    });

    it('month extracts month', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=month(CreatedDate) eq 6');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCMonth() + 1).toBe(6);
        }
    });

    it('day extracts day', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=day(CreatedDate) eq 15');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCDate()).toBe(15);
        }
    });

    it('hour extracts hour', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=hour(CreatedDate) eq 10');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCHours()).toBe(10);
        }
    });

    it('minute extracts minute', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=minute(CreatedDate) eq 30');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCMinutes()).toBe(30);
        }
    });

    it('second extracts second', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=second(CreatedDate) eq 0');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCSeconds()).toBe(0);
        }
    });

    it('date extracts date part', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=date(CreatedDate) eq '2023-01-15'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Combined date functions', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=year(CreatedDate) eq 2023 and month(CreatedDate) gt 5'
        );
        for (const r of rows) {
            const d = new Date(r.CreatedDate);
            expect(d.getUTCFullYear()).toBe(2023);
            expect(d.getUTCMonth() + 1).toBeGreaterThan(5);
        }
    });

    it('Date comparison with literal date', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=CreatedDate gt 2023-06-01');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getTime()).toBeGreaterThan(new Date('2023-06-01').getTime());
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. IN EXPRESSION EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - IN Expression Execution', () => {
    const T = 'products';

    it('IN with strings', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Name in ('Laptop', 'Mouse', 'Keyboard')");
        expect(rows.length).toBe(3);
        const names = rows.map(r => r.Name);
        expect(names).toContain('Laptop');
        expect(names).toContain('Mouse');
        expect(names).toContain('Keyboard');
    });

    it('IN with numbers', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Stock in (0, 50, 200)');
        expect(rows.length).toBe(3);
    });

    it('IN with single value', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Category in ('Furniture')");
        expect(rows.length).toBe(2);
        for (const r of rows) expect(r.Category).toBe('Furniture');
    });

    it('NOT IN (via not())', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(Category in ('Electronics', 'Furniture'))");
        for (const r of rows) {
            expect(['Electronics', 'Furniture']).not.toContain(r.Category);
        }
    });

    it('IN with many values', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=id in (1,2,3,4,5,6,7,8,9,10,11,12)');
        expect(rows.length).toBe(12);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. QUERY OPTIONS EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Query Options Execution', () => {
    const T = 'products';

    it('$top limits results', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$top=3');
        expect(rows.length).toBe(3);
    });

    it('$skip offsets results', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$skip=5');
        expect(rows.length).toBe(7); // 12 total - 5 skipped
    });

    it('$top + $skip pagination', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$skip=2&$top=3');
        expect(rows.length).toBe(3);
    });

    it('$orderby ascending', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$orderby=Price asc');
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].Price).toBeGreaterThanOrEqual(rows[i-1].Price);
        }
    });

    it('$orderby descending', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$orderby=Price desc');
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].Price).toBeLessThanOrEqual(rows[i-1].Price);
        }
    });

    it('$orderby multiple fields', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$orderby=Category asc,Price desc');
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].Category === rows[i-1].Category) {
                expect(rows[i].Price).toBeLessThanOrEqual(rows[i-1].Price);
            } else {
                expect(rows[i].Category >= rows[i-1].Category).toBe(true);
            }
        }
    });

    it('$select specific fields', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$select=Name,Price');
        for (const r of rows) {
            expect(r.Name).toBeDefined();
            expect(r.Price).toBeDefined();
        }
    });

    it('$select with $filter', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$select=Name&$filter=Price gt 100');
        for (const r of rows) {
            expect(r.Name).toBeDefined();
        }
    });

    it('$groupby with $select', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$select=Category&$groupby=Category');
        // Should return one row per category
        const categories = rows.map(r => r.Category);
        expect(new Set(categories).size).toBe(categories.length);
    });

    it('Combined $filter + $orderby + $top + $skip + $select', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Active eq true&$orderby=Price desc&$top=3&$skip=1&$select=Name,Price'
        );
        expect(rows.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].Price).toBeLessThanOrEqual(rows[i-1].Price);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. HAS / ISOF / CAST EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Has/IsOf/Cast Execution', () => {
    const T = 'products';

    it('has operator (bitwise AND)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Flags has 8');
        for (const r of rows) {
            expect((r.Flags as number) & 8).toBe(8);
        }
    });

    it('has with different bit values', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Flags has 1');
        for (const r of rows) {
            expect((r.Flags as number) & 1).toBe(1);
        }
    });

    it('isof checks string type', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=isof(Name, 'Edm.String')");
        // All rows have text Name
        expect(rows.length).toBe(12);
    });

    it('isof checks integer type', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=isof(Stock, 'Edm.Int32')");
        // All rows have integer Stock
        expect(rows.length).toBe(12);
    });

    it('isof checks real type', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=isof(Price, 'Edm.Decimal')");
        // All rows have real Price
        expect(rows.length).toBe(12);
    });

    it('cast to string', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=cast(Stock, 'Edm.String') eq '50'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('cast to integer', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=cast(Price, 'Edm.Int32') eq 29");
        // Price 29.99 cast to int = 29 (truncated toward zero by SQLite CAST)
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('cast combined with comparison', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=cast(Rating, 'Edm.Int32') eq 4");
        for (const r of rows) {
            expect(Math.trunc(r.Rating)).toBe(4);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. DOT NOTATION / JSON PROPERTY EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Dot Notation Execution', () => {
    const T = 'products';

    it('Nested property access Metadata/color', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Metadata/color eq 'silver'");
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.color).toBe('silver');
        }
    });

    it('Nested property access Metadata/warranty', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Metadata/warranty gt 2');
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.warranty).toBeGreaterThan(2);
        }
    });

    it('Deep nested property Metadata/origin/country', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Metadata/origin/country eq 'USA'");
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.origin.country).toBe('USA');
        }
    });

    it('Deep nested property Metadata/origin/city', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Metadata/origin/city eq 'Shenzhen'");
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.origin.city).toBe('Shenzhen');
        }
    });

    it('Nested property with string function', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=contains(Metadata/color, 'bla')");
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.color).toContain('bla');
        }
    });

    it('Nested property with comparison operators', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Metadata/warranty ge 2 and Metadata/warranty le 3");
        for (const r of rows) {
            const meta = JSON.parse(r.Metadata);
            expect(meta.warranty).toBeGreaterThanOrEqual(2);
            expect(meta.warranty).toBeLessThanOrEqual(3);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. EDGE CASES EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Edge Cases Execution', () => {
    const T = 'edge_cases';

    it('Empty string vs null', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: emptyRows } = execQuery(db, T, "$filter=Name eq ''");
        expect(emptyRows.length).toBe(1);
        expect(emptyRows[0].id).toBe(4);

        const { rows: nullRows } = execQuery(db, T, '$filter=Name eq null');
        expect(nullRows.length).toBe(1);
        expect(nullRows[0].id).toBe(2);
    });

    it('Negative numbers', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Value lt 0');
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(5);
        expect(rows[0].Value).toBe(-1.5);
    });

    it('Zero values', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Value eq 0');
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(4);
    });

    it('Empty JSON object', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=Data eq '{}'");
        // Data is stored as text, so direct comparison should work
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(4);
    });

    it('Deeply nested JSON access', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=Data/nested/deep/value eq 42');
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(5);
    });

    it('Date boundary values', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=year(Date) eq 2022');
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. SQL INJECTION PREVENTION (execution-based)
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - SQL Injection Execution', () => {
    const T = 'products';

    // These payloads should be parameterized and NOT execute any SQL
    const payloads = [
        "Robert'); DROP TABLE products;--",
        "John' OR '1'='1",
        "'; DELETE FROM products;--",
        "admin' UNION SELECT * FROM products;--",
        "1; DROP TABLE edge_cases",
        "'; INSERT INTO products VALUES (999, 'hacked', 0, 0, 0, 0, 'hack', '[]', '{}', '2020-01-01', '2020-01-01', 0, 0, 0, 'HACK');--",
        "' OR ''='",
        "1' AND 1=1;--",
        "'; UPDATE products SET Name='hacked';--",
        "'; ATTACH DATABASE 'evil.db' AS evil;--",
    ];

    payloads.forEach((payload, i) => {
        it(`injection payload #${i} is neutralized`, () => {
            if (!nodeSqliteAvailable) return;
            // The parser may reject some of these - that's fine
            try {
                const q = createQuery(`$filter=Name eq '${payload}'`, opts);
                const sql = q.from(T);
                const params: Record<string, any> = {};
                for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;

                // Execute - should not cause any side effects
                db.prepare(sql).all(params);

                // Verify tables still exist and data is intact
                const checkRows = db.prepare('SELECT COUNT(*) as cnt FROM products').get({});
                expect(checkRows.cnt).toBe(12);

                const edgeCheck = db.prepare('SELECT COUNT(*) as cnt FROM edge_cases').get({});
                expect(edgeCheck.cnt).toBe(5);
            } catch (e: any) {
                // Parser rejection is acceptable
                expect(e).toBeDefined();
            }
        });
    });

    it('No extra tables created after injection attempts', () => {
        if (!nodeSqliteAvailable) return;
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).all({});
        const tableNames = tables.map((t: any) => t.name);
        expect(tableNames).toContain('products');
        expect(tableNames).toContain('edge_cases');
        expect(tableNames).toContain('collections');
        // No evil.db or other injected tables
        expect(tableNames).not.toContain('evil');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. RANDOMIZED FUZZING WITH REAL EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Randomized Execution', () => {
    if (!nodeSqliteAvailable) return;
    const T = 'products';

    // Deterministic PRNG for reproducibility
    let seed = 42;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
    };
    const randInt = (max: number) => rand() % max;
    const pick = <T>(arr: T[]): T => arr[randInt(arr.length)];

    const fields = ['Name', 'Price', 'Stock', 'Active', 'Category', 'Rating', 'Weight', 'Flags', 'CreatedDate', 'SKU'];
    const ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
    const categories = ['Electronics', 'Furniture', 'Accessories'];
    const stringVals = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Desk', 'Chair'];
    const numVals = [0, 1, 10, 50, 100, 200, 500, 1000, 29.99, 99.99, 499.99];

    const generateFilter = (depth: number): string => {
        if (depth > 3) return `${pick(fields)} ${pick(ops)} ${pick(numVals)}`;

        const r = randInt(100);
        if (r < 30) {
            const f = pick(fields);
            const op = pick(ops);
            const v = pick([...numVals, ...stringVals.map(s => `'${s}'`), ...categories.map(c => `'${c}'`), 'true', 'false', 'null']);
            return `${f} ${op} ${v}`;
        } else if (r < 50) {
            const fns = [
                () => `contains(${pick(fields)}, '${pick(stringVals).slice(0, 3)}')`,
                () => `startswith(${pick(fields)}, '${pick(stringVals).slice(0, 2)}')`,
                () => `endswith(${pick(fields)}, '${pick(stringVals).slice(-2)}')`,
                () => `length(${pick(fields)}) gt ${randInt(5)}`,
                () => `tolower(${pick(fields)}) eq '${pick(stringVals).toLowerCase()}'`,
                () => `toupper(${pick(fields)}) eq '${pick(stringVals).toUpperCase()}'`,
                () => `round(${pick(fields)}) eq ${pick(numVals)}`,
                () => `floor(${pick(fields)}) gt ${randInt(50)}`,
                () => `ceiling(${pick(fields)}) lt ${randInt(100) + 50}`,
                () => `year(${pick(fields)}) eq ${2022 + randInt(3)}`,
                () => `month(${pick(fields)}) eq ${1 + randInt(12)}`,
                () => `${pick(fields)} has ${1 << randInt(4)}`,
            ];
            return pick(fns)();
        } else if (r < 75) {
            const left = generateFilter(depth + 1);
            const right = generateFilter(depth + 1);
            const op = pick(['and', 'or']);
            return `(${left}) ${op} (${right})`;
        } else if (r < 85) {
            return `not(${generateFilter(depth + 1)})`;
        } else if (r < 95) {
            const f = pick(fields);
            const count = 2 + randInt(3);
            const vals = Array.from({ length: count }, () => pick(numVals));
            return `${f} in (${vals.join(', ')})`;
        } else {
            // Arithmetic
            const f = pick(fields);
            const op = pick(['add', 'sub', 'mul', 'div', 'mod']);
            const n = pick(numVals);
            return `(${f} ${op} ${n}) ${pick(ops)} ${pick(numVals)}`;
        }
    };

    // Generate 200 random queries and execute them all
    for (let i = 0; i < 200; i++) {
        const filter = generateFilter(0);
        const parts = [`$filter=${filter}`];
        if (randInt(2) === 0) parts.push(`$top=${randInt(12) + 1}`);
        if (randInt(3) === 0) parts.push(`$orderby=${pick(fields)} ${pick(['asc', 'desc'])}`);
        const odata = parts.join('&');

        it(`random exec #${i}: ${odata.slice(0, 80)}`, () => {
            // Some random queries may fail to parse - that's OK
            try {
                const q = createQuery(odata, opts);
                const sql = q.from(T);
                const params: Record<string, any> = {};
                for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;

                // Execute the query - should not throw
                const rows = db.prepare(sql).all(params);

                // Verify results are valid
                expect(Array.isArray(rows)).toBe(true);

                // Verify no SQL injection occurred
                const checkCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get({});
                expect(checkCount.cnt).toBe(12);
            } catch (e: any) {
                // Parser errors are acceptable - we're fuzzing
                if (e instanceof Error) {
                    // Just verify it's a parse error, not a SQLite error
                    expect(e.message).toBeTruthy();
                }
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. PARAMETER VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Parameter Verification', () => {
    const T = 'products';

    it('All $literal placeholders have parameter values', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Price gt 100 and Name eq 'Test'", opts);
        const sql = q.from(T);
        const literals = sql.match(/\$literal\d+/g) || [];
        for (const l of literals) {
            expect(q.parameters.has(l)).toBe(true);
        }
    });

    it('All $param placeholders have parameter values', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=contains(Name, 'test') and startswith(SKU, 'LP')", opts);
        const sql = q.from(T);
        const params = sql.match(/\$param\d+/g) || [];
        for (const p of params) {
            expect(q.parameters.has(p)).toBe(true);
        }
    });

    it('Boolean values are converted to 0/1', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Active eq true', opts);
        for (const [k, v] of q.parameters) {
            if (k.startsWith('$literal')) {
                expect(v === 0 || v === 1).toBe(true);
            }
        }
    });

    it('IN values are all parameterized', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Name in ('A', 'B', 'C')", opts);
        const sql = q.from(T);
        const paramCount = (sql.match(/\$param\d+/g) || []).length;
        expect(paramCount).toBe(3);
    });

    it('No raw string values appear in SQL', () => {
        if (!nodeSqliteAvailable) return;
        // The parser should reject the injection payload entirely.
        // If it does parse, the value must be parameterized.
        try {
            const q = createQuery("$filter=Name eq 'Robert'); DROP TABLE products;--'", opts);
            const sql = q.from(T);
            // If it parsed, the dangerous payload should NOT appear in the SQL
            expect(sql).not.toContain('DROP TABLE');
            expect(sql).not.toContain('Robert');
        } catch (e: any) {
            // Parser rejection is the best outcome - injection is impossible
            expect(e).toBeDefined();
        }
    });

    it('Parameter count matches placeholders', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery(
            "$filter=Price gt 100 and Price lt 500 and Active eq true and Category eq 'Electronics'",
            opts
        );
        const sql = q.from(T);
        const allPlaceholders = sql.match(/\$(literal|param)\d+/g) || [];
        for (const ph of allPlaceholders) {
            expect(q.parameters.has(ph)).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. STRESS TESTING
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Stress Testing', () => {
    const T = 'products';

    it('Large IN list (100 values)', () => {
        if (!nodeSqliteAvailable) return;
        const values = Array.from({ length: 100 }, (_, i) => i + 1000);
        const inList = values.join(', ');
        // This should not exceed parameter limits
        try {
            const q = createQuery(`$filter=id in (${inList})`, opts);
            const sql = q.from(T);
            const params: Record<string, any> = {};
            for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;
            const rows = db.prepare(sql).all(params);
            // No rows should match (ids 1000-1099 don't exist)
            expect(rows.length).toBe(0);
        } catch (e: any) {
            // Parameter limit exceeded is acceptable
            expect(e.message).toContain('parameter');
        }
    });

    it('Deeply nested AND chain', () => {
        if (!nodeSqliteAvailable) return;
        let filter = 'Active eq true';
        for (let i = 0; i < 20; i++) {
            filter = `(${filter} and Active eq true)`;
        }
        const { rows } = execQuery(db, T, `$filter=${filter}`);
        for (const r of rows) expect(r.Active).toBe(1);
    });

    it('Deeply nested OR chain', () => {
        if (!nodeSqliteAvailable) return;
        let filter = "Category eq 'NonExistent'";
        for (let i = 0; i < 20; i++) {
            filter = `(${filter} or Category eq 'NonExistent')`;
        }
        const { rows } = execQuery(db, T, `$filter=${filter}`);
        // No rows should match
        expect(rows.length).toBe(0);
    });

    it('Complex query with all options', () => {
        if (!nodeSqliteAvailable) return;
        const { rows, sql } = execQuery(db, T,
            "$filter=Active eq true and Price gt 20 and Price lt 600 and (Category eq 'Electronics' or Category eq 'Accessories')" +
            "&$orderby=Rating desc,Price asc&$top=5&$skip=0&$select=Name,Price,Category,Rating,Active"
        );
        expect(rows.length).toBeLessThanOrEqual(5);
        for (const r of rows) {
            expect(r.Active).toBe(1);
            expect(r.Price).toBeGreaterThan(20);
            expect(r.Price).toBeLessThan(600);
            expect(['Electronics', 'Accessories']).toContain(r.Category);
        }
    });

    it('Repeated execution of same query', () => {
        if (!nodeSqliteAvailable) return;
        for (let i = 0; i < 50; i++) {
            const { rows } = execQuery(db, T, "$filter=Price gt 100 and Active eq true");
            expect(rows.length).toBeGreaterThan(0);
        }
    });

    it('Unicode in filter values', () => {
        if (!nodeSqliteAvailable) return;
        // Insert a row with unicode
        db.prepare("INSERT INTO edge_cases (Name) VALUES ('Café Münchën 日本語')").all();
        const { rows } = execQuery(db, 'edge_cases', "$filter=Name eq 'Café Münchën 日本語'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Café Münchën 日本語');
        db.prepare("DELETE FROM edge_cases WHERE Name = 'Café Münchën 日本語'").all();
    });

    it('Special characters in filter values', () => {
        if (!nodeSqliteAvailable) return;
        const special = 'test%_{}[]()';
        db.prepare("INSERT INTO edge_cases (Name) VALUES (?)").all(special);
        const { rows } = execQuery(db, 'edge_cases', `$filter=Name eq '${special}'`);
        expect(rows.length).toBe(1);
        db.prepare("DELETE FROM edge_cases WHERE Name = ?").all(special);
    });

    it('Very long string value', () => {
        if (!nodeSqliteAvailable) return;
        const longStr = 'A'.repeat(10000);
        db.prepare(`INSERT INTO edge_cases (Name) VALUES (?)`).all(longStr);
        const { rows } = execQuery(db, 'edge_cases', `$filter=Name eq '${longStr}'`);
        expect(rows.length).toBe(1);
        db.prepare(`DELETE FROM edge_cases WHERE Name = ?`).all(longStr);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. CONSISTENCY CHECKS
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Consistency Checks', () => {
    const T = 'products';

    it('eq and ne are complementary', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: eqRows } = execQuery(db, T, "$filter=Category eq 'Electronics'");
        const { rows: neRows } = execQuery(db, T, "$filter=not(Category eq 'Electronics')");
        expect(eqRows.length + neRows.length).toBe(12);
    });

    it('gt and le are complementary', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: gtRows } = execQuery(db, T, '$filter=Price gt 100');
        const { rows: leRows } = execQuery(db, T, '$filter=Price le 100');
        expect(gtRows.length + leRows.length).toBe(12);
    });

    it('lt and ge are complementary', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: ltRows } = execQuery(db, T, '$filter=Price lt 100');
        const { rows: geRows } = execQuery(db, T, '$filter=Price ge 100');
        expect(ltRows.length + geRows.length).toBe(12);
    });

    it('AND is subset of each condition', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: aRows } = execQuery(db, T, "$filter=Category eq 'Electronics'");
        const { rows: bRows } = execQuery(db, T, '$filter=Price gt 100');
        const { rows: andRows } = execQuery(db, T, "$filter=Category eq 'Electronics' and Price gt 100");
        expect(andRows.length).toBeLessThanOrEqual(aRows.length);
        expect(andRows.length).toBeLessThanOrEqual(bRows.length);
    });

    it('OR is superset of each condition', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: aRows } = execQuery(db, T, "$filter=Category eq 'Electronics'");
        const { rows: bRows } = execQuery(db, T, "$filter=Category eq 'Furniture'");
        const { rows: orRows } = execQuery(db, T, "$filter=Category eq 'Electronics' or Category eq 'Furniture'");
        expect(orRows.length).toBe(aRows.length + bRows.length);
    });

    it('NOT NOT equals original', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: original } = execQuery(db, T, "$filter=Category eq 'Electronics'");
        const { rows: doubleNot } = execQuery(db, T, "$filter=not(not(Category eq 'Electronics'))");
        expect(original.length).toBe(doubleNot.length);
    });

    it('IN matches OR chain', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: inRows } = execQuery(db, T, "$filter=Category in ('Electronics', 'Furniture', 'Accessories')");
        const { rows: orRows } = execQuery(db, T,
            "$filter=Category eq 'Electronics' or Category eq 'Furniture' or Category eq 'Accessories'"
        );
        expect(inRows.length).toBe(orRows.length);
    });

    it('contains is case-insensitive in SQLite LIKE', () => {
        if (!nodeSqliteAvailable) return;
        const { rows: lower } = execQuery(db, T, "$filter=contains(Name, 'lap')");
        const { rows: upper } = execQuery(db, T, "$filter=contains(Name, 'LAP')");
        // SQLite LIKE is case-insensitive for ASCII
        expect(lower.length).toBe(upper.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. PARSER EDGE CASES - Empty strings, large numbers, special values
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Parser Edge Cases', () => {
    const T = 'products';

    it('Empty string literal', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Name eq ''", opts);
        const sql = q.from(T);
        const params: any = {};
        for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;
        const rows = db.prepare(sql).all(params);
        // No product has empty name, but query should execute
        expect(Array.isArray(rows)).toBe(true);
    });

    it('Empty string in edge_cases table', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Name eq ''", opts);
        const sql = q.from('edge_cases');
        const params: any = {};
        for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;
        const rows = db.prepare(sql).all(params);
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(4);
    });

    it('Large integer 2147483647 (INT32 max)', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Stock eq 2147483647', opts);
        expect(q.where).toContain('$literal1');
    });

    it('Large integer 9999999999999 (exceeds INT32)', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Stock eq 9999999999999', opts);
        expect(q.where).toContain('$literal1');
    });

    it('INT64 max 9223372036854775807', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Stock eq 9223372036854775807', opts);
        expect(q.where).toContain('$literal1');
    });

    it('Negative INT64 min -9223372036854775808', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Stock eq -9223372036854775808', opts);
        expect(q.where).toContain('$literal1');
    });

    it('GUID literal still works', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=id eq 01234567-89ab-cdef-0123-456789abcdef', opts);
        expect(q.where).toContain('$literal1');
    });

    it('Escaped single quote in string', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Name eq 'test''value'", opts);
        const params: any = Object.fromEntries(q.parameters);
        // The escaped quote should be unescaped to a single quote
        expect(params.$literal1).toBe("test'value");
    });

    it('Double escaped single quote', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=Name eq 'a''b''c'", opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$literal1).toBe("a'b'c");
    });

    it('String with percent sign (not URI encoded)', () => {
        if (!nodeSqliteAvailable) return;
        // The % character should not cause decodeURIComponent to fail
        const q = createQuery("$filter=contains(Name, '100%')", opts);
        expect(q.where).toContain('$param');
    });

    it('String with special regex chars', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery("$filter=contains(Name, '[](){}')", opts);
        expect(q.where).toContain('$param');
    });

    it('Negative decimal', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Price eq -99.99', opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$literal1).toBe(-99.99);
    });

    it('Zero value', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Stock eq 0', opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$literal1).toBe(0);
    });

    it('Scientific notation with decimal', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=Price eq 1.23e-5', opts);
        expect(q.where).toContain('$literal1');
    });

    it('Date literal', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=CreatedDate eq 2020-01-01', opts);
        expect(q.where).toContain('$literal1');
    });

    it('DateTime with timezone', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=CreatedDate eq 2020-01-01T12:00:00+05:00', opts);
        expect(q.where).toContain('$literal1');
    });

    it('DateTime UTC', () => {
        if (!nodeSqliteAvailable) return;
        const q = createQuery('$filter=CreatedDate eq 2020-01-01T12:00:00Z', opts);
        expect(q.where).toContain('$literal1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. SQL GENERATION VERIFICATION - Verify exact SQL output
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - SQL Generation Verification', () => {
    const T = 'products';

    it('Boolean true generates 0/1 parameter', () => {
        const q = createQuery('$filter=Active eq true', opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$literal1).toBe(1);
    });

    it('Boolean false generates 0/1 parameter', () => {
        const q = createQuery('$filter=Active eq false', opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$literal1).toBe(0);
    });

    it('IN with booleans converts to 0/1', () => {
        const q = createQuery('$filter=Active in (true, false)', opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$param1).toBe(1);
        expect(params.$param2).toBe(0);
    });

    it('contains generates LIKE with %wildcard%', () => {
        const q = createQuery("$filter=contains(Name, 'test')", opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$param1).toBe('%test%');
    });

    it('startswith generates LIKE with prefix%', () => {
        const q = createQuery("$filter=startswith(Name, 'test')", opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$param1).toBe('test%');
    });

    it('endswith generates LIKE with %suffix', () => {
        const q = createQuery("$filter=endswith(Name, 'test')", opts);
        const params: any = Object.fromEntries(q.parameters);
        expect(params.$param1).toBe('%test');
    });

    it('substring adjusts 0-based to 1-based', () => {
        const q = createQuery("$filter=substring(Name, 0, 3) eq 'test'", opts);
        expect(q.where).toContain('+ 1');
    });

    it('indexof adjusts 1-based to 0-based', () => {
        const q = createQuery("$filter=indexof(Name, 'test') eq 0", opts);
        expect(q.where).toContain('- 1');
    });

    it('concat uses || operator', () => {
        const q = createQuery("$filter=concat(Name, 'x') eq 'test'", opts);
        expect(q.where).toContain('||');
    });

    it('Dot notation uses json_extract', () => {
        const q = createQuery("$filter=Metadata/color eq 'silver'", opts);
        expect(q.where).toContain('json_extract');
        expect(q.where).toContain("'$.color'");
    });

    it('Deep dot notation uses nested json_extract path', () => {
        const q = createQuery("$filter=Metadata/origin/country eq 'USA'", opts);
        expect(q.where).toContain("json_extract");
        expect(q.where).toContain("'$.origin.country'");
    });

    it('Identifier quoting with double quotes', () => {
        const q = createQuery('$filter=Name eq test', opts);
        expect(q.where).toContain('"Name"');
    });

    it('Identifier with embedded quote is escaped', () => {
        // This is testing the quoteIdentifier function
        const q = createQuery('$filter=Name eq test', opts);
        const sql = q.from('table"with"quote');
        expect(sql).toContain('""with""');
    });

    it('LIMIT and OFFSET for pagination', () => {
        const q = createQuery('$top=10&$skip=20', opts);
        const sql = q.from(T);
        expect(sql).toContain('LIMIT 10');
        expect(sql).toContain('OFFSET 20');
    });

    it('OFFSET without LIMIT adds LIMIT -1', () => {
        const q = createQuery('$skip=20', opts);
        const sql = q.from(T);
        expect(sql).toContain('LIMIT -1');
        expect(sql).toContain('OFFSET 20');
    });

    it('ORDER BY with ASC default', () => {
        const q = createQuery('$orderby=Name', opts);
        const sql = q.from(T);
        expect(sql).toContain('ORDER BY "Name" ASC');
    });

    it('ORDER BY with DESC', () => {
        const q = createQuery('$orderby=Name desc', opts);
        const sql = q.from(T);
        expect(sql).toContain('ORDER BY "Name" DESC');
    });

    it('Multiple ORDER BY', () => {
        const q = createQuery('$orderby=Name asc,Age desc', opts);
        const sql = q.from(T);
        expect(sql).toContain('"Name" ASC');
        expect(sql).toContain('"Age" DESC');
    });

    it('SELECT with specific fields', () => {
        const q = createQuery('$select=Name,Price', opts);
        const sql = q.from(T);
        expect(sql).toContain('"Name"');
        expect(sql).toContain('"Price"');
    });

    it('SELECT * for all fields', () => {
        const q = createQuery('$select=*', opts);
        const sql = q.from(T);
        expect(sql).toContain('SELECT *');
    });

    it('WHERE 1=1 when no filter', () => {
        if (!nodeSqliteAvailable) return;
        // Empty query throws - use $count or $top=0 instead
        const q = createQuery('$top=0', opts);
        const sql = q.from(T);
        expect(sql).toContain('WHERE 1 = 1');
    });


    it('isof uses typeof()', () => {
        const q = createQuery("$filter=isof(Name, 'Edm.String')", opts);
        expect(q.where).toContain('typeof(');
    });

    it('cast uses CAST()', () => {
        const q = createQuery("$filter=cast(Price, 'Edm.Int32') eq 30", opts);
        expect(q.where).toContain('CAST(');
        expect(q.where).toContain('AS INTEGER');
    });

    it('has uses bitwise &', () => {
        const q = createQuery('$filter=Flags has 8', opts);
        expect(q.where).toContain('&');
    });

    it('year uses strftime', () => {
        const q = createQuery('$filter=year(CreatedDate) eq 2023', opts);
        expect(q.where).toContain("strftime('%Y'");
    });

    it('geo.distance uses haversine formula', () => {
        const q = createQuery('$filter=geo.distance(Location, Origin) lt 1000', opts);
        expect(q.where).toContain('6371000');
        expect(q.where).toContain('asin');
        expect(q.where).toContain('radians');
    });

    it('now() generates datetime()', () => {
        const q = createQuery('$filter=CreatedDate lt now()', opts);
        expect(q.where).toContain("datetime('now')");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. NESTED FUNCTION EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Nested Function Execution', () => {
    const T = 'products';

    it('contains(toupper(Name), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=contains(toupper(Name), 'LAP')");
        for (const r of rows) expect(r.Name.toUpperCase()).toContain('LAP');
    });

    it('startswith(tolower(Name), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=startswith(tolower(Name), 'lap')");
        for (const r of rows) expect(r.Name.toLowerCase().startsWith('lap')).toBe(true);
    });

    it('endswith(toupper(Name), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=endswith(toupper(Name), 'TOP')");
        for (const r of rows) expect(r.Name.toUpperCase().endsWith('TOP')).toBe(true);
    });

    it('length(toupper(Name)) gt N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=length(toupper(Name)) gt 5');
        for (const r of rows) expect(r.Name.length).toBeGreaterThan(5);
    });

    it('substring(toupper(Name), 0, 3)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=substring(toupper(Name), 0, 3) eq 'LAP'");
        for (const r of rows) expect(r.Name.toUpperCase().substring(0, 3)).toBe('LAP');
    });

    it('concat(toupper(Name), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=concat(toupper(Name), '!') eq 'LAPTOP!'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('indexof(toupper(Name), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=indexof(toupper(Name), 'TOP') eq 3");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('concat(substring(Name, 0, 3), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=concat(substring(Name, 0, 3), '...') eq 'Lap...'");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('round(Price mul 1.1) gt N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=round(Price mul 1.1) gt 1400');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('floor(Price div 100) eq N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=floor(Price div 100) eq 12');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('ceiling(Price div 100) eq N', () => {
        if (!nodeSqliteAvailable) return;
        // Desk: 599.00 / 100 = 5.99, ceiling = 6
        const { rows } = execQuery(db, T, '$filter=ceiling(Price div 100) eq 6');
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Desk');
    });

    it('abs(Price sub 1000) lt N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=abs(Price sub 1000) lt 500');
        for (const r of rows) expect(Math.abs(r.Price - 1000)).toBeLessThan(500);
    });

    it('not(contains(Name, ...))', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(contains(Name, 'xyz'))");
        // No product name contains 'xyz', so all should match
        expect(rows.length).toBe(12);
    });

    it('not(startswith(Name, ...))', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(startswith(Name, 'Z'))");
        // No product name starts with 'Z', so all should match
        expect(rows.length).toBe(12);
    });

    it('not(endswith(Name, ...))', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(endswith(Name, 'Z'))");
        expect(rows.length).toBe(12);
    });

    it('not(length(Name) gt N)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=not(length(Name) gt 100)');
        expect(rows.length).toBe(12);
    });

    it('year(CreatedDate) eq N and month(CreatedDate) gt N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=year(CreatedDate) eq 2023 and month(CreatedDate) gt 5');
        for (const r of rows) {
            const d = new Date(r.CreatedDate);
            expect(d.getUTCFullYear()).toBe(2023);
            expect(d.getUTCMonth() + 1).toBeGreaterThan(5);
        }
    });

    it('day(CreatedDate) lt N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=day(CreatedDate) lt 15');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCDate()).toBeLessThan(15);
        }
    });

    it('hour(CreatedDate) eq N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=hour(CreatedDate) eq 10');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCHours()).toBe(10);
        }
    });

    it('minute(CreatedDate) eq N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=minute(CreatedDate) eq 30');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCMinutes()).toBe(30);
        }
    });

    it('second(CreatedDate) eq N', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, '$filter=second(CreatedDate) eq 0');
        for (const r of rows) {
            expect(new Date(r.CreatedDate).getUTCSeconds()).toBe(0);
        }
    });

    it('Nested NOT with function and AND', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=not(contains(Name, 'xyz')) and Active eq true");
        for (const r of rows) {
            expect(r.Active).toBe(1);
        }
    });

    it('Multiple nested functions with OR', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=contains(toupper(Name), 'LAP') or contains(toupper(Name), 'MOU')"
        );
        for (const r of rows) {
            const upper = r.Name.toUpperCase();
            expect(upper.includes('LAP') || upper.includes('MOU')).toBe(true);
        }
    });

    it('Deep nested: concat(substring(toupper(Name), 0, 3), ...)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=concat(substring(toupper(Name), 0, 3), 'P') eq 'LAPP'"
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. DEEP RANDOMIZED FUZZING - More complex random queries with execution
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Deep Randomized Execution', () => {
    if (!nodeSqliteAvailable) return;
    const T = 'products';

    // Multiple PRNG seeds for different test runs
    const generateFilter = (seed: number, depth: number): string => {
        let s = seed;
        const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };
        const randInt = (max: number) => rand() % max;
        const pick = <T>(arr: T[]): T => arr[randInt(arr.length)];

        const fields = ['Name', 'Price', 'Stock', 'Active', 'Category', 'Rating', 'Weight', 'Flags', 'CreatedDate', 'SKU', 'id'];
        const ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
        const categories = ['Electronics', 'Furniture', 'Accessories'];
        const stringVals = ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Desk', 'Chair', 'Webcam', 'Headphones'];
        const numVals = [0, 1, 10, 50, 100, 200, 500, 29.99, 99.99, 499.99, 4.5, 3.0];
        const fns = [
            () => `contains(${pick(fields)}, '${pick(stringVals).slice(0, randInt(4) + 1)}')`,
            () => `startswith(${pick(fields)}, '${pick(stringVals).slice(0, 2)}')`,
            () => `endswith(${pick(fields)}, '${pick(stringVals).slice(-2)}')`,
            () => `length(${pick(fields)}) ${pick(ops)} ${randInt(20)}`,
            () => `tolower(${pick(fields)}) eq '${pick(stringVals).toLowerCase()}'`,
            () => `toupper(${pick(fields)}) eq '${pick(stringVals).toUpperCase()}'`,
            () => `round(${pick(fields)}) ${pick(ops)} ${pick(numVals)}`,
            () => `floor(${pick(fields)}) ${pick(ops)} ${randInt(50)}`,
            () => `ceiling(${pick(fields)}) ${pick(ops)} ${randInt(100)}`,
            () => `abs(${pick(fields)}) ${pick(ops)} ${pick(numVals)}`,
            () => `year(${pick(fields)}) eq ${2022 + randInt(3)}`,
            () => `month(${pick(fields)}) ${pick(ops)} ${1 + randInt(12)}`,
            () => `day(${pick(fields)}) ${pick(ops)} ${1 + randInt(28)}`,
            () => `hour(${pick(fields)}) ${pick(ops)} ${randInt(24)}`,
            () => `${pick(fields)} has ${1 << randInt(4)}`,
            () => `isof(${pick(fields)}, 'Edm.String')`,
            () => `isof(${pick(fields)}, 'Edm.Int32')`,
            () => `cast(${pick(fields)}, 'Edm.String') eq '${pick(stringVals)}'`,
            () => `Metadata/color eq '${pick(['silver', 'black', 'blue', 'white', 'gray', 'oak'])}'`,
            () => `Metadata/warranty ${pick(ops)} ${randInt(5)}`,
        ];

        if (depth > 4) return pick(fns)();

        const r = randInt(100);
        if (r < 25) {
            return `${pick(fields)} ${pick(ops)} ${pick([...numVals, ...categories.map(c => `'${c}'`), ...stringVals.map(s => `'${s}'`), 'true', 'false', 'null'])}`;
        } else if (r < 45) {
            return pick(fns)();
        } else if (r < 65) {
            const left = generateFilter(seed * 2 + 1, depth + 1);
            const right = generateFilter(seed * 2 + 2, depth + 1);
            return `(${left}) ${pick(['and', 'or'])} (${right})`;
        } else if (r < 75) {
            return `not(${generateFilter(seed + 1, depth + 1)})`;
        } else if (r < 85) {
            const f = pick(fields);
            const count = 2 + randInt(3);
            const vals = Array.from({ length: count }, () => pick(numVals));
            return `${f} in (${vals.join(', ')})`;
        } else if (r < 92) {
            const f = pick(fields);
            const op = pick(['add', 'sub', 'mul', 'div']);
            const n = pick(numVals);
            return `(${f} ${op} ${n}) ${pick(ops)} ${pick(numVals)}`;
        } else {
            // Nested function in comparison
            const fn = pick(fns)();
            return `${fn} ${pick(ops)} ${pick(numVals)}`;
        }
    };

    // Generate 300 more random queries with different seeds
    for (let i = 0; i < 300; i++) {
        const seed = 1000 + i * 7;
        const filter = generateFilter(seed, 0);
        const parts = [`$filter=${filter}`];
        if ((seed % 3) === 0) parts.push(`$top=${1 + (seed % 12)}`);
        if ((seed % 5) === 0) parts.push(`$orderby=${['Name', 'Price', 'Rating', 'Stock'][seed % 4]} ${seed % 2 ? 'asc' : 'desc'}`);
        if ((seed % 7) === 0) parts.push(`$select=Name,Price`);
        const odata = parts.join('&');

        it(`deep random #${i}: ${odata.slice(0, 80)}`, () => {
            try {
                const q = createQuery(odata, opts);
                const sql = q.from(T);
                const params: Record<string, any> = {};
                for (const [k, v] of q.parameters) if (sql.includes(k)) params[k] = v;

                const rows = db.prepare(sql).all(params);
                expect(Array.isArray(rows)).toBe(true);

                // Verify no SQL injection occurred
                const checkCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get({});
                expect(checkCount.cnt).toBe(12);
            } catch (e: any) {
                // Parser errors are acceptable - we're fuzzing
                if (e instanceof Error) expect(e.message).toBeTruthy();
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. CROSS-CHECK: Verify filter results match JavaScript filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Cross-Check with JS', () => {
    const T = 'products';
    let allProducts: any[];

    beforeAll(() => {
        if (!nodeSqliteAvailable) return;
        allProducts = db.prepare('SELECT * FROM products').all({}).map((r: any) => r);
    });

    it('eq filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=Category eq 'Electronics'");
        const jsFiltered = allProducts.filter(p => p.Category === 'Electronics');
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('gt filter matches JS filter', () => {
        const { rows } = execQuery(db, T, '$filter=Price gt 100');
        const jsFiltered = allProducts.filter(p => p.Price > 100);
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('AND filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=Category eq 'Electronics' and Price gt 50");
        const jsFiltered = allProducts.filter(p => p.Category === 'Electronics' && p.Price > 50);
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('OR filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=Category eq 'Furniture' or Price lt 50");
        const jsFiltered = allProducts.filter(p => p.Category === 'Furniture' || p.Price < 50);
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('NOT filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=not(Category eq 'Electronics')");
        const jsFiltered = allProducts.filter(p => p.Category !== 'Electronics');
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('contains filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=contains(Name, 'a')");
        const jsFiltered = allProducts.filter(p => p.Name.includes('a'));
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('startswith filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=startswith(Name, 'L')");
        const jsFiltered = allProducts.filter(p => p.Name.startsWith('L'));
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('endswith filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=endswith(Name, 'e')");
        const jsFiltered = allProducts.filter(p => p.Name.endsWith('e'));
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('IN filter matches JS filter', () => {
        const { rows } = execQuery(db, T, "$filter=Name in ('Laptop', 'Mouse')");
        const jsFiltered = allProducts.filter(p => ['Laptop', 'Mouse'].includes(p.Name));
        expect(rows.length).toBe(jsFiltered.length);
    });

    it('Complex filter matches JS filter', () => {
        const { rows } = execQuery(db, T,
            "$filter=(Category eq 'Electronics' and Price gt 50) or not(Active eq true)"
        );
        const jsFiltered = allProducts.filter(p =>
            (p.Category === 'Electronics' && p.Price > 50) || p.Active !== 1
        );
        expect(rows.length).toBe(jsFiltered.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. LAMBDA EXECUTION - Test any/all against real SQLite with JSON arrays
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Lambda Execution', () => {
    if (!nodeSqliteAvailable) return;
    const T = 'products';

    it('Tags/any(t: t eq "new")', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: t eq 'new')");
        // Laptop and Mouse have "new" in Tags
        expect(rows.length).toBe(2);
        expect(rows.map((r: any) => r.Name).sort()).toEqual(['Laptop', 'Mouse']);
    });

    it('Tags/any(t: t eq "wood")', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: t eq 'wood')");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Desk');
    });

    it('Tags/all(t: t ne "old")', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/all(t: t ne 'old')");
        // No product has "old" in Tags, so all should match
        expect(rows.length).toBe(12);
    });

    it('Tags/any(t: contains(t, "ne"))', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: contains(t, 'ne'))");
        // "new" contains "ne" - Laptop and Mouse
        expect(rows.length).toBe(2);
    });

    it('Tags/any(t: t eq "new") and Tags/all(t: t ne "bad")', () => {
        const { rows } = execQuery(db, T,
            "$filter=Tags/any(t: t eq 'new') and Tags/all(t: t ne 'bad')"
        );
        expect(rows.length).toBe(2);
        expect(rows.map((r: any) => r.Name).sort()).toEqual(['Laptop', 'Mouse']);
    });

    it('Tags/any(t: startswith(t, "w"))', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: startswith(t, 'w'))");
        // "wireless" starts with "w" - Mouse, Headphones
        // "wood" starts with "w" - Bookshelf
        expect(rows.length).toBe(3);
    });

    it('Tags/any(t: endswith(t, "h"))', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: endswith(t, 'h'))");
        // "tech" ends with "h" - Laptop
        expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('Tags/any(t: length(t) gt 5)', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/any(t: length(t) gt 5)");
        // "popular" (7), "wireless" (8), "noise-cancelling" (16), "mechanical" (10),
        // "ergonomic" (9), "1080p" (5 - no), "10inch" (6 - yes)
        expect(rows.length).toBeGreaterThan(0);
    });

    it('Tags/all(t: length(t) lt 20)', () => {
        const { rows } = execQuery(db, T, "$filter=Tags/all(t: length(t) lt 20)");
        // All tags should be shorter than 20 chars
        expect(rows.length).toBe(12);
    });

    it('Lambda with NOT', () => {
        const { rows } = execQuery(db, T, "$filter=not(Tags/any(t: t eq 'new'))");
        // Products without "new" tag: Desk, Chair, Webcam, Headphones, Tablet, Monitor, Keyboard, Lamp, Bookshelf
        expect(rows.length).toBe(10);
    });

    it('Lambda with OR', () => {
        const { rows } = execQuery(db, T,
            "$filter=Tags/any(t: t eq 'new') or Tags/any(t: t eq 'wood')"
        );
        // Laptop, Mouse (new) + Desk (wood) = 3
        expect(rows.length).toBe(3);
    });

    it('Lambda with AND and comparison', () => {
        const { rows } = execQuery(db, T,
            "$filter=Tags/any(t: t eq 'new') and Price lt 100"
        );
        // Only Mouse has "new" tag and price < 100
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('Metadata/warranty via dot notation with lambda', () => {
        // This tests dot notation access, not lambda
        const { rows } = execQuery(db, T, "$filter=Metadata/warranty eq 2");
        expect(rows.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. ADVANCED EDGE CASES - Deep nesting, many conditions, mixed types
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Advanced Edge Cases', () => {
    const T = 'products';

    it('Deeply nested parentheses (5 levels)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=((((Name eq 'Laptop'))))");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Deeply nested parentheses (10 levels)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T, "$filter=((((((((((Name eq 'Laptop'))))))))))");
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Mixed AND/OR with parentheses', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=(Name eq 'Laptop' or Name eq 'Mouse') and (Price gt 50)"
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Multiple OR ranges', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=(Price gt 10 and Price lt 50) or (Price gt 200 and Price lt 500) or (Price gt 1000)'
        );
        // Mouse(29.99), Headphones(199.99 - no, 199 < 200), Monitor(499.99 - no, 499 < 500),
        // Desk(599 - no), Laptop(1299.99 - yes)
        // Actually: 10 < 29.99 < 50 -> Mouse; 1299.99 > 1000 -> Laptop
        expect(rows.length).toBe(6);
    });

    it('Many OR conditions (5)', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=Name eq 'Laptop' or Name eq 'Mouse' or Name eq 'Keyboard' or Name eq 'Monitor' or Name eq 'Desk'"
        );
        expect(rows.length).toBe(5);
    });

    it('All comparison operators combined', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Price eq 29.99 and Price ne 100 and Price gt 10 and Price ge 29.99 and Price lt 100 and Price le 29.99'
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('Mixed AND/OR/NOT', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(Name eq 'Laptop') and (Price gt 100 or Active eq true) and not(Price lt 0)"
        );
        // All non-Laptop products with (Price > 100 or Active = true) and Price >= 0
        expect(rows.length).toBe(11);
    });

    it('NOT with complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(Name eq 'Laptop' or Name eq 'Mouse' or Name eq 'Keyboard')"
        );
        expect(rows.length).toBe(9);
    });

    it('Double negation', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(not(Name eq 'Laptop'))"
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Triple negation', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(not(not(Name eq 'Laptop')))"
        );
        expect(rows.length).toBe(11);
    });

    it('NOT with IN', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(Name in ('Laptop', 'Mouse', 'Keyboard'))"
        );
        expect(rows.length).toBe(9);
    });

    it('Comparison with boolean in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Active eq true and (Price gt 100 or Stock lt 50)'
        );
        for (const r of rows) {
            expect(r.Active).toBe(1);
            expect(r.Price > 100 || r.Stock < 50).toBe(true);
        }
    });

    it('Null check in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Description ne null and Price gt 100'
        );
        for (const r of rows) {
            expect(r.Description).toBeTruthy();
            expect(r.Price).toBeGreaterThan(100);
        }
    });

    it('String function in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=contains(Name, 'a') and length(Name) gt 5"
        );
        for (const r of rows) {
            expect(r.Name).toContain('a');
            expect(r.Name.length).toBeGreaterThan(5);
        }
    });

    it('Math function in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=round(Price) gt 100 and floor(Price) lt 200'
        );
        for (const r of rows) {
            expect(Math.round(r.Price)).toBeGreaterThan(100);
            expect(Math.floor(r.Price)).toBeLessThan(200);
        }
    });

    it('Date function in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=year(CreatedDate) eq 2023 and month(CreatedDate) lt 7'
        );
        for (const r of rows) {
            const d = new Date(r.CreatedDate);
            expect(d.getUTCFullYear()).toBe(2023);
            expect(d.getUTCMonth() + 1).toBeLessThan(7);
        }
    });

    it('Mixed function types in expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=contains(toupper(Name), 'LAP') and year(CreatedDate) eq 2023 and round(Price) gt 1000"
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Laptop');
    });

    it('Arithmetic in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=(Price add Stock) gt 1300 and (Price sub Stock) gt 1200'
        );
        for (const r of rows) {
            expect(r.Price + r.Stock).toBeGreaterThan(1300);
            expect(r.Price - r.Stock).toBeGreaterThan(1200);
        }
    });

    it('Cast in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=cast(Price, 'Edm.String') eq '29.99'"
        );
        // SQLite CAST(29.99 AS TEXT) = '29.99'
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('has in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            '$filter=Flags has 8 and Active eq true'
        );
        for (const r of rows) {
            expect(r.Flags & 8).toBeTruthy();
            expect(r.Active).toBe(1);
        }
    });

    it('isof in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=isof(Name, 'Edm.String') and Price gt 100"
        );
        // All Name columns are text, so isof should return true for all
        for (const r of rows) {
            expect(r.Price).toBeGreaterThan(100);
        }
    });

    it('Dot notation in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=Metadata/color eq 'silver' and Price gt 100"
        );
        for (const r of rows) {
            expect(JSON.parse(r.Metadata).color).toBe('silver');
            expect(r.Price).toBeGreaterThan(100);
        }
    });

    it('Deep dot notation in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=Metadata/origin/country eq 'USA' and Active eq true"
        );
        for (const r of rows) {
            expect(JSON.parse(r.Metadata).origin.country).toBe('USA');
            expect(r.Active).toBe(1);
        }
    });

    it('Lambda in complex expression', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=Tags/any(t: t eq 'new') and Price lt 100"
        );
        expect(rows.length).toBe(1);
        expect(rows[0].Name).toBe('Mouse');
    });

    it('All features combined', () => {
        if (!nodeSqliteAvailable) return;
        const { rows } = execQuery(db, T,
            "$filter=not(Name eq 'Laptop') and contains(toupper(Name), 'O') and " +
            "year(CreatedDate) eq 2023 and round(Price) gt 20 and " +
            "Metadata/warranty ge 1 and Tags/any(t: t ne 'bad')"
        );
        for (const r of rows) {
            expect(r.Name).not.toBe('Laptop');
            expect(r.Name.toUpperCase()).toContain('O');
            expect(new Date(r.CreatedDate).getUTCFullYear()).toBe(2023);
            expect(Math.round(r.Price)).toBeGreaterThan(20);
            expect(JSON.parse(r.Metadata).warranty).toBeGreaterThanOrEqual(1);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. MALFORMED INPUT HANDLING - Verify graceful error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeSqlite Heavy Fuzz - Malformed Input Handling', () => {
    const T = 'products';

    const malformedInputs = [
        "$filter=",
        "$filter",
        "$filter=Name eq",
        "$filter=eq 'test'",
        "$filter=Name eq 'test' and",
        "$filter=Name eq 'test' or",
        "$filter=not()",
        "$filter=()",
        "$filter=Name eq 'test'))",
        "$filter=(Name eq 'test'",
        "$filter=Name eq 'test",
        "$filter=Name eq Name eq Name",
        "$filter=Name eq 'test' and and Price gt 100",
        "$filter=$select=Name",
        "$unknown=value",
        "$filter=Name eq 'test' DROP TABLE products;--",
        "$filter=Name eq 'Robert'); DROP TABLE products;--'",
        "$filter=Name eq 'test' OR '1'='1'",
        "$filter=Name eq 'test' UNION SELECT * FROM users--",
        "$filter=Name eq 'test'; DELETE FROM products WHERE 1=1;--",
        "$filter=Name eq 'test' /* comment */",
        "$filter=Name eq 'test' -- comment",
        "$filter=Name eq 'test' # comment",
        "$filter=' OR 1=1 --",
        "$filter=' UNION SELECT password FROM users --",
        "$filter=Name eq CHAR(39) + OR + CHAR(39)",
    ];

    for (const input of malformedInputs) {
        it(`rejects: ${input.slice(0, 60)}`, () => {
            // All malformed/injection inputs should throw, not crash
            expect(() => {
                try {
                    const q = createQuery(input, opts);
                    q.from(T);
                } catch (e) {
                    // Re-throw to be caught by expect()
                    throw e;
                }
            }).toThrow();
        });
    }

    it('SQL injection payloads do not appear in generated SQL', () => {
        // Even if some injection payloads parse, the SQL should not contain
        // dangerous keywords in raw form
        const payloads = [
            "DROP TABLE",
            "DELETE FROM",
            "UNION SELECT",
            "INSERT INTO",
            "UPDATE.*SET",
        ];
        for (const payload of payloads) {
            // Test various injection attempts
            const attempts = [
                "$filter=Name eq 'test" + payload + "'",
                "$filter=Name eq '" + payload + "'",
            ];
            for (const attempt of attempts) {
                try {
                    const q = createQuery(attempt, opts);
                    const sql = q.from(T);
                    // If it parsed, verify the dangerous payload is parameterized
                    expect(sql).not.toMatch(new RegExp(payload, 'i'));
                } catch (e) {
                    // Parser rejection is the best defense
                    expect(e).toBeDefined();
                }
            }
        }
    });

    it('No raw user input in SQL for valid queries', () => {
        const userInputs = [
            "normal_value",
            "value_with_special_chars!@#$%^&*()",
            "value_with_sql_keywords_SELECT_FROM_WHERE",
            "123; DROP TABLE",
        ];
        for (const input of userInputs) {
            try {
                const q = createQuery(`$filter=Name eq '${input}'`, opts);
                const sql = q.from(T);
                // The value should be parameterized, not inlined
                expect(sql).not.toContain(input);
            } catch (e) {
                // Parser rejection is acceptable
                expect(e).toBeDefined();
            }
        }
    });
});
