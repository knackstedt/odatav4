import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../../../express/odata-middleware';
import { ODataExpressConfig, ODataExpressTable } from '../../../express/types';

describe('Field Types Transformation', () => {
    let app: Express;
    let db: Surreal;

    beforeAll(async () => {
        db = (global as any).db;

        // Create test table (SCHEMALESS to allow flexible field types)
        await db.query(`
            DEFINE TABLE events SCHEMALESS;
        `);

        const config: ODataExpressConfig = {
            resolveDb: () => db,
            tables: [
                new ODataExpressTable({
                    table: 'events',
                    fieldTypes: {
                        'createdAt': 'datetime',
                        'eventDate': 'datetime',
                        'price': 'decimal',
                        'eventId': 'uuid',
                        'duration': 'duration',
                        'organizerId': 'record'
                    }
                })
            ]
        };

        app = express();
        app.use(express.json());
        app.use('/odata', SurrealODataV4Middleware(config));
    });

    test('POST - should transform datetime field from string', async () => {
        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'Test Event',
                createdAt: '2024-01-15T10:30:00Z',
                eventDate: '2024-02-20T14:00:00Z',
                category: 'conference'
            });

        if (response.status !== 200) {
            console.error('Error response:', response.body);
            console.error('Status:', response.status);
        }

        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
        expect(response.body.name).toBe('Test Event');
        expect(response.body.createdAt).toBeDefined();
        expect(response.body.eventDate).toBeDefined();
        // Verify the datetime was parsed and stored as an ISO timestamp
        expect(new Date(response.body.createdAt).toISOString()).toBe('2024-01-15T10:30:00.000Z');
        expect(new Date(response.body.eventDate).toISOString()).toBe('2024-02-20T14:00:00.000Z');
    });

    test('POST - should transform decimal field from string', async () => {
        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'Paid Event',
                price: '99.99',
                category: 'workshop'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.price).toBeDefined();
        expect(response.body.price).toBe('99.99');
    });

    test('POST - should transform uuid field from string', async () => {
        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'UUID Event',
                eventId: '550e8400-e29b-41d4-a716-446655440000',
                category: 'meetup'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.eventId).toBeDefined();
        expect(response.body.eventId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    test('POST - should transform duration field from string', async () => {
        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'Duration Event',
                duration: '2h30m',
                category: 'seminar'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.duration).toBeDefined();
        expect(response.body.duration).toBe('2h30m');
    });

    test('POST - should transform record field from string', async () => {
        // First create a user record
        await db.query('CREATE user:john SET name = "John Doe"');

        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'Organized Event',
                organizerId: 'user:john',
                category: 'networking'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.organizerId).toBeDefined();
        expect(response.body.organizerId).toBe('user:john');
    });

    test('PATCH - should transform fields on update', async () => {
        // Create an event first
        const createResponse = await request(app)
            .post('/odata/events')
            .send({
                name: 'Update Test Event',
                category: 'test'
            })
            .expect(200);

        const eventId = createResponse.body.id;

        // Update with field type transformations
        const updateResponse = await request(app)
            .patch(`/odata/${eventId}`)
            .send({
                price: '149.99',
                eventDate: '2024-03-15T09:00:00Z'
            })
            .expect(200);

        expect(updateResponse.body).toBeDefined();
        expect(updateResponse.body.price).toBeDefined();
        expect(updateResponse.body.price).toBe('149.99');
        expect(updateResponse.body.eventDate).toBeDefined();
        expect(new Date(updateResponse.body.eventDate).toISOString()).toBe('2024-03-15T09:00:00.000Z');
    });

    test('PUT - should transform fields on upsert', async () => {
        const response = await request(app)
            .put('/odata/events:test123')
            .send({
                name: 'Upsert Event',
                createdAt: '2024-01-01T00:00:00Z',
                price: '75.50',
                category: 'upsert-test'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.name).toBe('Upsert Event');
        expect(response.body.createdAt).toBeDefined();
        expect(new Date(response.body.createdAt).toISOString()).toBe('2024-01-01T00:00:00.000Z');
        expect(response.body.price).toBeDefined();
        expect(parseFloat(response.body.price)).toBe(75.5);
    });

    test('POST - should handle null/undefined values gracefully', async () => {
        const response = await request(app)
            .post('/odata/events')
            .send({
                name: 'Null Test Event',
                price: null,
                eventDate: undefined,
                category: 'null-test'
            })
            .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.name).toBe('Null Test Event');
        // null price should be stored as null, not transformed
        expect(response.body.price).toBeNull();
        // undefined eventDate should be omitted from the stored record
        expect(response.body.eventDate).toBeUndefined();
    });

    afterAll(async () => {
        // Clean up test data to avoid interfering with other test suites
        // that share the same SurrealDB instance (e.g. express.spec.ts
        // arithmetic tests fail if user records without numericId exist).
        if (db) {
            try {
                await db.query('DELETE FROM events').collect();
                await db.query('DELETE FROM user:john').collect();
                await db.query('REMOVE TABLE events').collect();
            } catch { /* ignore cleanup errors */ }
        }
    });
});
