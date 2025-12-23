// setup.ts
import { afterAll, beforeAll } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import express from 'express';
import { readFileSync } from 'fs';
import getPort from 'get-port';
import { GeometryLine, GeometryPoint, RecordId, Surreal } from 'surrealdb';
import { SurrealODataV4Middleware } from '../express/odata-middleware';
import { ODataExpressTable } from '../types';

let procDb: ChildProcessWithoutNullStreams;
beforeAll(async () => {
    // Spawn a new **IN MEMORY** SurrealDB instance on a random port.
    const dbPort = await getPort();
    procDb = spawn('surreal', ['start', '--user', 'root', '--pass', 'root', '--bind', '127.0.0.1:' + dbPort, 'memory'], {
        timeout: 1000 * 60 * 10, // 10 minutes
        windowsHide: true,
        detached: false
    });

    const db = new Surreal();
    await db.connect('ws://127.0.0.1:' + dbPort, {
        database: 'test',
        namespace: 'test',
        authentication: {
            username: 'root',
            password: 'root'
        }
    });
    globalThis.db = db;

    const textData = readFileSync(__dirname + '/seed-data.json', 'utf-8');
    const data = JSON.parse(textData);

    for (const post of data.posts) { await db.create(new RecordId('post', post.id)).content({ ...post, id: undefined, userId: new RecordId('user', post.userId) }); }
    for (const comment of data.comments) { await db.create(new RecordId('comment', comment.id)).content({ ...comment, id: undefined, postId: new RecordId('post', comment.postId) }); }
    for (const user of data.users) {
        await db.create(new RecordId('user', user.id)).content({
            ...user,
            id: undefined,
            // Additional fields for OData tests
            Name: user.name,
            Age: 25,
            Price: 100,
            BirthDate: new Date('1990-01-01T12:00:00.123Z'),
            category: 'General',
            created_at: new Date('2023-01-01T00:00:00Z'),
            Friends: [new RecordId('user', (user.id % 10) + 1)],
            Photos: [new RecordId('photo', (user.id % 10) + 1)],
            Family: [new RecordId('user', (user.id % 10) + 1)],
            Flags: '1',
            // Lowercase and other fields for filter.spec.ts
            value: 123,
            notes: 100,
            users: 10,
            age: 25,
            active: true,
            status: 'premium',
            subscribed: true,
            price: 20,
            Score: 12.34,
            Location: new GeometryPoint([0, 0]),
            Route: new GeometryLine([new GeometryPoint([0, 0]), new GeometryPoint([10, 10])]),
            Comments: [{ Comment: 'Good', Score: 10 }, { Comment: 'Bad', Score: 2 }],
            Date: new Date('2020-01-01T00:00:00Z'),
            Email: 'test@example.com',
            FirstName: 'John',
            LastName: 'Doe'
        });
    }
    for (const album of data.albums) { await db.create(new RecordId('album', album.id)).content({ ...album, id: undefined, userId: new RecordId('user', album.userId) }); }
    for (const todo of data.todos) { await db.create(new RecordId('todo', todo.id)).content({ ...todo, id: undefined, userId: new RecordId('user', todo.userId) }); }
    for (const photo of data.photos) { await db.create(new RecordId('photo', photo.id)).content({ ...photo, id: undefined, albumId: new RecordId('album', photo.albumId) }); }


    const app = express();
    app.use(express.json());
    app.use("/api/odata", SurrealODataV4Middleware({
        tables: [
            new ODataExpressTable({ table: 'post' }),
            new ODataExpressTable({ table: 'comment' }),
            new ODataExpressTable({ table: 'user' }),
            new ODataExpressTable({ table: 'album' }),
            new ODataExpressTable({ table: 'todo' }),
            new ODataExpressTable({ table: 'photo' })
        ],
        resolveDb: () => {
            return db;
        }
    }));
    app.use("/api/odata-limited", SurrealODataV4Middleware({
        tables: [
            new ODataExpressTable({ table: 'post' })
        ],
        resolveDb: () => {
            return db;
        },
        maxPageSize: 5
    }));
    app.use("/api/odata-restricted", SurrealODataV4Middleware({
        tables: [
            new ODataExpressTable({
                table: 'post',
                allowedOrderByFields: ['id', 'title']
            })
        ],
        resolveDb: () => {
            return db;
        }
    }));
    (global as any).app = app;
});

afterAll(() => {
    procDb.kill();
});
