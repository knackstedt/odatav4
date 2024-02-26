import { SQLLang, createFilter } from './main';

const filter = createFilter('startswith(type, \'psychology\') and (price lt 25.00)', {
    // type: SQLLang.MsSql
    type: SQLLang.SurrealDB
});

console.log(filter);