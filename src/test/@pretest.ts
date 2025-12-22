// setup.ts
import { afterAll, beforeAll } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import express from 'express';
import { readFileSync } from 'fs';
import getPort from 'get-port';
import { RecordId, Surreal } from 'surrealdb';
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
    for (const user of data.users) { await db.create(new RecordId('user', user.id)).content({ ...user, id: undefined }); }
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
