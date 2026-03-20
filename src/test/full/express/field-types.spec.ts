import { beforeAll, describe, expect, test } from 'bun:test';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../../../express/odata-middleware';
import { ODataExpressConfig, ODataExpressTable } from '../../../types';

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
        expect(updateResponse.body.eventDate).toBeDefined();
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
        expect(response.body.price).toBeDefined();
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
    });

});
