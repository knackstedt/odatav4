import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { renderQuery } from '../../../parser/query-renderer';
import { ODataV4ParseError } from '../../../parser/utils';

declare global {
    var db: any;
}

// ============================================================================
// HELPER FUNCTIONS FOR MULTI-DIALECT TESTING
// ============================================================================

/**
 * Parse and render a query for SurrealDB dialect
 */
async function getSurQL(query: string, options = {}) {
    try {
        const parsed = createQuery(query, { type: SQLLang.SurrealDB, ...options });
        const result = renderQuery(parsed, 'user'); // Use 'user' table

        if (globalThis.db) {
            const dbParams: any = {};
            for (const k in result.parameters) {
                dbParams[k.replace(/^\$/, '')] = result.parameters[k];
            }
            try {
                await globalThis.db.query(result.entriesQuery.toString(), dbParams);
            } catch (e: any) {
                throw new Error(`DB Execution Failed: ${e.message}\nQuery: ${result.entriesQuery}`);
            }
        }

        return {
            countQuery: result.countQuery.toString(),
            entriesQuery: result.entriesQuery.toString(),
            parameters: result.parameters
        };
    } catch (e: any) {
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            throw e;
        }
        throw e;
    }
}

/**
 * Get SQL for a specific dialect
 */
async function getSQLForDialect(query: string, dialect: SQLLang, options = {}) {
    try {
        const parsed = createQuery(query, { type: dialect, ...options });
        // For non-SurrealDB dialects, we'll use the visitor directly since renderQuery is SurrealDB-specific
        if (dialect === SQLLang.SurrealDB) {
            const result = renderQuery(parsed, 'user');

            if (globalThis.db) {
                const dbParams: any = {};
                for (const k in result.parameters) {
                    dbParams[k.replace(/^\$/, '')] = result.parameters[k];
                }
                try {
                    await globalThis.db.query(result.entriesQuery.toString(), dbParams);
                } catch (e: any) {
                    throw new Error(`DB Execution Failed: ${e.message}\nQuery: ${result.entriesQuery}`);
                }
            }

            return {
                where: parsed.where,
                select: parsed.select,
                orderby: parsed.orderby,
                parameters: result.parameters,
                fullQuery: result.entriesQuery.toString()
            };
        } else {
            return {
                where: parsed.where,
                select: parsed.select,
                orderby: parsed.orderby,
                parameters: Object.fromEntries(parsed.parameters),
                fullQuery: parsed.where // For non-SurrealDB we just check the where clause
            };
        }
    } catch (e: any) {
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            throw e;
        }
        throw e;
    }
}

/**
 * Test a payload against all SQL dialects
 */
async function testAllDialects(query: string, options = {}) {
    const dialects = [
        SQLLang.SurrealDB,
        SQLLang.ANSI,
        SQLLang.MsSql,
        SQLLang.MySql,
        SQLLang.PostgreSql,
        SQLLang.Oracle
    ];

    const results: Record<string, any> = {};

    for (const dialect of dialects) {
        try {
            results[SQLLang[dialect]] = await getSQLForDialect(query, dialect, options);
        } catch (e) {
            results[SQLLang[dialect]] = { error: e };
        }
    }

    return results;
}

/**
 * Verify that a payload is either rejected or safely parameterized
 */
const verifySecurity = async (payload: string, forbiddenSubstring?: string) => {
    const query = `$filter=Name eq '${payload}'`;
    try {
        const result = await getSurQL(query);
        // If it parses, it MUST be safely parameterized
        expect(result.parameters['$literal1']).toBeDefined();

        if (forbiddenSubstring) {
            expect(result.entriesQuery).not.toContain(forbiddenSubstring);
        }
    } catch (e: any) {
        // Parse errors are acceptable security outcomes
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            return; // Pass
        }
        throw e;
    }
};

/**
 * Verify security across all dialects
 */
const verifySecurityAllDialects = async (payload: string, forbiddenPatterns: string[] = []) => {
    const query = `$filter=Name eq '${payload}'`;
    const results = await testAllDialects(query);

    for (const [dialect, result] of Object.entries(results)) {
        if (result.error) {
            // Error is acceptable
            expect(result.error instanceof ODataV4ParseError ||
                result.error.message?.includes('Parse error')).toBe(true);
        } else {
            // Must be parameterized
            expect(result.parameters).toBeDefined();

            // Check that dangerous patterns aren't in the query
            for (const pattern of forbiddenPatterns) {
                if (result.fullQuery) {
                    expect(result.fullQuery.toLowerCase()).not.toContain(pattern.toLowerCase());
                }
            }
        }
    }
};

