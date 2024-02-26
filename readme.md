> :attn:
> This project is a fork of these repositories with added support for SurrealDB.
> https://github.com/jaystack/odata-v4-sql
> https://github.com/jaystack/odata-v4-parser



# OData V4 Service modules - SQL Connector

Service OData v4 requests from an SQL data store.

## Synopsis
The OData V4 SQL Connector provides functionality to convert the various types of OData segments
into SQL query statements, that you can execute over an SQL database.

## Potential usage scenarios

- Create high speed, standard compliant data sharing APIs

## Usage as server - TypeScript
```javascript
import { createFilter } from 'odata-v4-sql'

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

Advanced TypeScript example available [here](https://raw.githubusercontent.com/jaystack/odata-v4-sql/master/src/example/sql.ts).

## Supported OData segments

* $filter
* $select
* $skip
* $top
* $orderby
* $expand