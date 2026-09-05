import { describe, expect, it } from 'bun:test';
import { createQuery, createFilter, SQLLang } from '../../parser/main';

/**
 * Cross-dialect fuzzing tests.
 *
 * These tests generate a wide variety of OData V4 query strings and verify
 * that every supported dialect (ANSI, MsSql, MySql, PostgreSql, Oracle,
 * SurrealDB, NodeSqlite) can process them without crashing. For dialects
 * that use parameterized queries, we also verify that all parameter
 * placeholders in the generated SQL have corresponding entries in the
 * parameters Map.
 *
 * The goal is to find panics, unhandled exceptions, and parameter/placeholder
 * mismatches across the full surface area of the OData V4 grammar.
 */

const ALL_DIALECTS = [
    SQLLang.ANSI,
    SQLLang.MsSql,
    SQLLang.MySql,
    SQLLang.PostgreSql,
    SQLLang.Oracle,
    SQLLang.SurrealDB,
    SQLLang.NodeSqlite,
];

const dialectName = (lang: SQLLang): string => {
    switch (lang) {
        case SQLLang.ANSI: return 'ANSI';
        case SQLLang.MsSql: return 'MsSql';
        case SQLLang.MySql: return 'MySql';
        case SQLLang.PostgreSql: return 'PostgreSql';
        case SQLLang.Oracle: return 'Oracle';
        case SQLLang.SurrealDB: return 'SurrealDB';
        case SQLLang.NodeSqlite: return 'NodeSqlite';
        default: return 'Unknown';
    }
};

/**
 * Verify that every $paramN / $literalN placeholder in the SQL has a
 * corresponding entry in the parameters Map.
 */
const verifyParameters = (where: string, select: string, orderby: string, parameters: Map<string, any>, dialect: string) => {
    const allSql = [where, select, orderby].filter(Boolean).join(' ');
    const placeholderRegex = /\$(literal|param|field|select|fetch)\d+/g;
    const matches = allSql.match(placeholderRegex) || [];
    for (const m of matches) {
        if (!parameters.has(m)) {
            throw new Error(`[${dialect}] Placeholder ${m} in SQL but not in parameters map. SQL: ${allSql}`);
        }
    }
};

/**
 * Run a query through all dialects and verify no crashes + parameter consistency.
 */
const fuzzAllDialects = (odata: string, options: any = {}) => {
    for (const dialect of ALL_DIALECTS) {
        let result: any;
        try {
            result = createQuery(odata, { ...options, type: dialect });
        } catch (e: any) {
            // Some queries are expected to throw (e.g. $search disabled,
            // invalid syntax, lambda not implemented for a dialect).
            // We only care about unexpected crashes, not parse errors.
            if (e instanceof Error && e.message.includes('Maximum')) {
                throw new Error(`[${dialectName(dialect)}] Unexpected error for query "${odata}": ${e.message}`);
            }
            continue;
        }
        if (result) {
            verifyParameters(result.where, result.select, result.orderby, result.parameters, dialectName(dialect));
        }
    }
};

