import { beforeAll, describe, expect, test } from 'bun:test';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { RecordId, Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../../../express/odata-middleware';
import { ODataExpressConfig, ODataExpressTable } from '../../../types';

describe('Record ID Literals in $filter', () => {
    let app: Express;
    let db: Surreal;

    beforeAll(async () => {
        db = (global as any).db;

        // Create test tables
        await db.query(`
            DEFINE TABLE orders SCHEMALESS;
            DEFINE TABLE customers SCHEMALESS;
            DEFINE TABLE products SCHEMALESS;
        `);

        // Create test data
        await db.create(new RecordId('customers', 'alice')).content({ name: 'Alice' });
        await db.create(new RecordId('customers', 'bob')).content({ name: 'Bob' });
        await db.create(new RecordId('customers', 'charlie')).content({ name: 'Charlie' });

        await db.create(new RecordId('products', 'widget')).content({ name: 'Widget', price: 10 });
        await db.create(new RecordId('products', 'gadget')).content({ name: 'Gadget', price: 20 });

        await db.create(new RecordId('orders', 'order1')).content({
            customerId: new RecordId('customers', 'alice'),
            productId: new RecordId('products', 'widget'),
            quantity: 5
        });
        await db.create(new RecordId('orders', 'order2')).content({
            customerId: new RecordId('customers', 'bob'),
            productId: new RecordId('products', 'gadget'),
            quantity: 3
        });
        await db.create(new RecordId('orders', 'order3')).content({
            customerId: new RecordId('customers', 'alice'),
            productId: new RecordId('products', 'gadget'),
            quantity: 2
        });

        const config: ODataExpressConfig = {
            resolveDb: () => db,
            tables: [
                new ODataExpressTable({ table: 'orders' }),
                new ODataExpressTable({ table: 'customers' }),
                new ODataExpressTable({ table: 'products' })
            ]
        };

        app = express();
        app.use(express.json());
        app.use('/odata', SurrealODataV4Middleware(config));
    });

    test('should filter with record ID using double quotes r"table:id"', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r"customers:alice"');

        if (response.status !== 200) {
            console.error('Error response:', response.body);
            console.error('Status:', response.status);
            console.error('Text:', response.text);
        }

        expect(response.status).toBe(200);
        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(2);
        expect(response.body.value.every(o => o.customerId === 'customers:alice')).toBe(true);
    });

    test('should filter with record ID using single quotes r\'table:id\'', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r\'customers:bob\'')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        expect(response.body.value[0].customerId).toBe('customers:bob');
    });

    test('should filter with record ID using backticks r`table:id`', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=productId eq r`products:widget`')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        expect(response.body.value[0].productId).toBe('products:widget');
    });

    test('should filter with ne (not equals) operator', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId ne r"customers:alice"')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        expect(response.body.value[0].customerId).toBe('customers:bob');
    });

    test('should combine multiple record ID filters with and', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r"customers:alice" and productId eq r"products:gadget"')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        expect(response.body.value[0].customerId).toBe('customers:alice');
        expect(response.body.value[0].productId).toBe('products:gadget');
    });

    test('should handle complex filter with mixed quote types', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r"customers:alice" and productId ne r\'products:widget\'')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        expect(response.body.value[0].productId).toBe('products:gadget');
    });

    test('should handle record IDs with numeric IDs', async () => {
        // Create an order with numeric ID
        await db.create(new RecordId('orders', 'order4')).content({
            customerId: new RecordId('customers', '123'),
            productId: new RecordId('products', 'widget'),
            quantity: 1
        });

        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r"customers:123"')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(1);
        // SurrealDB formats numeric IDs with angle brackets
        expect(response.body.value[0].customerId).toMatch(/customers:(⟨)?123(⟩)?/);
    });

    test('should handle record IDs in or expressions', async () => {
        const response = await request(app)
            .get('/odata/orders?$filter=customerId eq r"customers:alice" or customerId eq r"customers:bob"')
            .expect(200);

        expect(response.body.value).toBeDefined();
        expect(response.body.value.length).toBe(3);
    });
});
