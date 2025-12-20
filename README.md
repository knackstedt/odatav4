# @dotglitch/odatav4

**Maintained OData V4 Parser and Query Builder for SurrealDB**

[![npm version](https://img.shields.io/npm/v/@dotglitch/odatav4.svg)](https://www.npmjs.com/package/@dotglitch/odatav4)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> This project is a fork of [jaystack/odata-v4-sql](https://github.com/jaystack/odata-v4-sql) and [jaystack/odata-v4-parser](https://github.com/jaystack/odata-v4-parser) with added support for SurrealDB, enhanced security, and Express middleware for rapid API development.

---

## Table of Contents

- [What is OData V4?](#what-is-odata-v4)
- [Why This Library?](#why-this-library)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [Use Cases & Examples](#use-cases--examples)
- [Express Middleware](#express-middleware)
- [Query Syntax & Examples](#query-syntax--examples)
- [Security](#security)
- [API Reference](#api-reference)
- [Supported OData V4 Features](#supported-odata-v4-features)
- [Contributing](#contributing)

---

## What is OData V4?

**OData (Open Data Protocol)** is an ISO/IEC approved, OASIS standard that defines best practices for building and consuming RESTful APIs. OData V4 enables rich querying capabilities through URL parameters, making APIs more powerful and flexible without requiring custom endpoints for every query variation.

### Why OData V4 is Powerful

- **🎯 Standardized Querying**: Universal query syntax that works across different APIs
- **🚀 Rich Filtering**: Complex queries with logical, arithmetic, and function-based operations
- **📦 Reduced API Complexity**: No need to create custom endpoints for every query combination
- **🔄 Interoperability**: Works with established tooling and BI platforms (Power BI, Excel, Tableau)
- **📱 Client-Friendly**: Frontend developers can query exactly what they need
- **⚡ Performance**: Fetch only required fields, paginate efficiently, and filter server-side

### Real-World Benefits

Instead of creating separate endpoints like:
- `GET /users/active`
- `GET /users/by-role?role=admin`
- `GET /users/search?name=john`

With OData V4, you use **one endpoint** with flexible queries:
```
GET /users?$filter=isActive eq true
GET /users?$filter=role eq 'admin'
GET /users?$filter=startswith(name, 'john')
GET /users?$filter=age gt 18 and role eq 'admin'&$select=name,email&$orderby=name asc
```

---

## Why This Library?

### 🎯 Unique Features

1. **SurrealDB Support**: First-class support for SurrealDB's powerful query language (SurQL)
2. **Security-First Design**: Parameterized queries prevent SQL injection attacks
3. **Express Middleware**: Build complete REST APIs in minutes with built-in access control
4. **Active Maintenance**: Fork of abandoned jaystack libraries with modern improvements
5. **Type Safety**: Full TypeScript support with comprehensive type definitions

### 🛡️ Security Advantages

This library generates **extremely secure** SurQL queries using parameterized statements:

```typescript
// OData Query: $filter=name eq 'John'&$select=id,name&$orderby=id&$groupby=department

// ❌ Other libraries (vulnerable):
// SELECT id, name FROM users WHERE name = 'John' GROUP BY department ORDER BY id ASC

// ✅ This library (secure):
// SELECT type::field($select0), type::field($select1) FROM type::table($table) WHERE type::field($field1) = $literal1 GROUP BY `department` ORDER BY `id` ASC
// Parameters: { $table: "users", $field1: "name", $literal1: "John", $select0: "id", $select1: "name" }
```

**Everything** that can be parameterized **is** parameterized - including table names, field names, and values.

> As of SurrealDB 3.0. ORDER BY keys cannot be parameterized, thus the library will use string interpolation for ORDER BY clauses, escaping symbols as needed.

---

## Quick Start

### Installation

```bash
bun add @dotglitch/odatav4
# or
npm install @dotglitch/odatav4
```

### Minimal Example

```typescript
import { createQuery, SQLLang } from '@dotglitch/odatav4';
import { renderQuery } from '@dotglitch/odatav4';

const query = createQuery(
  "$filter=age gt 18&$select=name,email&$orderby=name asc",
  { type: SQLLang.SurrealDB }
);
const result = renderQuery(query, "users"); 

// SELECT type::field($select0), type::field($select1) FROM type::table($table) WHERE type::field($field1) > $literal1 ORDER BY `name` ASC
console.log(result.entriesQuery);
// SELECT count() FROM type::table($table) WHERE type::field($field1) > $literal1 GROUP ALL
console.log(result.countQuery); 
// { $table: "users", $field1: "age", $literal1: 18, $select0: "name", $select1: "email" }
console.log(result.parameters);
```

---

## Core Features

| Feature | Status | Description |
|---------|--------|-------------|
| `$filter` | ✅ | Filter collections with logical, comparison, and function operations |
| `$select` | ✅ | Choose specific fields to return |
| `$groupby` | ✅ | Group results by one or more fields |
| `$orderby` | ✅ | Sort results by one or more fields |
| `$top` | ✅ | Limit number of results (pagination) - configurable max via `maxPageSize` |
| `$skip` | ✅ | Skip N results (pagination) - configurable max via `maxSkip` |
| `$count` | ✅ | Include total count in response |
| `$format` | ⚠️ | Specify response format (json, xml, atom) - partial support |
| `$skiptoken` | ⚠️ | Server-driven pagination token - partial support |
| `$id` | ✅ | Fetch specific record by ID |
| `$search` | ⚠️ | Full-text search (partial support, enable via `enableSearch` option) |
| `$expand` | 🔄 | Expand related entities - configurable limits via `maxExpandDepth` and `maxExpandCount` |

### Supported Filter Operations

- **Logical**: `and`, `or`, `not`
- **Comparison**: `eq`, `ne`, `gt`, `ge`, `lt`, `le`
- **Arithmetic**: `add`, `sub`, `mul`, `div`, `mod`
- **String Functions**: `contains`, `startswith`, `endswith`, `length`, `indexof`, `tolower`, `toupper`, `trim`
- **Date/Time Functions**: `year`, `month`, `day`, `hour`, `minute`, `second`, `now`
- **Math Functions**: `round`, `floor`, `ceiling`

---

## Use Cases & Examples

### 1. Express Middleware - Complete REST API in Minutes

Perfect for: Admin panels, dashboards, internal tools, rapid prototyping

```typescript
import express from 'express';
import { SurrealODataV4Middleware, ODataExpressTable } from '@dotglitch/odatav4';

const app = express();

const ODataController = SurrealODataV4Middleware({
  tables: [
    new ODataExpressTable({
      table: "products",
      accessControl: {
        read: null,  // Public read access
        write: ["admin", "inventory-manager"]  // Restricted writes
      }
    }),
    new ODataExpressTable({
      table: "users",
      accessControl: {
        read: ["admin"],
        write: ["admin"]
      }
    })
  ],
  resolveDb(req) {
    return req.db; // Your SurrealDB connection
  }
});

app.use("/api/odata/", ODataController);
app.listen(3000);
```

Now you have full CRUD endpoints with OData querying:
```
GET  /api/odata/products                           # List all
GET  /api/odata/products?$filter=price lt 100      # Filter
GET  /api/odata/products/prod:123                  # Get by ID
POST /api/odata/products                           # Create
PATCH /api/odata/products/prod:123                 # Update
DELETE /api/odata/products/prod:123                # Delete
```

### 2. Building a Mobile App Backend

Perfect for: Mobile apps, SPAs, client-driven filtering

```typescript
import { SurrealODataV4Middleware, ODataExpressTable } from '@dotglitch/odatav4';

const mobileAPI = SurrealODataV4Middleware({
  tables: [
    new ODataExpressTable({
      table: "posts",
      fetch: ["author", "comments"],  // Auto-fetch relations
      afterRecordGet: async (req, post) => {
        // Add computed fields
        post.likeCount = await countLikes(post.id);
        post.isLikedByUser = await checkUserLike(req.user.id, post.id);
        return post;
      }
    }),
    new ODataExpressTable({
      table: "notifications",
      accessControl: {
        read: null,  // All authenticated users can read
        post: ["system"],  // Only system can create
        delete: null  // Users can delete their own (custom logic in beforeDelete)
      },
      beforeRecordDelete: async (req, notification) => {
        if (notification.userId !== req.user.id) {
          throw new Error("Unauthorized");
        }
        return notification;
      }
    })
  ],
  resolveDb(req) {
    return req.userDbConnection;
  }
});
```

Client usage:
```javascript
// Fetch recent posts with author and comments
GET /api/posts?$orderby=createdAt desc&$top=20

// Search posts
GET /api/posts?$filter=contains(title, 'TypeScript')

// Get unread notifications
GET /api/notifications?$filter=read eq false&$orderby=createdAt desc
```

### 3. Query Builder for Complex Filters

Perfect for: Search interfaces, analytics, data exploration

```typescript
TODO!
```

### 4. Multi-Tenant SaaS Application

Perfect for: SaaS platforms, white-label solutions, B2B applications

```typescript
import { GetTenant } from "./utils/tenant";

const multiTenantAPI = SurrealODataV4Middleware({
  tables: [
    new ODataExpressTable({
      table: "customers",
      
      // Automatically filter by tenant using row-level security
      rowLevelFilter: (req) => `tenantId = '${req.tenant.id}'`,
      
      // Additional validation hook if needed
      beforeRecordGet: async (req) => {
        console.log(`Tenant ${req.tenant.id} accessing customers`);
      },
      
      beforeRecordPost: async (req, customer) => {
        // Ensure tenantId is set on creation
        customer.tenantId = req.tenant.id;
        return customer;
      }
    })
  ],
  resolveDb: async (req) => {
    // Can be async if needed
    return GetTenant(req.session.tenantId);
  },
  variables: (req) => ({
    // These are added to all DB requests and can be useful
    // for table events, computed fields, etc.
    $tenantId: req.tenant.id,
    $userId: req.user.id
  })
});
```

> **Note**: The `rowLevelFilter` is automatically AND'd with user queries, ensuring perfect tenant isolation without manual filtering in every hook. Alternatively you could provide a `partial` and `parameters` object to the `rowLevelFilter` function to inject variables into the query. Other tenancy approaches such as a database per tenant can be implemented by using the `resolveDb` function.

### 5. Data Export and Reporting

Perfect for: Dashboards, BI tools, data exports

```typescript
import { ODataV4ToSurrealQL } from '@dotglitch/odatav4';

// Generate reports with flexible filtering
async function generateSalesReport(req: Request) {
  const { countQuery, entriesQuery, parameters } = ODataV4ToSurrealQL(
    "sales",
    req.url.split('?')[1]  // Pass query string
  );
  
  const [count, entries] = await Promise.all([
    db.query(countQuery, parameters),
    db.query(entriesQuery, parameters)
  ]);
  
  return {
    '@odata.count': count[0].count,
    value: entries,
    summary: calculateSummary(entries)
  };
}

// Client can request exactly what they need:
// GET /reports/sales?$filter=year(date) eq 2024 and region eq 'EMEA'&$select=product,revenue,quantity
```

---

## Express Middleware

### Complete Configuration

```typescript
import { SurrealODataV4Middleware, ODataExpressTable } from '@dotglitch/odatav4';
import ulid from 'ulidx';

const middleware = SurrealODataV4Middleware({
  // Database resolver
  resolveDb: async (req) => {
    // Return different DB based on user, tenant, etc.
    return req.db;
  },
  
  // Optional: Custom record ID generation
  idGenerator: (item) => {
    return `${item.type}:${ulid()}`;
  },
  
  // Optional: Global variables for all queries
  variables: (req, item) => ({
    $currentUser: req.user.id,
    $timestamp: new Date().toISOString()
  }),
  
  // DoS Protection: Limit pagination and expansion
  maxPageSize: 500,        // Server-driven page size limit (default: 500)
  maxSkip: 1000000,        // Maximum $skip value (default: 1000000)
  maxExpandDepth: 5,       // Maximum nested $expand depth (default: 5)
  maxExpandCount: 10,      // Maximum total expansions (default: 10)
  
  // Table configurations
  tables: [
    new ODataExpressTable({
      table: "orders",
      
      // Optional: Custom URI segment (defaults to table name)
      uriSegment: "customer-orders",
      
      // Optional: Always fetch these relations
      fetch: ["customer", "items", "items.product"],
      
      // Access control by role
      accessControl: {
        read: ["customer", "admin"],      // Must have one of these roles
        post: ["customer", "admin"],      
        patch: ["admin"],                 // Only admins can update
        delete: ["admin"],
        // Or use shortcuts:
        // write: ["admin"],  // Covers post, put, patch, delete
        // all: ["admin"]     // Covers all operations
        
        // Field-level access control: restrict sensitive fields
        restrictedFields: {
          internalNotes: ["admin"],       // Only admins can read
          costPrice: ["admin", "finance"]  // Admins and finance can read
        }
      },
      
      // Row-level security: inject WHERE conditions automatically
      rowLevelFilter: (req) => `userId = '${req.user.id}'`,
      
      // Security: whitelist allowed $orderby fields
      allowedOrderByFields: ["createdAt", "status", "total"],
      
      // Lifecycle hooks
      beforeRecordGet: async (req) => {
        console.log('Fetching orders for user:', req.user.id);
      },
      
      afterRecordGet: async (req, order) => {
        // Add computed fields
        order.total = calculateTotal(order.items);
        order.canCancel = order.status === 'pending';
        return order;
      },
      
      beforeRecordPost: async (req, order) => {
        // Validate before creation
        order.userId = req.user.id;
        order.createdAt = new Date();
        return order;
      },
      
      afterRecordPost: async (req, order) => {
        // Send notification after creation
        await sendOrderConfirmation(order);
        return order;
      },
      
      beforeRecordPatch: async (req, order) => {
        // Prevent updating certain fields
        delete order.userId;
        delete order.createdAt;
        return order;
      },
      
      afterRecordMutate: async (req, record) => {
        // Audit log after any change
        await logChange(req.user.id, 'orders', record.id);
        return record;
      }
    })
  ]
});
```

### Access Control Patterns

```typescript
// ! If you do not set accessControl, all requests are allowed.

// Public read, authenticated write
accessControl: {
  read: null,  // Anyone can read
  write: []    // Empty array = deny all requests
}

// Role-based access
accessControl: {
  read: ["user", "admin"],
  write: ["admin"]
}

// Different roles for different operations
accessControl: {
  read: ["user", "admin"],
  post: ["user", "admin"],
  patch: ["admin"],
  delete: ["admin"]
}
```

### Lifecycle Hook Chain

```typescript
// Request flow:
beforeRecordGet → Database Query → afterRecordGet → Response

// Mutation flow:
beforeRecordMutate → beforeRecord[Post|Patch|Put|Delete] → 
Database Operation → 
afterRecord[Post|Patch|Put|Delete] → afterRecordMutate → Response
```

---

## Query Syntax & Examples

### System Query Options

#### $filter - Filter Data

```bash
# Equality
?$filter=status eq 'active'
?$filter=age eq 25

# Comparison
?$filter=price gt 100
?$filter=stock le 10

# Logical operators
?$filter=status eq 'active' and price lt 50
?$filter=category eq 'electronics' or category eq 'computers'
?$filter=not (isDeleted eq true)

# String functions
?$filter=startswith(name, 'John')
?$filter=contains(description, 'awesome')
?$filter=endswith(email, '@company.com')

# Date functions
?$filter=year(createdAt) eq 2024
?$filter=month(orderDate) ge 6
?$filter=createdAt gt 2024-01-01

# Complex combinations
?$filter=(status eq 'active' and price lt 100) or (featured eq true)
```

#### $select - Choose Fields

```bash
# Select specific fields
?$select=id,name,email

# Select all fields
?$select=*
```

#### $orderby - Sort Results

```bash
# Single field
?$orderby=name asc
?$orderby=createdAt desc

# Multiple fields
?$orderby=category asc, price desc
```

#### $groupby - Group Results

```bash
# Single field
?$groupby=category

# Multiple fields
?$groupby=category,region

# With filter and orderby
?$filter=status eq 'active'&$groupby=department&$orderby=department asc
```

> [!NOTE]
> `$groupby` is a simplified alternative to OData v4's standard `$apply=groupby(...)`. This library implements the direct parameter syntax for easier usage.

#### $top & $skip - Pagination

```bash
# First page (10 items)
?$top=10&$skip=0

# Second page
?$top=10&$skip=10

# Third page
?$top=10&$skip=20
```

#### $count - Include Total Count

```bash
?$count=true  # Include total count in response
?$count=false # Exclude count (faster)
```

### OData Query → SurQL Translation

Here's how OData queries are transformed into secure SurrealDB queries:

**Input:**
```
$select=id,name&$filter=startswith(name, 'aws-') AND state eq 'offline'
```

**Generated SurQL:**
```surql
-- Count query
SELECT count() 
FROM type::table($table) 
WHERE string::starts_with(type::field($field1), type::string($literal1)) && type::field($field2) = $literal2 
GROUP ALL

-- Data query
SELECT type::field($select0), type::field($select1) 
FROM type::table($table) 
WHERE string::starts_with(type::field($field1), type::string($literal1)) && type::field($field2) = $literal2
```

**Parameters:**
```json
{
  "$table": "cloud_vm",
  "$select0": "id",
  "$select1": "name",
  "$field1": "name",
  "$literal1": "aws-",
  "$field2": "state",
  "$literal2": "offline"
}
```

---

## Security

### Protection Against SQL Injection

This library uses **parameterized queries** for everything -- as much as possible in SurrealDB - table names, field names, and values are all passed as parameters, making SQL injection nearly impossible.

```typescript
// ❌ VULNERABLE (string concatenation):
const query = `SELECT * FROM ${table} WHERE name = '${userInput}'`;

// ✅ SECURE (this library):
const query = {
  sql: "SELECT * FROM type::table($table) WHERE type::field($field) = $value",
  params: { $table: table, $field: 'name', $value: userInput }
};
```

### DoS Protection

Protect your API from denial-of-service attacks with built-in limits:

```typescript
SurrealODataV4Middleware({
  // Prevent excessive data retrieval
  maxPageSize: 500,        // Server-driven paging limit
  maxSkip: 1000000,        // Maximum $skip parameter value
  
  // Prevent expansion attacks
  maxExpandDepth: 5,       // Maximum nested $expand depth
  maxExpandCount: 10,      // Maximum total expanded relations
  
  tables: [/* ... */]
});
```

**What these limits protect against:**
- `maxPageSize`: Caps `$top` and sets default page size when no `$top` is specified
- `maxSkip`: Prevents expensive seek operations on large datasets
- `maxExpandDepth`: Prevents deeply nested expansions like `$expand=A($expand=B($expand=C(...)))`
- `maxExpandCount`: Limits total number of relations that can be expanded

### Row-Level Security

Automatically filter data based on user context with `rowLevelFilter`:

```typescript
new ODataExpressTable({
  table: "documents",
  
  // Automatically inject WHERE clause for all queries
  rowLevelFilter: (req) => {
    // For multi-tenant apps
    return `tenantId = '${req.tenant.id}'`;
    
    // Or for user-specific data
    // return `ownerId = '${req.user.id}'`;
    
    // Or combine multiple conditions
    // return `(ownerId = '${req.user.id}' OR sharedWith CONTAINS '${req.user.id}')`;
  }
})
```

The filter is automatically AND'd with the user's `$filter` query, ensuring users can only access their own data.

### Field-Level Security

Restrict access to sensitive fields with `restrictedFields`:

```typescript
new ODataExpressTable({
  table: "users",
  accessControl: {
    read: ["user", "admin"],
    
    // Field-level restrictions
    restrictedFields: {
      password: ["admin"],           // Only admins can read password hashes
      ssn: ["admin", "hr"],          // Only admin and HR can read SSN
      salary: ["admin", "finance"]   // Only admin and finance can read salary
    }
  }
})
```

Fields not listed are accessible to all users with table read permission. Restricted fields are automatically filtered from `$select` queries for unauthorized users.

### Field Enumeration Protection

Prevent field enumeration attacks with `allowedOrderByFields`:

```typescript
new ODataExpressTable({
  table: "users",
  
  // Only allow ordering by these fields
  allowedOrderByFields: ["createdAt", "name", "email"],
  
  // Attempts to order by other fields (e.g., $orderby=ssn) will be rejected
})
```

This prevents attackers from discovering sensitive field names by trying different `$orderby` values.

### Security Best Practices

1. **Always use role-based access control**
   ```typescript
   accessControl: {
     read: ["user"],
     write: ["admin"]
   }
   ```

2. **Validate in beforeRecord hooks**
   ```typescript
   beforeRecordPost: async (req, record) => {
     if (!isValidEmail(record.email)) {
       throw new Error("Invalid email");
     }
     return record;
   }
   ```

3. **Use row-level filtering for multi-tenant apps**
   ```typescript
   rowLevelFilter: (req) => `tenantId = '${req.tenant.id}'`
   ```

4. **Restrict sensitive fields**
   ```typescript
   accessControl: {
     restrictedFields: {
       password: ["admin"],
       creditCard: ["admin", "finance"]
     }
   }
   ```

5. **Use database-level permissions**
   ```typescript
   resolveDb: async (req) => {
     const db = new Surreal();
     await db.connect(dbUrl);
     await db.signin({
       user: req.user.dbUsername,
       pass: req.user.dbPassword
     });
     return db;
   }
   ```
 > Connections shouldn't be created on-the-fly, but rather be cached for best performance.
---

## API Reference

### `createQuery(queryString, options)`

Parse an OData query string into a structured query object.

```typescript
import { createQuery, SQLLang } from '@dotglitch/odatav4';

const result = createQuery(
  "$filter=age gt 18&$select=name,email",
  { 
    type: SQLLang.SurrealDB,
    maxExpandDepth: 5,      // Optional: Limit $expand nesting
    maxExpandCount: 10,     // Optional: Limit total expansions
    maxPageSize: 500,       // Optional: Limit $top value
    maxSkip: 1000000,       // Optional: Limit $skip value
    maxParameters: 200      // Optional: Limit parameter count
  }
);

// Returns: Visitor object with:
{
  select: string;           // Rendered SELECT clause
  where: string;            // Rendered WHERE clause
  orderby: string;          // Rendered ORDER BY clause
  groupby: string;          // Rendered GROUP BY clause
  limit: number;            // LIMIT value
  skip: number;             // OFFSET value
  count: boolean;           // Whether to include count
  format: string;           // Response format
  parameters: Map<string, any>; // Query parameters
}
```

### `createFilter(filterString, options)`

Parse just the filter portion of an OData query.

```typescript
import { createFilter, SQLLang } from '@dotglitch/odatav4';

const filter = createFilter(
  "age gt 18 and status eq 'active'",
  { type: SQLLang.SurrealDB }
);

console.log(filter.where);      // Filter condition
console.log(filter.parameters); // Parameters
```

### `ODataV4ToSurrealQL(table, queryString)`

Generate complete SurrealDB queries from OData query string.

```typescript
import { ODataV4ToSurrealQL } from '@dotglitch/odatav4';

const {
  countQuery,    // Query to count total results
  entriesQuery,  // Query to fetch data
  parameters     // Parameters for both queries
} = ODataV4ToSurrealQL(
  "users",
  "?$filter=age gt 18&$select=name,email&$top=10"
);

const count = await db.query(countQuery, parameters);
const data = await db.query(entriesQuery, parameters);
```

### `SurrealODataV4Middleware(config)`

Create Express middleware for OData endpoints.

```typescript
import { SurrealODataV4Middleware } from '@dotglitch/odatav4';

const middleware = SurrealODataV4Middleware({
  // Required: Database resolver
  resolveDb: (req) => req.db,
  
  // Required: Table configurations
  tables: [/* ... */],

  // Optional: ID generator
  idGenerator?: (item) => string,
  
  // Optional: Global query variables
  variables?: Record<any, any> | Function,
  
  
  // Optional: DoS protection limits
  maxPageSize?: number,        // Server-driven page size (default: 500)
  maxSkip?: number,            // Maximum $skip value (default: 1000000)
  maxExpandDepth?: number,     // Maximum $expand nesting (default: 5)
  maxExpandCount?: number      // Maximum total expansions (default: 10)
});

app.use('/api/odata', middleware);
```

### `ODataExpressTable<T>`

Define table configuration with type safety.

```typescript
new ODataExpressTable<User>({
  // Required: Table name
  table: string;
  
  // Optional: Custom URI segment (defaults to table name)
  uriSegment?: string;
  
  // Optional: Auto-fetch relations
  fetch?: string | string[];
  
  // Optional: Access control
  accessControl?: {
    read?: string[];           // Roles that can read
    post?: string[];           // Roles that can create
    patch?: string[];          // Roles that can update
    delete?: string[];         // Roles that can delete
    write?: string[];          // Shorthand for post/patch/delete
    all?: string[];            // Shorthand for all operations
    
    // Field-level access control
    restrictedFields?: {
      [fieldName: string]: string[];  // Roles that can read each field
    };
  };
  
  // Optional: Row-level security filter
  rowLevelFilter?: (req) => string;
  
  // Optional: Whitelist for $orderby fields
  allowedOrderByFields?: string[];
  
  // Optional: Metadata for custom use
  tableMetadata?: any;
  
  // Lifecycle hooks
  beforeRecordGet?: (req, record?) => Promise<void>;
  afterRecordGet?: (req, record) => Promise<T>;
  beforeRecordPost?: (req, record) => Promise<T>;
  afterRecordPost?: (req, record) => Promise<T>;
  beforeRecordPatch?: (req, record) => Promise<T>;
  afterRecordPatch?: (req, record) => Promise<T>;
  beforeRecordPut?: (req, record) => Promise<T>;
  afterRecordPut?: (req, record) => Promise<T>;
  beforeRecordDelete?: (req, record) => Promise<T>;
  afterRecordDelete?: (req, record) => Promise<T>;
  beforeRecordMutate?: (req, record) => Promise<T>;
  afterRecordMutate?: (req, record) => Promise<T>;
})
```

---

## Supported OData V4 Features

### Fully Supported ✅

- System Query Options: `$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`, `$format`, `$skiptoken`, `$id`
- Logical Operators: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not`
- Arithmetic Operators: `add`, `sub`, `mul`, `div`, `mod`
- String Functions: `contains`, `startswith`, `endswith`, `length`, `indexof`, `tolower`, `toupper`, `trim`
- Date/Time Functions: `year`, `month`, `day`, `hour`, `minute`, `second`, `now`
- Math Functions: `round`, `floor`, `ceiling`
- Literals: String, Int, Float, Boolean, Null, GUID, Date

### Partial Support ⚠️

- `$search`: Basic support, may not work with all search patterns

### Planned 🔄

- `$expand`: Expand related entities (partial support)
- Lambda operators: `any`, `all`
- Advanced string functions: `substring`, `concat`
- Geo functions: `geo.distance`, `geo.intersects`
- Type functions: `isof`, `cast`

### Not Supported ❌

- `$apply`: Data aggregation (may be added on request)
- `$compute`: Computed properties (may be added on request)

---

## Contributing

Contributions are welcome! This project is actively maintained.

### Areas for Contribution

- Additional SQL dialect support (PostgreSQL, MySQL, etc.)
- Completing `$expand` implementation
- Lambda operator support (`any`, `all`)
- Performance optimizations
- Documentation improvements
- Bug fixes

### Development

```bash
# Clone repository
git clone https://github.com/knackstedt/odatav4.git

# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build
```

---

## License

MIT © Andrew G. Knackstedt

### Credits

This project is a fork and enhancement of:
- [jaystack/odata-v4-sql](https://github.com/jaystack/odata-v4-sql)
- [jaystack/odata-v4-parser](https://github.com/jaystack/odata-v4-parser)

Thanks to the original contributors for their foundational work.

---

## Support

- 📖 [Documentation](https://github.com/knackstedt/odatav4)
- 🐛 [Issue Tracker](https://github.com/knackstedt/odatav4/issues)
- 💬 [Discussions](https://github.com/knackstedt/odatav4/discussions)

---

**Built with ❤️ for developers who want powerful, secure, and flexible APIs**