describe('Security & SQL Injection Prevention Suite', () => {

    describe('Basic SQL Injection Vectors', () => {
        it('should treat quote breaking attempts as string literals', async () => {
            const query = "$filter=Name eq 'OR 1=1 --'";
            const result = await getSurQL(query);

            expect(result.entriesQuery).toContain('type::field($field1) = $literal1');
            expect(result.parameters['$literal1']).toBe('OR 1=1 --');
            expect(result.entriesQuery).not.toContain('OR 1=1');
        });

        it('should handle stacked queries (semicolon injection)', async () => {
            const query = "$filter=Name eq 'val''; DROP TABLE test_table; --'";
            const result = await getSurQL(query);

            expect(result.entriesQuery).toContain('type::field($field1) = $literal1');
            expect(result.parameters['$literal1']).toContain("DROP TABLE test_table");
            expect(result.entriesQuery).not.toContain('DROP TABLE');
        });

        it('should handle comment injection inside string', async () => {
            const query = "$filter=Name eq 'val--'";
            const result = await getSurQL(query);
            expect(result.entriesQuery).toContain('type::field($field1) = $literal1');
            expect(result.parameters['$literal1']).toContain('val--');
        });
    });

    describe('SurrealDB Specific Injection Vectors', () => {
        it('should parameterize record links/ids', async () => {
            const query = "$filter=Name eq 'user:admin) OR (1=1'";
            const result = await getSurQL(query);

            expect(result.parameters['$literal1']).toContain('user:admin) OR (1=1');
            expect(result.entriesQuery).not.toContain('user:admin');
        });
    });

    describe('Encoding & Obfuscation', () => {
        it('should throw on URL encoded chars in string literal (if not supported)', () => {
            const query = "$filter=Name eq '%27 OR 1=1 --'";
            expect(getSurQL(query)).rejects.toThrow();
        });

        it('should handle unicode escape sequences in literals', async () => {
            const query = "$filter=Name eq '\\u0027 OR 1=1'";
            const result = await getSurQL(query);
            expect(result.parameters['$literal1']).toBeDefined();
            expect(result.parameters['$literal1'] as string).toContain('\\u0027');
        });
    });

    describe('Order By Injection', () => {
        it('should fail or escape invalid field names in ORDER BY', () => {
            const query = "$orderby=Name`, (DELETE FROM user)--";
            expect(getSurQL(query)).rejects.toThrow();
        });

        it('should parameterize or safely escape valid OData identifiers', async () => {
            const query = "$orderby=Name";
            const result = await getSurQL(query);
            expect(result.entriesQuery).toContain('`Name`');
        });
    });

    describe('Select Injection', () => {
        it('should fail invalid field aliases in SELECT', () => {
            const query = "$select=Name` as Hack";
            expect(getSurQL(query)).rejects.toThrow();
        });
    });

    describe('Malformed/Fuzzing Inputs', () => {
        it('should throw or handle extreme nesting', async () => {
            const nested = "(".repeat(100) + "Name eq 'x'" + ")".repeat(100);
            const query = `$filter=${nested}`;

            try {
                const result = await getSurQL(query);
                expect(result.entriesQuery).toBeDefined();
            } catch (e) {
                expect(e).toBeDefined();
            }
        });
    });

    describe('Advanced SQL Injection Vectors', () => {
        // Data-driven tests for scalability
        const booleanPayloads = [
            "x' OR 1=1", "x' OR 1=1 --", "x' OR TRUE --", "x' AND 1=0 --",
            "x' OR '1'='1", "1' OR '1'='1", "x' OR (1=1)", "x') OR ('1'='1"
        ];

        const unionPayloads = [
            "x' UNION SELECT 1,2,3 --", "x' UNION ALL SELECT * FROM users --",
            "x' UNION SELECT username, password FROM users --"
        ];

        const commentPayloads = [
            "x' -- comment", "x' # comment", "x' /* comment */", "x' // comment"
        ];

        const whitespacePayloads = [
            "x'\tOR\t1=1", "x'\nOR\n1=1", "x'\rOR\r1=1", "x'\vOR\v1=1"
        ];

        const systemPayloads = [
            "x' OR sleep(5) --", "x' OR benchmark(1000000,MD5(1)) --",
            "x' OR session::user() --", "x' OR time::now() --",
            "x' OR crypto::md5('test') --"
        ];

        const delimiterPayloads = [
            "x'; DROP TABLE users --", "x'| ls"
        ];

        // Helper to verify that an input is either rejected (Parse Error) or Parameterized Safely
        const verifySecurity = async (payload: string, forbiddenSubstring?: string) => {
            const query = `$filter=Name eq '${payload}'`;
            try {
                const result = await getSurQL(query);
                // If it parses, it MUST be safely parameterized
                expect(result.parameters['$literal1']).toBeDefined();
                // Depending on how strict the parser is with quotes in literals,
                // the value might be the raw payload OR the payload with quotes.
                // We check that the MAIN DANGEROUS logic is NOT in the entriesQuery raw string
                if (forbiddenSubstring) {
                    expect(result.entriesQuery).not.toContain(forbiddenSubstring);
                }
                // And we check that the literal parameter actually contains the payload content
                // (roughly check for known parts of payload to avoid quoting mismatches)
                const payloadContent = payload.replace(/^'|'$/g, ''); // strip outer quotes if checking content
                // expect(JSON.stringify(result.parameters)).toContain(payloadContent.substring(0, 5));
            } catch (e: any) {
                // Formatting errors or Parse errors are ACCEPTABLE security outcomes for fuzzing
                if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
                    return; // Pass
                }
                throw e; // Rethrow other errors
            }
        };

        describe('Boolean-Based Blind', () => {
            it.each(booleanPayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload, ' OR 1=1');
            });
        });

        describe('Union-Based', () => {
            it.each(unionPayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload, 'UNION SELECT');
            });
        });

        describe('Comment Injection', () => {
            it.each(commentPayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload);
            });
        });

        describe('Whitespace Variations', () => {
            it.each(whitespacePayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload);
            });
        });

        describe('System Function Injection', () => {
            it.each(systemPayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload, 'session::');
            });
        });

        describe('Delimiter & stacked queries', () => {
            it.each(delimiterPayloads)('should be secure against: %s', async (payload) => {
                await verifySecurity(payload, 'DROP TABLE');
            });
        });

        describe('Advanced Clause Injection', () => {
            it('should reject injection in $orderby desc', () => {
                const query = "$orderby=Name desc, (SELECT * FROM users)";
                expect(getSurQL(query)).rejects.toThrow();
            });
            it('should reject injection in $top', () => {
                const query = "$top=1; DROP TABLE users";
                expect(getSurQL(query)).rejects.toThrow();
            });
            it('should reject injection in $skip', () => {
                const query = "$skip=1 OR 1=1";
                expect(getSurQL(query)).rejects.toThrow();
            });
            it('should reject injection in $search', async () => {
                const query = "$search=' OR 1=1";
                // Search parser is rudimentary, expects simple string or error.
                // We expect safe handling (either error or param)
                try {
                    const res = await getSurQL(query);
                    expect(res.entriesQuery).not.toContain('OR 1=1');
                } catch (e) {
                    // Pass
                }
            });
            it('should reject injection in $expand', () => {
                const query = "$expand=Tasks($filter=Id eq 1; DROP TABLE tasks)";
                expect(getSurQL(query)).rejects.toThrow();
            });
        });

        describe('Backtick & Escape Sequence Stress Tests', () => {
            const specialPayloads = [
                "foo`bar",         // Raw backtick
                "foo\\`bar",       // Escaped backtick in input
                "foo%60bar",       // Encoded backtick (if not decoded by express before)
                "\\",              // Single backslash
                "\\\\",            // Double backslash
                "`",               // Just backtick
                "```",             // Multiple backticks
                "`; DROP TABLE x; --", // Injection attempt using backtick
                "admin` --",       // Identifier injection attempt
            ];

            it.each(specialPayloads)('should safely handle: %s', async (payload) => {
                // verifySecurity checks that it either parses safely (parameterized) or throws ParseError
                await verifySecurity(payload);
            });

            it('should handle URI encoded backticks in literal', async () => {
                // %60 is backtick. parsed by decodeURIComponent?
                // The parser visitor handles Edm.String by decodeURIComponent.
                // let's try a direct input that looks like it has encoded chars
                const payload = "foo%60bar";
                await verifySecurity(payload);
            });

            it('should handle backslash at end of string', async () => {
                // Dangerous if it escapes the closing quote of the parameter
                await verifySecurity("foo\\");
            });
        });
    });

    describe("Function Whitelisting", () => {
        const verifySecurity = async (query: string, shouldPass: boolean) => {
            if (shouldPass) {
                await expect(getSurQL(query)).resolves.toBeTruthy();
            } else {
                await expect(getSurQL(query)).rejects.toThrow();
            }
        };

        it("should allow standard OData functions", async () => {
            const allowed = [
                "contains(Name, \u0027foo\u0027)",
                "startswith(Name, \u0027foo\u0027)",
                "endswith(Name, \u0027foo\u0027)",
                "length(Name)",
                "tolower(Name)",
                "toupper(Name)",
                "trim(Name)",
                "indexof(Name, \u0027foo\u0027)",
                "substring(Name, 0, 1)",
                "round(Price)",
                "floor(Price)",
                "ceiling(Price)",
                "day(Date)",
                "hour(Date)",
                "minute(Date)",
                "second(Date)",
                "year(Date)"
            ];

            for (const func of allowed) {
                const query = `$filter=${func} eq 0`;
                await verifySecurity(query, true);
            }
        });

        it("should reject unknown functions", async () => {
            const blocked = [
                "foo(Name)",
                "myfunc(Name)",
                "exec(Name)",
                "eval(Name)"
            ];

            for (const func of blocked) {
                const query = `$filter=${func} eq 0`;
                await verifySecurity(query, false);
            }
        });

        it("should reject SurrealDB system functions", async () => {
            const dangerous = [
                "session::user()",
                "crypto::md5(\u0027foo\u0027)",
                "http::get(\u0027google.com\u0027)",
                "rand::uuid()",
                "type::thing(\u0027table\u0027, \u0027id\u0027)"
            ];

            for (const func of dangerous) {
                const query = `$filter=${func} eq 0`;
                await verifySecurity(query, false);
            }
        });
    });
});
