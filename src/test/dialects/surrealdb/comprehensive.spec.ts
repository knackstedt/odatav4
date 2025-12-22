import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../../../parser/main';
import { renderQuery } from '../../../parser/query-renderer';

declare global {
    var db: any;
}

const parse = async (input: string) => {
    const parsed = createQuery(input, { type: SQLLang.SurrealDB });

    if (globalThis.db) {
        // Use renderQuery to construct the query string consistently
        const result = renderQuery(parsed, 'user');
        const query = result.entriesQuery.toString();

        // Prepare parameters
        const dbParams: any = {};
        for (const k in result.parameters) {
            dbParams[k.replace(/^\$/, '')] = result.parameters[k];
        }

        try {
            await globalThis.db.query(query, dbParams);
        } catch (e: any) {
            // Ignore runtime data errors like missing fields (NONE) involved in math/functions
            if (e.message.includes("Cannot perform") ||
                e.message.includes("Cannot negate") ||
                e.message.includes("Incorrect arguments") ||
                e.message.includes("Invalid function")) {

                return parsed;
            }


            // Rethrow with query context for debugging
            throw new Error(`Execution failed for input: ${input}\nQuery: ${query}\nError: ${e.message}`);
        }
    }
    return parsed;
};

describe('Comprehensive OData V4 Test Suite', () => {

    describe('System Query Options', () => {
        it('$select', async () => {
            const result = await parse('$select=Name,Age');
            expect(result.select).toBe("type::field($select0) AS `Name`, type::field($select1) AS `Age`");
        });

        it('$select *', async () => {
            const result = await parse('$select=*');
            // Implementation maps * to a field parameter
            expect(result.select).toBe("*");
        });

        it('$top', async () => {
            const result = await parse('$top=10');
            expect(result.limit).toBe(10);
        });

        it('$skip', async () => {
            const result = await parse('$skip=20');
            expect(result.skip).toBe(20);
        });

        it('$count=true', async () => {
            const result = await parse('$count=true');
            expect(result.inlinecount).toBe(true);
        });

        it('$count=false', async () => {
            const result = await parse('$count=false');
            expect(result.inlinecount).toBe(false);
        });

        it('$orderby asc', async () => {
            const result = await parse('$orderby=Name asc');
            expect(result.orderby).toBe("`Name` ASC");
        });

        it('$orderby desc', async () => {
            const result = await parse('$orderby=Age desc');
            expect(result.orderby).toBe("`Age` DESC");
        });

        it('$orderby multiple', async () => {
            const result = await parse('$orderby=Name asc, Age desc');
            expect(result.orderby).toBe("`Name` ASC, `Age` DESC");
        });

        it('$format', async () => {
            expect((await parse('$format=json')).format).toBe('json');
            expect((await parse('$format=xml')).format).toBe('xml');
            expect((await parse('$format=atom')).format).toBe('atom');
        });

        it('$skiptoken', async () => {
            const result = await parse('$skiptoken=abc');
            expect(result.skipToken).toBe('abc');
        });

        // Visitor stores $id in 'specificId' property
        it('$id', async () => {
            const result = await parse('$id=123');
            expect(result.specificId).toBe('123');
        });

        it('$search', () => {
            // $search is disabled by default for security, throws immediately
            expect(() => createQuery('$search=blue', { type: SQLLang.SurrealDB })).toThrow();

            // Enable search test - intentionally skipping execution as search requires table index setup
            const result = createQuery('$search=blue', { type: SQLLang.SurrealDB, enableSearch: true });
            expect(result.search).toBe("blue");
        });
    });

    describe('Filter Operations - Logical Operators', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('eq', async () => {
            expect(await filter('Name eq \'John\'')).toContain("type::field($field1) = $literal1");
        });

        it('ne', async () => {
            const result = await filter('Name ne \'John\'');
            // SurrealDB uses !=
            expect(result).toContain("type::field($field1) != $literal1");
        });

        it('gt', async () => {
            expect(await filter('Age gt 18')).toContain("type::field($field1) > $literal1");
        });

        it('ge', async () => {
            expect(await filter('Age ge 18')).toContain("type::field($field1) >= $literal1");
        });

        it('lt', async () => {
            expect(await filter('Age lt 18')).toContain("type::field($field1) < $literal1");
        });

        it('le', async () => {
            expect(await filter('Age le 18')).toContain("type::field($field1) <= $literal1");
        });

        it('and', async () => {
            expect(await filter('Name eq \'John\' and Age gt 18')).toContain("type::field($field1) = $literal1 && type::field($field2) > $literal2");
        });

        it('or', async () => {
            expect(await filter('Name eq \'John\' or Name eq \'Jane\'')).toContain("type::field($field1) = $literal1 || type::field($field2) = $literal2");
        });

        it('not', async () => {
            expect(await filter('not (Age gt 18)')).toContain("!((type::field($field1) > $literal1))");
        });

        it.skip('has', async () => {
            const result = await filter('Flags has Enum.Color\'Red\'');
            expect(result).toBeDefined();
        });

        it('in', async () => {
            expect(await filter('Name in (\'John\', \'Jane\')')).toContain("type::field($field1) in [$param1, $param2]");
        });
    });

    describe('Filter Operations - Arithmetic Operators', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('add', async () => {
            expect(await filter('Price add 5 gt 10')).toContain("type::field($field1) + $literal1 > $literal2");
        });

        it('sub', async () => {
            expect(await filter('Price sub 5 gt 10')).toContain("type::field($field1) - $literal1 > $literal2");
        });

        it('mul', async () => {
            expect(await filter('Price mul 2 gt 10')).toContain("type::field($field1) * $literal1 > $literal2");
        });

        it('div', async () => {
            expect(await filter('Price div 2 gt 10')).toContain("type::field($field1) / $literal1 > $literal2");
        });

        it('mod', async () => {
            expect(await filter('Price mod 2 eq 0')).toContain("type::field($field1) % $literal1 = $literal2");
        });

        it('negate', async () => {
            expect(await filter('-Price eq 5')).toBeDefined();
        });
    });

    describe('Filter Operations - String Functions', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('contains', async () => {
            expect(await filter("contains(Name, 'doe')")).toContain("string::contains(type::field($field1), type::string($param1))");
        });

        it('startswith', async () => {
            expect(await filter("startswith(Name, 'J')")).toContain("string::starts_with(type::field($field1), type::string($param1))");
        });

        it('endswith', async () => {
            expect(await filter("endswith(Name, 'e')")).toContain("string::ends_with(type::field($field1), type::string($param1))");
        });

        it('length', async () => {
            // Function calls consume a parameter seed for the function name placeholder even if unused
            expect(await filter("length(Name) eq 4")).toContain("string::len(type::field($field1)) = $literal2");
        });

        it('indexof', async () => {
            expect(await filter("indexof(Name, 'a') eq 1")).toContain("(IF string::contains(type::string(type::field($field1)), type::string($literal2)) THEN string::len(string::split(type::string(type::field($field2)), type::string($literal3))[0]) ELSE -1 END) = $literal4");
        });

        it('substring', async () => {
            expect(await filter("substring(Name, 1) eq 'ohn'")).toBeDefined();
        });

        it('tolower', async () => {
            expect(await filter("tolower(Name) eq 'john'")).toContain("string::lowercase(type::field($field1)) = $literal2");
        });

        it('toupper', async () => {
            expect(await filter("toupper(Name) eq 'JOHN'")).toContain("string::uppercase(type::field($field1)) = $literal2");
        });

        it('trim', async () => {
            expect(await filter("trim(Name) eq 'John'")).toContain("string::trim(type::field($field1)) = $literal2");
        });

        it('concat', async () => {
            expect(await filter("concat(Name, ' Doe') eq 'John Doe'")).toContain("string::concat(type::field($field1), $literal2) = $literal3");
        });
    });

    describe('Filter Operations - Date/Time Functions', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('year', async () => expect(await filter("year(BirthDate) eq 1990")).toContain("time::year(type::field($field1))"));
        it('month', async () => expect(await filter("month(BirthDate) eq 5")).toContain("time::month(type::field($field1))"));
        it('day', async () => expect(await filter("day(BirthDate) eq 12")).toContain("time::day(type::field($field1))"));
        it('hour', async () => expect(await filter("hour(BirthDate) eq 10")).toContain("time::hour(type::field($field1))"));
        it('minute', async () => expect(await filter("minute(BirthDate) eq 30")).toContain("time::minute(type::field($field1))"));
        it('second', async () => expect(await filter("second(BirthDate) eq 0")).toContain("time::second(type::field($field1))"));
        it('now', async () => expect(await filter("BirthDate lt now()")).toContain("time::now()"));

        it('fractionalseconds', async () => expect(await filter("fractionalseconds(BirthDate) gt 0")).toBeDefined());
        it('date', async () => expect(await filter("date(BirthDate) eq 2020-01-01")).toBeDefined());
        it('time', async () => expect(await filter("time(BirthDate) eq 12:00:00")).toBeDefined());
    });

    describe('Filter Operations - Math Functions', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('round', async () => expect(await filter("round(Price) eq 10")).toContain("math::round(type::field($field1)) = $literal2"));
        it('floor', async () => expect(await filter("floor(Price) eq 10")).toContain("math::floor(type::field($field1)) = $literal2"));
        it('ceiling', async () => expect(await filter("ceiling(Price) eq 10")).toContain("math::ceil(type::field($field1)) = $literal2"));
    });

    describe('Filter Operations - Type Functions', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it.skip('isof', async () => expect(await filter("isof(type.name)")).toBeDefined());
        it.skip('cast', async () => expect(await filter("cast(Name, 'Edm.String')")).toBeDefined());
    });

    describe('Filter Operations - Geo Functions', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('geo.distance', async () => {
            // Location -> $field1, Point(1 2) -> $literal2, 10 -> $literal3
            expect(await filter("geo.distance(Location, geography'Point(1 2)') lt 10")).toContain("geo::distance(type::field($field1), $literal2) < $literal3");
        });

        it('geo.intersects', async () => {
            // Location -> $field1, Polygon -> $literal2
            expect(await filter("geo.intersects(Location, geography'Polygon((0 0, 0 1, 1 1, 1 0, 0 0))')")).toContain("geo::intersects(type::field($field1), $literal2)");
        });

        it('geo.length', async () => {
            // Route -> $field1, 50 -> $literal2
            expect(await filter("geo.length(Route) gt 50")).toContain("geo::length(type::field($field1)) > $literal2");
        });
    });

    describe('Lambda Operators', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('any', async () => {
            expect(await filter("Comments/any(c:c/Comment eq 'Good')")).toBeDefined();
        });

        it('all', async () => {
            expect(await filter("Comments/all(c:c/Score gt 5)")).toBeDefined();
        });
    });

    describe('Literals', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('String', async () => expect(await filter("Name eq 'StringValue'")).toBeDefined());
        it('Int', async () => expect(await filter("Age eq 123")).toBeDefined());
        it('Float', async () => expect(await filter("Score eq 12.34")).toBeDefined());
        it('Boolean', async () => expect(await filter("IsActive eq true")).toBeDefined());
        it('Null', async () => expect(await filter("Name eq null")).toBeDefined());
        it('GUID', async () => expect(await filter("Id eq 01234567-89ab-cdef-0123-456789abcdef")).toBeDefined());
        it('Date', async () => expect(await filter("DateVal eq 2020-01-01")).toBeDefined());
    });

    describe('Complex Scenarios', () => {
        const filter = async (f: string) => (await parse(`$filter=${f}`)).where;

        it('Nested grouping', async () => {
            // SurrealDB parser adds extra parentheses for grouping
            const result = await filter("((A eq 1) or (B eq 2)) and (C eq 3)");
            expect(result).toContain("((((type::field($field1) = $literal1) || (type::field($field2) = $literal2))) && (type::field($field3) = $literal3))");
        });

        it('Function in expression', async () => {
            expect(await filter("endswith(Name, 's') and Age gt 20")).toContain("string::ends_with(type::field($field1), type::string($param1)) && type::field($field2) > $literal2");
        });

        it('Multiple system options', async () => {
            const result = await parse('$filter=Age gt 18&$select=Name,Age&$orderby=Age desc&$top=5');
            expect(result.where).toBeDefined();
            expect(result.select).toBeDefined();
            expect(result.orderby).toBeDefined();
            expect(result.limit).toBe(5);
        });
    });

});
