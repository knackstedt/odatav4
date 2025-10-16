import Surreal from 'surrealdb';
import { SurrealODataV4Middleware } from '../express/odata-middleware';
import { ODataExpressTable } from '../types';
import express from 'express';
import axios from 'axios';


export const TenantODataV4Controller = SurrealODataV4Middleware({
    resolveDb: async (req) => {
        const db = new Surreal();
        await db.connect('http://localhost:8000', { auth: { username: 'root', password: 'root' } });
        await db.use({ namespace: 'test', database: 'test' });
        return db;
    },
    variables(req, item) {
        return {
            "bp.identity": "system" //req.session?.profile?.id || "system"
        };
    },
    tables: [
        new ODataExpressTable<{
            id: string;
            name: string;
            state: string;
            owner: string;
            field1: string;
            type: string;
            foobar: string;
        }>({
            table: 'finding',
            accessControl: {
                write: ["administrator"]
            },
            afterRecordDelete(req, record) {
                return null;
            },
        }),
    ]
});


const app = express();

app.use(express.json());
app.use((req, res, next) => {
    req.session ??= {};
    req.session.profile = { id: "user1", roles: ["administrator"] };
    next();
});
app.use('/odata', TenantODataV4Controller);

app.listen(7000, () => {
    console.log('OData v4 server listening on port 3000');
});


(async () => {
    const { id } = await axios.post("http://localhost:7000/odata/finding", {
        name: "Test",
        state: "post_ok",
    }).then(res => {
        console.log("POST SUCCESS", res.data.id);
        return res.data;
    });

    await axios.get("http://localhost:7000/odata/finding/" + id).then(res => {
        console.log("GET SINGLE SUCCESS", res.data.id);
    });

    await axios.get("http://localhost:7000/odata/finding/").then(res => {
        console.log("GET TABLE SUCCESS", res.data['@odata.count']);
    });

    await axios.patch("http://localhost:7000/odata/finding/" + id, {
        id,
        state: "patch_ok",
    }).then(res => {
        console.log("PATCH SINGLE SUCCESS", res.data.state);
    });

    await axios.put("http://localhost:7000/odata/finding/" + id, {
        name: "Test",
        state: "put_ok"
    }).then(res => {
        console.log("PUT SINGLE SUCCESS", res.data.state);
    });

    await axios.delete("http://localhost:7000/odata/finding/" + id).then(res => {
        console.log("DELETE SINGLE SUCCESS", res.data.id);
    });

    process.exit(0);
})();
