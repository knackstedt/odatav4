> :attn:
> This project is a fork of these repositories with added support for SurrealDB.
> https://github.com/jaystack/odata-v4-sql
> https://github.com/jaystack/odata-v4-parser


# DotGlitch ODataV4
This package provides a parser that reads ODataV4 compliant query parameters and produces SQL code that can be used to perform queries.

This fork adds support for SurrealDB, plus some miscellaneous fixes and improvements.

Additionally, this fork provides a customizable Express middleware that lets you quickly and safely expose tables from SurrealDB. (Other SQL languages may be added upon request)


### Exposing a table via Express
> This is available only for the SurrealDB mode. Other modes may be added upon request.

```typescript
import express from 'express';
import { SurrealODataV4Middleware } from '@dotglitch/odatav4';
import type { ODataExpressTable } from '@dotglitch/odatav4';

const ODataV4Controller = SurrealODataV4Middleware({
    tables: [
        new ODataExpressTable({
            table: "vehicle",
            accessControl: {
                // Anyone can read, but only admins can write.
                write: ["administrator"]
            }
        }),
        new ODataExpressTable({
            table: "feedback",
            accessControl: {
                // Only admins can read the table, but anyone logged in can perform an insert.
                read: ["administrator"],
                patch: ["administrator"],
                put: ["administrator"],
                delete: ["administrator"]
                // post is allowed, so we'll leave it undefined. 
            }
        }),
        new ODataExpressTable({
            table: "geolocation",
            afterRecordGet: async item => {
                const { data: location } = await axios.get("https://api.example.com/v1/resolveLocation?id=" + item.id);
                item.location = location;
                return item;
            }
        })
    ],
    resolveDb(req) {
        // A database resolver that allows you to customize which Surreal instance
        // the ODataV4 query is executed against. This can be used to utilize a user
        // connection, connection pools, custom variables and more.
        return req.db;
    }
});

const app = express();
app.use("/api/v1/odata/", ODataV4Controller);
...
```


### Processing individual parameters
```typescript
import { createFilter } from '@dotglitch/odatav4';

//example request:  GET /api/Users?$filter=Id eq 42
app.get("/api/Users", (req: Request, res: Response) => {
    const filter = createFilter(req.query.$filter);
    // request instance from mssql module
    request.query(`SELECT * FROM Users WHERE ${filter.where}`, function(err, data){
        res.json({
        	'@odata.context': req.protocol + '://' + req.get('host') + '/api/$metadata#Users',
        	value: data
        });
    });
});
```


### Processing entire query string

```ts
import { createQuery } from '@dotglitch/odatav4';

const parsedQuery = createQuery(`$filter=startswith(name, 'aws-') AND state eq 'offline'`, {
    type: SQLLang.SurrealDB
});

```

# Security 
> The original project appears to have decent SQLi prevention for the original SQL based implementations, though I will not attest to how safe it is against SQLi in them. That said, for SurrealDB the project emits **extremely** secure SURQL syntax that should be nearly impossible for an attacker to trigger SQLi.

Anything that can be passed as a parameter will be passed as a parameter. This maximizes the resiliency against SQLi attacks and additionally ensures that the queries can be audited safely.


Sample ODataV4 filter & select:
```elixir
# Select just the id and name fields
$select=id,name
# Filter to entries that have a name starting with `aws-` and are in the `offline` state.
$filter=startswith(name, 'aws-') AND state eq 'offline'
```

Gets internally passed to the query builder:
```ts
import { ODataV4ToSurrealQL } from '@dotglitch/odatav4';

const query = ODataV4ToSurrealQL("cloud_vm", "?$select=id,name&$filter=startswith(name, 'aws-') AND state eq 'offline'");
```

When executed it outputs the following JSON:
```ts
const query = {
    // A query that returns the number of entries in the table with the provided filters
    countQuery: "SELECT count() FROM type::table($table) WHERE string::starts_with(type::field($f1), type::string($p1)) && type::field($f2) = $l2 GROUP ALL",
    // The query that fetches the data.
    // You can see that the selected fields are encoded, along with the table name, fields and values.
    entriesQuery: "SELECT type::field($s0), type::field($s1) FROM type::table($table) WHERE string::starts_with(type::field($f1), type::string($p1)) && type::field($f2) = $l2",
    parameters: {
        $s0: "id",
        $s1: "name",
        $f1: "name",
        $p1: "aws-",
        $f2: "state",
        $l2: "offline",
        $table: "cloud_vm",
      },
      skip: undefined,
      limit: undefined,
}
```