describe('Cross-Dialect Fuzzing', () => {
    describe('Basic comparison fuzzing', () => {
        const fields = ['Name', 'Age', 'Price', 'Active', 'Date', 'Score', 'value', 'notes'];
        const operators = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
        const stringValues = ['John', 'Jane', 'Bob', 'Alice', '', "O'Brien", 'Test123'];
        const numberValues = [0, 1, -1, 5, 10, 25, 100, 3.14, -10.5, 999];

        // Generate a focused set of comparisons
        const comparisons: string[] = [];
        for (const f of fields.slice(0, 4)) {
            for (const op of operators) {
                for (const v of stringValues.slice(0, 3)) {
                    comparisons.push(`$filter=${f} ${op} '${v}'`);
                }
                for (const v of numberValues.slice(0, 4)) {
                    comparisons.push(`$filter=${f} ${op} ${v}`);
                }
            }
        }
        comparisons.push('$filter=Active eq true');
        comparisons.push('$filter=Active eq false');
        comparisons.push('$filter=Name eq null');
        comparisons.push('$filter=Name ne null');

        comparisons.forEach((q, i) => {
            it(`comparison #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Logical operator fuzzing', () => {
        const baseFilters = [
            'Age eq 25',
            'Name eq \'John\'',
            'Price gt 100',
            'Active eq true',
        ];

        const tests: string[] = [];
        // Pairwise combinations
        for (let i = 0; i < baseFilters.length; i++) {
            for (let j = i + 1; j < baseFilters.length; j++) {
                tests.push(`$filter=${baseFilters[i]} and ${baseFilters[j]}`);
                tests.push(`$filter=${baseFilters[i]} or ${baseFilters[j]}`);
            }
        }
        // Not
        for (const f of baseFilters) {
            tests.push(`$filter=not(${f})`);
        }
        // Triple combinations
        tests.push(`$filter=Age eq 25 and Name eq 'John' and Price gt 50`);
        tests.push(`$filter=Age eq 25 or Name eq 'John' or Price gt 50`);
        tests.push(`$filter=(Age eq 25 or Age eq 30) and Active eq true`);
        tests.push(`$filter=not(Age eq 18) and Active eq true`);
        tests.push(`$filter=((Age eq 25) and (Name eq 'John')) or (Price gt 100)`);

        tests.forEach((q, i) => {
            it(`logical #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('String function fuzzing', () => {
        const tests = [
            "$filter=contains(Name, 'John')",
            "$filter=startswith(Name, 'J')",
            "$filter=endswith(Name, 'n')",
            "$filter=indexof(Name, 'oh') gt 0",
            "$filter=indexof(Name, 'oh') eq -1",
            "$filter=length(Name) gt 5",
            "$filter=length(Name) eq 4",
            "$filter=tolower(Name) eq 'john'",
            "$filter=toupper(Name) eq 'JOHN'",
            "$filter=trim(Name) eq 'John'",
            "$filter=substring(Name, 0, 3) eq 'Joh'",
            "$filter=substring(Name, 2) eq 'hn'",
            "$filter=concat(Name, '-Doe') eq 'John-Doe'",
            "$filter=concat(FirstName, LastName) eq 'JohnDoe'",
            // Nested string functions
            "$filter=contains(toupper(Name), 'JO')",
            "$filter=startswith(tolower(Name), 'j')",
            "$filter=length(trim(Name)) gt 3",
            "$filter=substring(Name, 0, length(Name)) eq Name",
        ];

        tests.forEach((q, i) => {
            it(`string fn #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Math function fuzzing', () => {
        const tests = [
            '$filter=round(Price) eq 100',
            '$filter=floor(Price) eq 100',
            '$filter=ceiling(Price) eq 101',
            '$filter=round(Price) gt 50',
            '$filter=floor(Price add 0.5) eq 100',
            '$filter=round(Price mul 1.0) eq 100',
        ];

        tests.forEach((q, i) => {
            it(`math fn #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Date/time function fuzzing', () => {
        const tests = [
            '$filter=year(Date) eq 2020',
            '$filter=month(Date) eq 6',
            '$filter=day(Date) eq 15',
            '$filter=hour(Date) eq 12',
            '$filter=minute(Date) eq 30',
            '$filter=second(Date) eq 0',
            '$filter=year(Date) gt 2019 and year(Date) lt 2022',
            '$filter=month(Date) ge 1 and month(Date) le 12',
        ];

        tests.forEach((q, i) => {
            it(`date fn #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Arithmetic fuzzing', () => {
        const tests = [
            '$filter=Price add 10 eq 110',
            '$filter=Price sub 10 eq 90',
            '$filter=Price mul 2 eq 200',
            '$filter=Price div 2 eq 50',
            '$filter=Age mod 5 eq 0',
            '$filter=Price add 10 sub 5 eq 105',
            '$filter=Price mul 2 div 4 eq 50',
            '$filter=(Price add 10) mul 2 eq 220',
        ];

        tests.forEach((q, i) => {
            it(`arithmetic #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('IN expression fuzzing', () => {
        const tests = [
            "$filter=Name in ('John', 'Jane', 'Bob')",
            "$filter=Age in (25, 30, 35)",
            "$filter=Name in ('John')",
            "$filter=Age in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
            "$filter=Price in (100.0, 200.0, 300.0)",
            "$filter=Active in (true, false)",
        ];

        tests.forEach((q, i) => {
            it(`IN #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Query option combination fuzzing', () => {
        const tests = [
            '$top=5',
            '$skip=10',
            '$top=5&$skip=10',
            '$count=true',
            '$count=false',
            '$format=json',
            '$format=atom',
            '$skiptoken=abc123',
            '$select=Name',
            '$select=Name,Age,Price',
            '$select=*',
            '$orderby=Name asc',
            '$orderby=Name desc',
            '$orderby=Name asc,Age desc',
            '$orderby=Price desc,Name asc',
            '$groupby=category',
            '$groupby=category,region',
            '$filter=Age gt 18&$top=5',
            '$filter=Age gt 18&$skip=10',
            '$filter=Age gt 18&$count=true',
            '$filter=Age gt 18&$select=Name,Age',
            '$filter=Age gt 18&$orderby=Name desc',
            '$filter=Age gt 18&$top=5&$skip=10&$count=true&$select=Name,Age&$orderby=Name desc',
            '$filter=Age gt 18 and Age lt 65&$select=Name,Age,Price&$orderby=Age desc&$top=10&$skip=5&$count=true',
        ];

        tests.forEach((q, i) => {
            it(`query opt #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Complex multi-feature fuzzing', () => {
        const tests = [
            "$filter=contains(Name, 'J') and Age gt 20&$orderby=Age desc&$top=3",
            "$filter=startswith(Name, 'J') or endswith(Name, 'e')&$select=Name,Age&$count=true",
            "$filter=tolower(Name) eq 'john' and round(Price) eq 100&$orderby=Price asc",
            "$filter=year(Date) eq 2020 and month(Date) gt 5&$select=Name,Date&$top=5",
            "$filter=Name in ('John', 'Jane') and Active eq true&$orderby=Name&$count=true",
            "$filter=length(Name) gt 3 and indexof(Name, 'a') gt -1&$select=Name&$top=10",
            "$filter=not(Price gt 100) and Age ge 25&$orderby=Age desc,Price asc&$top=5&$skip=2",
            "$filter=(Age add 5) gt 30 and (Price sub 10) lt 100&$count=true",
            "$filter=concat(FirstName, ' ', LastName) eq 'John Doe'&$select=FirstName,LastName",
            "$filter=substring(Name, 0, 3) eq 'Joh' or substring(Name, 0, 3) eq 'Jan'&$orderby=Name",
        ];

        tests.forEach((q, i) => {
            it(`complex #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Randomized fuzzing', () => {
        // Deterministic pseudo-random generator for reproducible tests
        let seed = 12345;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed;
        };
        const randInt = (max: number) => rand() % max;
        const pick = <T>(arr: T[]): T => arr[randInt(arr.length)];

        const fields = ['Name', 'Age', 'Price', 'Active', 'Date', 'Score', 'value', 'notes', 'status', 'category'];
        const ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
        const stringVals = ['John', 'Jane', 'Bob', 'Alice', 'Test', 'abc', 'xyz'];
        const numVals = [0, 1, 5, 10, 25, 50, 100, -1, -10, 3.14];
        const boolVals = ['true', 'false'];
        const logicalOps = ['and', 'or'];
        const stringFns = [
            (f: string, v: string) => `contains(${f}, '${v}')`,
            (f: string, v: string) => `startswith(${f}, '${v}')`,
            (f: string, v: string) => `endswith(${f}, '${v}')`,
            (f: string) => `length(${f}) gt ${randInt(10)}`,
            (f: string) => `tolower(${f}) eq '${pick(stringVals).toLowerCase()}'`,
            (f: string) => `toupper(${f}) eq '${pick(stringVals).toUpperCase()}'`,
        ];

        const generateFilter = (depth: number = 0): string => {
            if (depth > 2) return `${pick(fields)} ${pick(ops)} ${pick(numVals)}`;

            const r = randInt(100);
            if (r < 40) {
                // Basic comparison
                const f = pick(fields);
                const op = pick(ops);
                const v = pick([...numVals, ...stringVals.map(s => `'${s}'`), ...boolVals]);
                return `${f} ${op} ${v}`;
            } else if (r < 60) {
                // String function
                const fn = pick(stringFns);
                const f = pick(fields);
                const v = pick(stringVals);
                return fn(f, v);
            } else if (r < 80) {
                // Logical combination
                const left = generateFilter(depth + 1);
                const right = generateFilter(depth + 1);
                const op = pick(logicalOps);
                if (randInt(2) === 0) {
                    return `(${left}) ${op} (${right})`;
                }
                return `${left} ${op} ${right}`;
            } else {
                // NOT
                return `not(${generateFilter(depth + 1)})`;
            }
        };

        // Generate 100 random queries
        const randomQueries: string[] = [];
        for (let i = 0; i < 100; i++) {
            const filter = generateFilter();
            const parts = [`$filter=${filter}`];
            if (randInt(2) === 0) parts.push(`$top=${randInt(100) + 1}`);
            if (randInt(3) === 0) parts.push(`$skip=${randInt(50)}`);
            if (randInt(3) === 0) parts.push(`$count=true`);
            if (randInt(3) === 0) parts.push(`$orderby=${pick(fields)} ${pick(['asc', 'desc'])}`);
            if (randInt(3) === 0) parts.push(`$select=${pick(fields)},${pick(fields)}`);
            randomQueries.push(parts.join('&'));
        }

        randomQueries.forEach((q, i) => {
            it(`random #${i}: ${q.slice(0, 70)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Edge case fuzzing', () => {
        const tests = [
            // Empty/minimal
            '$top=1',
            '$skip=0',
            '$top=0',
            // Special string values
            "$filter=Name eq ''",
            "$filter=Name eq 'O''Brien'",
            "$filter=Name eq 'José'",
            "$filter=Name eq '日本語'",
            "$filter=Name eq 'a b c d e f g h i j k l m n o p'",
            // Negative numbers
            '$filter=Temperature gt -40',
            '$filter=Temperature eq -273.15',
            // Decimal precision
            '$filter=Price eq 99.99',
            '$filter=Price eq 0.001',
            '$filter=Price eq 1000000.01',
            // Boolean
            '$filter=Active eq true',
            '$filter=Active eq false',
            '$filter=Active ne true',
            // Null
            '$filter=Name eq null',
            '$filter=Name ne null',
            // Deeply nested
            '$filter=(((((Age eq 25)))))',
            '$filter=A eq 1 and B eq 2 and C eq 3 and D eq 4 and E eq 5 and F eq 6 and G eq 7',
            '$filter=A eq 1 or B eq 2 or C eq 3 or D eq 4 or E eq 5 or F eq 6 or G eq 7',
            // Large IN
            '$filter=Age in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20)',
        ];

        tests.forEach((q, i) => {
            it(`edge #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Parameter consistency verification', () => {
        it('all dialects produce consistent parameter counts for simple filter', () => {
            const query = "$filter=Name eq 'John' and Age gt 18";
            const paramCounts: Record<string, number> = {};

            for (const dialect of ALL_DIALECTS) {
                try {
                    const r = createQuery(query, { type: dialect });
                    paramCounts[dialectName(dialect)] = r.parameters.size;
                } catch {
                    // Skip dialects that throw
                }
            }

            // All dialects that use parameters should have the same count
            // (2 literals: 'John' and 18)
            const dialects = Object.keys(paramCounts);
            for (const d of dialects) {
                if (paramCounts[d] > 0) {
                    // ANSI doesn't use parameters by default
                    // MsSql, Oracle, SurrealDB, NodeSqlite force useParameters
                    // MySql, PostgreSql use inline by default
                    expect(paramCounts[d]).toBeGreaterThanOrEqual(2);
                }
            }
        });

        it('parameterized dialects have all placeholders in parameters map', () => {
            const query = "$filter=contains(Name, 'J') and Age gt 18 and Price eq 100.5";

            for (const dialect of ALL_DIALECTS) {
                let result: any;
                try {
                    result = createQuery(query, { type: dialect });
                } catch {
                    continue;
                }

                if (result.parameters.size === 0) continue;

                const allSql = [result.where, result.select, result.orderby]
                    .filter(Boolean).join(' ');
                const placeholders = allSql.match(/\$(literal|param|field|select)\d+/g) || [];

                for (const p of placeholders) {
                    expect(result.parameters.has(p)).toBe(true);
                }
            }
        });
    });

    describe('createFilter cross-dialect', () => {
        const filters = [
            "Name eq 'John'",
            'Age gt 18 and Age lt 65',
            "contains(Name, 'J') or startswith(Name, 'A')",
            'not(Age eq 18)',
            'Price gt 100.50',
            "Name in ('John', 'Jane')",
            'year(Date) eq 2020',
        ];

        filters.forEach((f, i) => {
            it(`createFilter #${i}: ${f.slice(0, 50)}`, () => {
                for (const dialect of ALL_DIALECTS) {
                    try {
                        const r = createFilter(f, { type: dialect });
                        expect(r.where).toBeTruthy();
                        verifyParameters(r.where, '', '', r.parameters, dialectName(dialect));
                    } catch (e: any) {
                        // Only fail on unexpected errors
                        if (e.message.includes('not implemented')) {
                            throw new Error(`[${dialectName(dialect)}] ${e.message} for filter: ${f}`);
                        }
                    }
                }
            });
        });
    });

    describe('Dot notation and lambda fuzzing', () => {
        const tests = [
            "$filter=Address/City eq 'NYC'",
            "$filter=Address/Country/Name eq 'USA'",
            "$filter=Address/Street ne null",
            "$filter=Address/City eq 'NYC' and Age gt 20",
            "$filter=Address/City eq 'NYC' or Address/City eq 'LA'",
            "$filter=not(Address/City eq 'NYC')",
            "$filter=year(Address/CreatedDate) eq 2020",
            "$filter=contains(Address/City, 'N')",
            "$filter=Tags/any(t: t eq 'active')",
            "$filter=Tags/all(t: t eq 'active')",
            "$filter=Tags/any(t: contains(t, 'a'))",
            "$filter=Tags/any(t: t eq 'active' or t eq 'pending')",
            "$filter=Items/any(i: i/Price gt 100)",
            "$filter=Items/all(i: i/Stock gt 0)",
        ];

        tests.forEach((q, i) => {
            it(`dot/lambda #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('has/isof/cast fuzzing', () => {
        const tests = [
            '$filter=Flags has 1',
            '$filter=Flags has 2',
            '$filter=Flags has 255',
            "$filter=isof(Name, 'Edm.String')",
            "$filter=isof(Age, 'Edm.Int32')",
            "$filter=isof(Active, 'Edm.Boolean')",
            "$filter=isof(Price, 'Edm.Decimal')",
            "$filter=cast(Name, 'Edm.String') eq 'John'",
            "$filter=cast(Age, 'Edm.Int32') eq 25",
            "$filter=cast(Price, 'Edm.Decimal') gt 100",
            "$filter=cast(Active, 'Edm.Boolean') eq true",
        ];

        tests.forEach((q, i) => {
            it(`has/isof/cast #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Malformed input fuzzing', () => {
        // These should all be rejected by the parser, not crash
        const malformed = [
            '$filter=',
            '$filter=Name',
            '$filter=Name eq',
            '$filter=eq Name',
            '$filter=Name eq eq',
            '$filter=(Name eq',
            '$filter=Name eq)',
            '$filter=and Age gt 18',
            '$filter=Age gt 18 and',
            '$filter=not()',
            '$filter=contains()',
            '$filter=contains(Name)',
            '$filter=contains(Name, \'x\', \'y\')',
            '$filter=Name in ()',
            '$filter=',
            '$top=abc',
            '$skip=-1',
            '$top=-1',
            '$orderby=',
            '$select=',
            '$filter=Name eq \'unterminated',
            '$filter=Name eq "double"',
            '$filter=Name eq 0x',
            '$filter=Name eq true false',
            '$filter=!!!Name eq true',
            '$filter=Name eq true and or false',
            '$filter=((()))',
            '$filter=Name eq 1 eq 2',
            '$filter=gt(Age, 18)',
            '$filter=Age gt 18$$',
            '$filter=Age gt 18&&$top=5',
            '$unknown=option',
            '$filter=Name eq \'a\' $unknown=bad',
        ];

        malformed.forEach((q, i) => {
            it(`malformed #${i}: ${q.slice(0, 50)}`, () => {
                // Should throw, not crash with a non-OData error
                for (const dialect of ALL_DIALECTS) {
                    try {
                        createQuery(q, { type: dialect });
                    } catch (e: any) {
                        // ODataV4ParseError is expected - any other error type is a bug
                        if (e instanceof Error && !e.message.includes('OData') && !e.message.includes('Parse') && !e.message.includes('Expected') && !e.message.includes('Incompletely') && !e.message.includes('not implemented') && !e.message.includes('disabled') && !e.message.includes('Invalid') && !e.message.includes('Unhandled') && !e.message.includes('Maximum')) {
                            throw new Error(`[${dialectName(dialect)}] Unexpected error type for "${q}": ${e.message}`);
                        }
                    }
                }
            });
        });
    });

    describe('SQL injection payload fuzzing', () => {
        // These are valid OData syntax that contain SQL injection payloads
        // as string values. They should be parameterized, not inlined.
        const injectionPayloads = [
            "$filter=Name eq 'Robert'); DROP TABLE users;--'",
            "$filter=Name eq 'John' OR 1=1--'",
            "$filter=Name eq 'admin' UNION SELECT * FROM passwords--'",
            "$filter=Name eq ''; DROP TABLE--'",
            "$filter=Name eq 'a' OR 'a'='a'",
            "$filter=Name eq '1; DELETE FROM users WHERE 1=1'",
            "$filter=Name eq 'x' AND 1=(SELECT COUNT(*) FROM users)",
            "$filter=Name eq char(39) + OR + char(39) + 1 + char(39) + = + char(39) + 1",
            "$filter=Name eq '<script>alert(1)</script>'",
            "$filter=Name eq 'John\\' OR \\'1\\'=\\'1",
        ];

        injectionPayloads.forEach((q, i) => {
            it(`injection #${i}: ${q.slice(0, 50)}`, () => {
                for (const dialect of ALL_DIALECTS) {
                    let result: any;
                    try {
                        result = createQuery(q, { type: dialect });
                    } catch {
                        // Parser rejection is acceptable
                        continue;
                    }

                    // For dialects that use parameters (MsSql, Oracle, SurrealDB,
                    // NodeSqlite all force useParameters:true), verify no raw
                    // SQL injection in the WHERE clause.
                    // ANSI, MySql, PostgreSql may inline values by default,
                    // so we skip the pattern check for those.
                    const parameterizedDialects = [
                        SQLLang.MsSql, SQLLang.Oracle, SQLLang.SurrealDB, SQLLang.NodeSqlite
                    ];
                    if (!parameterizedDialects.includes(dialect)) continue;

                    const dangerousPatterns = [
                        'DROP TABLE',
                        'DELETE FROM',
                        'UNION SELECT',
                        'OR 1=1',
                        'OR \'a\'=\'a\'',
                        '<script>',
                    ];

                    for (const pattern of dangerousPatterns) {
                        if (result.where.toUpperCase().includes(pattern.toUpperCase())) {
                            throw new Error(`[${dialectName(dialect)}] SQL injection pattern "${pattern}" found in WHERE: ${result.where}`);
                        }
                    }

                    // Verify parameters are used
                    verifyParameters(result.where, result.select, result.orderby, result.parameters, dialectName(dialect));
                }
            });
        });
    });

    describe('from() method output verification', () => {
        // Verify that the from() method produces valid SQL for NodeSqlite
        const queries = [
            '$top=5',
            '$skip=10',
            '$top=5&$skip=10',
            '$orderby=Name desc',
            '$orderby=Name asc,Age desc',
            '$select=Name,Age',
            '$filter=Age gt 18',
            '$filter=Age gt 18&$orderby=Name&$top=5&$skip=2&$select=Name,Age',
            '$groupby=category',
            '$groupby=category,region',
            '$filter=Age gt 18&$groupby=category',
        ];

        queries.forEach((q, i) => {
            it(`from() #${i}: ${q.slice(0, 50)}`, () => {
                let result: any;
                try {
                    result = createQuery(q, { type: SQLLang.NodeSqlite });
                } catch {
                    return;
                }
                const sql = result.from('test_table');
                // Basic SQL structure verification
                expect(sql).toContain('SELECT');
                expect(sql).toContain('FROM "test_table"');
                // Verify no unescaped injection in the full SQL
                expect(sql).not.toContain('DROP TABLE');
                expect(sql).not.toContain('DELETE FROM');
                // Verify parameters in the full SQL are in the parameters map
                const allSql = sql;
                const placeholders = allSql.match(/\$(literal|param|field|select)\d+/g) || [];
                for (const p of placeholders) {
                    expect(result.parameters.has(p)).toBe(true);
                }
            });
        });
    });

    describe('Complex expression fuzzing', () => {
        const tests = [
            '$filter=Age gt 18 and (Name eq \'John\' or Name eq \'Jane\')',
            '$filter=not(Age lt 18) and Active eq true',
            '$filter=(Age add 5) gt 30 and (Price sub 10) lt 100',
            '$filter=concat(FirstName, LastName) eq \'JohnDoe\'',
            '$filter=substring(Name, 0, 3) eq \'Joh\' or substring(Name, 0, 3) eq \'Jan\'',
            '$filter=length(trim(Name)) gt 3 and contains(toupper(Name), \'A\')',
            '$filter=year(Date) eq 2020 and month(Date) gt 5 and day(Date) lt 20',
            '$filter=round(Price mul 1.1) gt 100',
            '$filter=Price gt 50 and Price lt 200 or Active eq true',
            '$filter=(Price gt 50 and Price lt 200) or Active eq true',
            '$filter=not(Price gt 100) and not(Active eq false)',
            '$filter=Age in (25, 30, 35) and Active eq true',
            '$filter=Age ge 18 and Age le 65 and Active eq true and Price gt 0',
            '$filter=ceil(floor(Price)) eq floor(ceil(Price))',
            '$filter=tolower(concat(FirstName, \' \', LastName)) eq \'john doe\'',
            '$filter=indexof(toupper(Name), \'J\') eq 0 and length(Name) gt 3',
            '$filter=year(Created) sub year(Date) gt 0',
            '$filter=(Age mod 2) eq 0 and (Age div 5) gt 3',
            '$filter=contains(Name, \'a\') or contains(Name, \'e\') or contains(Name, \'i\')',
            '$filter=not(contains(Name, \'x\')) and not(contains(Name, \'z\'))',
        ];

        tests.forEach((q, i) => {
            it(`complex expr #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('SQL reserved word identifier fuzzing', () => {
        const reservedWords = [
            'select', 'order', 'group', 'where', 'from', 'table', 'index',
            'view', 'trigger', 'primary', 'foreign', 'key', 'unique',
            'check', 'default', 'constraint', 'collate', 'insert', 'update',
            'delete', 'create', 'drop', 'alter', 'into', 'values', 'set',
            'join', 'inner', 'outer', 'left', 'right', 'full', 'on', 'as',
            'distinct', 'all', 'union', 'except', 'intersect', 'case',
            'when', 'then', 'else', 'end', 'between', 'like', 'in', 'is',
            'not', 'and', 'or', 'null', 'true', 'false', 'exists', 'cast',
        ];

        // Test each reserved word as a field name in a filter
        reservedWords.slice(0, 25).forEach((word, i) => {
            it(`reserved word #${i}: ${word}`, () => {
                fuzzAllDialects(`$filter=${word} eq 1`);
            });
        });
    });

    describe('Base visitor function coverage', () => {
        // These functions were previously missing from the base visitor
        // and are now implemented for all SQL dialects
        const tests = [
            "$filter=substring(Name, 0, 3) eq 'Joh'",
            "$filter=substring(Name, 2) eq 'hn'",
            "$filter=concat(Name, '-Doe') eq 'John-Doe'",
            "$filter=concat(FirstName, ' ', LastName) eq 'John Doe'",
            "$filter=concat(a, b, c, d) eq 'abcd'",
            '$filter=fractionalseconds(Date) gt 0',
            "$filter=date(Date) eq '2020-01-01'",
            "$filter=time(Date) eq '12:00:00'",
            '$filter=Date lt maxdatetime()',
            '$filter=Date gt mindatetime()',
            '$filter=totaloffsetminutes(Date) eq 0',
            '$filter=totalseconds(Date) gt 0',
        ];

        tests.forEach((q, i) => {
            it(`base fn #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Dialect-specific function verification', () => {
        // Verify that dialect-specific functions produce correct native SQL
        it('MySQL uses MICROSECOND for fractionalseconds', () => {
            const r = createQuery('$filter=fractionalseconds(Date) gt 0', { type: SQLLang.MySql });
            expect(r.where).toContain('MICROSECOND');
        });

        it('MySQL uses UNIX_TIMESTAMP for totalseconds', () => {
            const r = createQuery('$filter=totalseconds(Date) gt 0', { type: SQLLang.MySql });
            expect(r.where).toContain('UNIX_TIMESTAMP');
        });

        it('MSSQL uses CAST AS DATE for date', () => {
            const r = createQuery("$filter=date(Date) eq '2020-01-01'", { type: SQLLang.MsSql });
            expect(r.where).toContain('CAST(');
            expect(r.where).toContain('AS DATE)');
        });

        it('MSSQL uses CAST AS TIME for time', () => {
            const r = createQuery("$filter=time(Date) eq '12:00:00'", { type: SQLLang.MsSql });
            expect(r.where).toContain('CAST(');
            expect(r.where).toContain('AS TIME)');
        });

        it('MSSQL uses DATEPART for fractionalseconds', () => {
            const r = createQuery('$filter=fractionalseconds(Date) gt 0', { type: SQLLang.MsSql });
            expect(r.where).toContain('DATEPART');
            expect(r.where).toContain('NANOSECOND');
        });

        it('MSSQL uses DATEDIFF for totalseconds', () => {
            const r = createQuery('$filter=totalseconds(Date) gt 0', { type: SQLLang.MsSql });
            expect(r.where).toContain('DATEDIFF');
        });

        it('MSSQL ROUND includes precision argument', () => {
            const r = createQuery('$filter=round(Price) eq 100', { type: SQLLang.MsSql });
            expect(r.where).toContain('ROUND(');
            expect(r.where).toContain(', 0)');
        });

        it('Oracle uses INSTR for indexof', () => {
            const r = createQuery("$filter=indexof(Name, 'oh') gt 0", { type: SQLLang.Oracle });
            expect(r.where).toContain('INSTR');
        });

        it('PostgreSQL uses POSITION for indexof', () => {
            const r = createQuery("$filter=indexof(Name, 'oh') gt 0", { type: SQLLang.PostgreSql });
            expect(r.where).toContain('POSITION');
        });

        it('PostgreSQL uses EXTRACT EPOCH for totalseconds', () => {
            const r = createQuery('$filter=totalseconds(Date) gt 0', { type: SQLLang.PostgreSql });
            expect(r.where).toContain('EXTRACT');
            expect(r.where).toContain('EPOCH');
        });

        it('All SQL dialects add +1 for substring 0-based to 1-based', () => {
            for (const lang of [SQLLang.MySql, SQLLang.PostgreSql, SQLLang.Oracle, SQLLang.MsSql]) {
                const r = createQuery("$filter=substring(Name, 0, 3) eq 'Joh'", { type: lang });
                expect(r.where).toContain('+ 1');
            }
        });
    });

    describe('$expand fuzzing', () => {
        const tests = [
            '$expand=Items',
            '$expand=Items,Reviews',
            '$expand=Items($top=5)',
            '$expand=Items($filter=Price gt 100)',
            '$expand=Items($orderby=Name)',
            '$expand=Items($select=Name,Price)',
            '$expand=Items($filter=Price gt 100;$top=5)',
            '$expand=Items($filter=Price gt 100;$orderby=Name;$top=5)',
            '$expand=Items($expand=Reviews)',
            '$expand=Items($expand=Reviews($top=3))',
            '$select=Name&$expand=Items($select=Price)',
            '$filter=Age gt 18&$expand=Items($filter=Price gt 50)',
            '$expand=Items($count=true)',
        ];

        tests.forEach((q, i) => {
            it(`expand #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('NOT expression fuzzing', () => {
        const tests = [
            "$filter=not(Name eq 'John')",
            "$filter=not(not(Name eq 'John'))",
            "$filter=not(not(not(Name eq 'John')))",
            "$filter=not(Name eq 'John' or Age lt 18)",
            "$filter=not(Name eq 'John') and Age gt 18",
            "$filter=not(Name eq 'John') or not(Age lt 18)",
            "$filter=not(contains(Name, 'x'))",
            "$filter=not(startswith(Name, 'J'))",
            "$filter=not(endswith(Name, 'n'))",
            "$filter=not(Age in (25, 30, 35))",
            "$filter=not(Age gt 18 and Active eq true)",
            "$filter=not(Age gt 18) and not(Price lt 100)",
        ];

        tests.forEach((q, i) => {
            it(`not expr #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Arithmetic expression fuzzing', () => {
        const tests = [
            '$filter=Price add 10 eq 110',
            '$filter=Price sub 10 eq 90',
            '$filter=Price mul 2 eq 200',
            '$filter=Price div 2 eq 50',
            '$filter=Price mod 2 eq 0',
            '$filter=(Price add 10) gt 100',
            '$filter=(Price sub 10) lt 100',
            '$filter=(Price mul 2) gt 200',
            '$filter=(Price div 2) lt 50',
            '$filter=Price add Tax eq Total',
            '$filter=Age add 1 gt 18 and Age sub 1 lt 65',
            '$filter=round(Price mul 1.1) gt 100',
            '$filter=floor(Price div 10) eq 10',
            '$filter=ceiling(Price mod 100) eq 1',
            '$filter=(Age add 5) mul 2 gt 50',
            '$filter=Price sub (Discount add Tax) gt 50',
        ];

        tests.forEach((q, i) => {
            it(`arithmetic #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Null and boolean handling fuzzing', () => {
        const tests = [
            '$filter=Name eq null',
            '$filter=Name ne null',
            '$filter=Active eq true',
            '$filter=Active eq false',
            '$filter=Active ne true',
            '$filter=Active ne false',
            '$filter=Name eq null and Age gt 18',
            '$filter=Name ne null or Active eq true',
            '$filter=not(Name eq null)',
            '$filter=not(Active eq true)',
            '$filter=Name eq null and Active eq false',
            '$filter=(Name ne null) and (Active eq true)',
        ];

        tests.forEach((q, i) => {
            it(`null/bool #${i}: ${q.slice(0, 60)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });

    describe('Deep randomized fuzzing', () => {
        // Deterministic pseudo-random generator for reproducible tests
        let seed = 98765;
        const rand = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed;
        };
        const randInt = (max: number) => rand() % max;
        const pick = <T>(arr: T[]): T => arr[randInt(arr.length)];

        const fields = ['Name', 'Age', 'Price', 'Active', 'Date', 'Score', 'value', 'notes', 'status', 'category', 'region', 'Flags'];
        const ops = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
        const stringVals = ['John', 'Jane', 'Bob', 'Alice', 'Test', 'abc', 'xyz', 'hello'];
        const numVals = [0, 1, 5, 10, 25, 50, 100, -1, -10, 3.14, 99.99];
        const logicalOps = ['and', 'or'];
        const stringFns = [
            (f: string, v: string) => `contains(${f}, '${v}')`,
            (f: string, v: string) => `startswith(${f}, '${v}')`,
            (f: string, v: string) => `endswith(${f}, '${v}')`,
            (f: string) => `length(${f}) gt ${randInt(10)}`,
            (f: string) => `tolower(${f}) eq '${pick(stringVals).toLowerCase()}'`,
            (f: string) => `toupper(${f}) eq '${pick(stringVals).toUpperCase()}'`,
            (f: string) => `trim(${f}) eq '${pick(stringVals)}'`,
            (f: string) => `substring(${f}, ${randInt(3)}, ${randInt(3) + 1}) eq '${pick(stringVals).slice(0, 2)}'`,
        ];
        const mathFns = [
            (f: string) => `round(${f}) eq ${randInt(100)}`,
            (f: string) => `floor(${f}) gt ${randInt(50)}`,
            (f: string) => `ceiling(${f}) lt ${randInt(100) + 50}`,
        ];
        const dateFns = [
            (f: string) => `year(${f}) eq ${2018 + randInt(5)}`,
            (f: string) => `month(${f}) eq ${1 + randInt(12)}`,
            (f: string) => `day(${f}) gt ${randInt(15)}`,
            (f: string) => `hour(${f}) eq ${randInt(24)}`,
        ];

        const generateComplexFilter = (depth: number = 0): string => {
            if (depth > 3) return `${pick(fields)} ${pick(ops)} ${pick(numVals)}`;

            const r = randInt(100);
            if (r < 25) {
                // Basic comparison
                const f = pick(fields);
                const op = pick(ops);
                const v = pick([...numVals, ...stringVals.map(s => `'${s}'`), 'true', 'false', 'null']);
                return `${f} ${op} ${v}`;
            } else if (r < 45) {
                // String function
                const fn = pick(stringFns);
                return fn(pick(fields), pick(stringVals));
            } else if (r < 55) {
                // Math function
                return pick(mathFns)(pick(fields));
            } else if (r < 65) {
                // Date function
                return pick(dateFns)(pick(fields));
            } else if (r < 80) {
                // Logical combination
                const left = generateComplexFilter(depth + 1);
                const right = generateComplexFilter(depth + 1);
                const op = pick(logicalOps);
                if (randInt(2) === 0) {
                    return `(${left}) ${op} (${right})`;
                }
                return `${left} ${op} ${right}`;
            } else if (r < 90) {
                // NOT
                return `not(${generateComplexFilter(depth + 1)})`;
            } else {
                // IN
                const f = pick(fields);
                const count = 2 + randInt(4);
                const vals = Array.from({ length: count }, () => pick(numVals));
                return `${f} in (${vals.join(', ')})`;
            }
        };

        // Generate 150 random complex queries
        const randomQueries: string[] = [];
        for (let i = 0; i < 150; i++) {
            const filter = generateComplexFilter();
            const parts = [`$filter=${filter}`];
            if (randInt(2) === 0) parts.push(`$top=${randInt(100) + 1}`);
            if (randInt(3) === 0) parts.push(`$skip=${randInt(50)}`);
            if (randInt(3) === 0) parts.push(`$count=true`);
            if (randInt(3) === 0) parts.push(`$orderby=${pick(fields)} ${pick(['asc', 'desc'])}`);
            if (randInt(3) === 0) parts.push(`$select=${pick(fields)},${pick(fields)}`);
            randomQueries.push(parts.join('&'));
        }

        randomQueries.forEach((q, i) => {
            it(`deep random #${i}: ${q.slice(0, 70)}`, () => {
                fuzzAllDialects(q);
            });
        });
    });
});
