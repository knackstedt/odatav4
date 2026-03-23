import { beforeAll, describe, expect, test } from 'bun:test';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { RecordId, Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../../../express/odata-middleware';
import { ODataExpressConfig, ODataExpressTable } from '../../../types';

describe('Prefixed Literals in $filter', () => {
    let app: Express;
    let db: Surreal;

    beforeAll(async () => {
        db = (global as any).db;

        // Create test table
        await db.query(`
            DEFINE TABLE transactions SCHEMALESS;
        `);

        // Create test data with various types
        await db.create(new RecordId('transactions', 'tx1')).content({
            customerId: new RecordId('customers', 'alice'),
            amount: 99.99,
            createdAt: new Date('2024-01-15T10:30:00Z'),
            status: 'completed'
        });
        await db.create(new RecordId('transactions', 'tx2')).content({
            customerId: new RecordId('customers', 'bob'),
            amount: 150.50,
            createdAt: new Date('2024-02-20T14:00:00Z'),
            status: 'pending'
        });
        await db.create(new RecordId('transactions', 'tx3')).content({
            customerId: new RecordId('customers', 'alice'),
            amount: 75.25,
            createdAt: new Date('2024-03-10T09:15:00Z'),
            status: 'completed'
        });
        await db.create(new RecordId('transactions', 'tx4')).content({
            customerId: new RecordId('customers', 'charlie'),
            amount: 200.00,
            createdAt: new Date('2024-01-05T16:45:00Z'),
            status: 'completed'
        });

        const config: ODataExpressConfig = {
            resolveDb: () => db,
            tables: [
                new ODataExpressTable({ table: 'transactions' })
            ]
        };

        app = express();
        app.use(express.json());
        app.use('/odata', SurrealODataV4Middleware(config));
    });

    describe('Date Prefix (d"...")', () => {
        test('should filter with date using double quotes d"..."', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=createdAt ge d"2024-02-01"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx2 and tx3
        });

        test('should filter with date using single quotes d\'...\'', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=createdAt lt d\'2024-02-01\'')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx1 and tx4
        });

        test('should filter with date using backticks d`...`', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=createdAt eq d`2024-01-15T10:30:00Z`')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(1);
        });

        test('should handle date range filters', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=createdAt ge d"2024-01-10" and createdAt lt d"2024-03-01"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx1 and tx2
        });
    });

    describe('Number Prefix (n"...")', () => {
        test('should filter with number using double quotes n"..."', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=amount eq n"99.99"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(1);
            expect(response.body.value[0].amount).toBe(99.99);
        });

        test('should filter with number using single quotes n\'...\'', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=amount gt n\'100\'')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx2 and tx4
        });

        test('should filter with number using backticks n`...`', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=amount lt n`100`')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx1 and tx3
        });

        test('should handle decimal numbers', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=amount eq n"75.25"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(1);
            expect(response.body.value[0].amount).toBe(75.25);
        });

        test('should handle number range filters', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=amount ge n"75" and amount le n"150"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx1 and tx3
        });
    });

    describe('Combined Prefixed Literals', () => {
        test('should combine record ID, date, and number filters', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=customerId eq r"customers:alice" and createdAt ge d"2024-01-01" and amount lt n"100"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(2); // tx1 and tx3
        });

        test('should handle mixed quote styles', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=customerId eq r"customers:alice" and createdAt ge d\'2024-02-01\' and amount gt n`70`')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(1); // tx3
        });

        test('should handle complex filter with all prefix types', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=(customerId eq r"customers:alice" or customerId eq r"customers:bob") and createdAt ge d"2024-01-01" and amount ge n"50"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(3); // tx1, tx2, tx3
        });

        test('should handle ne operator with prefixed literals', async () => {
            const response = await request(app)
                .get('/odata/transactions?$filter=customerId ne r"customers:alice" and amount ne n"150.50"')
                .expect(200);

            expect(response.body.value).toBeDefined();
            expect(response.body.value.length).toBe(1); // tx4
        });
    });
});
