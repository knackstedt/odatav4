import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
};

describe('Comprehensive OData V4 Test Suite', () => {

    describe('System Query Options', () => {
        it('$select', () => {
            const result = parse('$select=Name,Age');
            expect(result.select).toBe("type::field($select0) AS `Name`, type::field($select1) AS `Age`");
        });

        it('$select *', () => {
            const result = parse('$select=*');
            // Implementation maps * to a field parameter
            expect(result.select).toBe("*");
        });

        it('$top', () => {
            const result = parse('$top=10');
            expect(result.limit).toBe(10);
        });

        it('$skip', () => {
            const result = parse('$skip=20');
            expect(result.skip).toBe(20);
        });

        it('$count=true', () => {
            const result = parse('$count=true');
            expect(result.inlinecount).toBe(true);
        });

        it('$count=false', () => {
            const result = parse('$count=false');
            expect(result.inlinecount).toBe(false);
        });

        it('$orderby asc', () => {
            const result = parse('$orderby=Name asc');
            expect(result.orderby).toBe("`Name` ASC");
        });

        it('$orderby desc', () => {
            const result = parse('$orderby=Age desc');
            expect(result.orderby).toBe("`Age` DESC");
        });

        it('$orderby multiple', () => {
            const result = parse('$orderby=Name asc, Age desc');
            expect(result.orderby).toBe("`Name` ASC, `Age` DESC");
        });

        it('$format', () => {
            expect(parse('$format=json').format).toBe('json');
            expect(parse('$format=xml').format).toBe('xml');
            expect(parse('$format=atom').format).toBe('atom');
        });

        it('$skiptoken', () => {
            const result = parse('$skiptoken=abc');
            expect(result.skipToken).toBe('abc');
        });

        // Visitor stores $id in 'specificId' property
        it('$id', () => {
            const result = parse('$id=123');
            expect(result.specificId).toBe('123');
        });

        it('$search', () => {
            // $search is disabled by default for security
            expect(() => createQuery('$search=blue', { type: SQLLang.SurrealDB })).toThrow();

            // Enable search to test functionality
            const result = createQuery('$search=blue', { type: SQLLang.SurrealDB, enableSearch: true });
            expect(result.search).toBe("blue");
        });
    });

    describe('Filter Operations - Logical Operators', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('eq', () => {
            expect(filter('Name eq \'John\'')).toContain("type::field($field1) = $literal1");
        });

        it('ne', () => {
            const result = filter('Name ne \'John\'');
            // SurrealDB uses !=
            expect(result).toContain("type::field($field1) != $literal1");
        });

        it('gt', () => {
            expect(filter('Age gt 18')).toContain("type::field($field1) > $literal1");
        });

        it('ge', () => {
            expect(filter('Age ge 18')).toContain("type::field($field1) >= $literal1");
        });

        it('lt', () => {
            expect(filter('Age lt 18')).toContain("type::field($field1) < $literal1");
        });

        it('le', () => {
            expect(filter('Age le 18')).toContain("type::field($field1) <= $literal1");
        });

        it('and', () => {
            expect(filter('Name eq \'John\' and Age gt 18')).toContain("type::field($field1) = $literal1 && type::field($field2) > $literal2");
        });

        it('or', () => {
            expect(filter('Name eq \'John\' or Name eq \'Jane\'')).toContain("type::field($field1) = $literal1 || type::field($field2) = $literal2");
        });

        it('not', () => {
            expect(filter('not (Age gt 18)')).toContain("!((type::field($field1) > $literal1))");
        });

        it.skip('has', () => {
            const result = filter('Flags has Enum.Color\'Red\'');
            expect(result).toBeDefined();
        });

        it('in', () => {
            expect(filter('Name in (\'John\', \'Jane\')')).toContain("type::field($field1) in [$param1, $param2]");
        });
    });

    describe('Filter Operations - Arithmetic Operators', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('add', () => {
            expect(filter('Price add 5 gt 10')).toContain("type::field($field1) + $literal1 > $literal2");
        });

        it('sub', () => {
            expect(filter('Price sub 5 gt 10')).toContain("type::field($field1) - $literal1 > $literal2");
        });

        it('mul', () => {
            expect(filter('Price mul 2 gt 10')).toContain("type::field($field1) * $literal1 > $literal2");
        });

        it('div', () => {
            expect(filter('Price div 2 gt 10')).toContain("type::field($field1) / $literal1 > $literal2");
        });

        it('mod', () => {
            expect(filter('Price mod 2 eq 0')).toContain("type::field($field1) % $literal1 = $literal2");
        });

        it('negate', () => {
            expect(filter('-Price eq 5')).toBeDefined();
        });
    });

    describe('Filter Operations - String Functions', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('contains', () => {
            expect(filter("contains(Name, 'doe')")).toContain("string::contains(type::field($field1), type::string($param1))");
        });

        it('startswith', () => {
            expect(filter("startswith(Name, 'J')")).toContain("string::starts_with(type::field($field1), type::string($param1))");
        });

        it('endswith', () => {
            expect(filter("endswith(Name, 'e')")).toContain("string::ends_with(type::field($field1), type::string($param1))");
        });

        it('length', () => {
            // Function calls consume a parameter seed for the function name placeholder even if unused
            expect(filter("length(Name) eq 4")).toContain("string::len(type::field($field1)) = $literal2");
        });

        it('indexof', () => {
            expect(filter("indexof(Name, 'a') eq 1")).toContain("(IF string::contains(type::string(type::field($field1)), type::string($literal2)) THEN string::len(string::split(type::string(type::field($field2)), type::string($literal3))[0]) ELSE -1 END) = $literal4");
        });

        it('substring', () => {
            expect(filter("substring(Name, 1) eq 'ohn'")).toBeDefined();
        });

        it('tolower', () => {
            expect(filter("tolower(Name) eq 'john'")).toContain("string::lowercase(type::field($field1)) = $literal2");
        });

        it('toupper', () => {
            expect(filter("toupper(Name) eq 'JOHN'")).toContain("string::uppercase(type::field($field1)) = $literal2");
        });

        it('trim', () => {
            expect(filter("trim(Name) eq 'John'")).toContain("string::trim(type::field($field1)) = $literal2");
        });

        it('concat', () => {
            expect(filter("concat(Name, ' Doe') eq 'John Doe'")).toContain("string::concat(type::field($field1), $literal2) = $literal3");
        });
    });

    describe('Filter Operations - Date/Time Functions', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('year', () => expect(filter("year(BirthDate) eq 1990")).toContain("time::year(type::field($field1))"));
        it('month', () => expect(filter("month(BirthDate) eq 5")).toContain("time::month(type::field($field1))"));
        it('day', () => expect(filter("day(BirthDate) eq 12")).toContain("time::day(type::field($field1))"));
        it('hour', () => expect(filter("hour(BirthDate) eq 10")).toContain("time::hour(type::field($field1))"));
        it('minute', () => expect(filter("minute(BirthDate) eq 30")).toContain("time::minute(type::field($field1))"));
        it('second', () => expect(filter("second(BirthDate) eq 0")).toContain("time::second(type::field($field1))"));
        it('now', () => expect(filter("BirthDate lt now()")).toContain("time::now()"));

        it('fractionalseconds', () => expect(filter("fractionalseconds(BirthDate) gt 0")).toBeDefined());
        it('date', () => expect(filter("date(BirthDate) eq 2020-01-01")).toBeDefined());
        it('time', () => expect(filter("time(BirthDate) eq 12:00:00")).toBeDefined());
    });

    describe('Filter Operations - Math Functions', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('round', () => expect(filter("round(Price) eq 10")).toContain("math::round(type::field($field1)) = $literal2"));
        it('floor', () => expect(filter("floor(Price) eq 10")).toContain("math::floor(type::field($field1)) = $literal2"));
        it('ceiling', () => expect(filter("ceiling(Price) eq 10")).toContain("math::ceil(type::field($field1)) = $literal2"));
    });

    describe('Filter Operations - Type Functions', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it.skip('isof', () => expect(filter("isof(type.name)")).toBeDefined());
        it.skip('cast', () => expect(filter("cast(Name, 'Edm.String')")).toBeDefined());
    });

    describe('Filter Operations - Geo Functions', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('geo.distance', () => {
            // Location -> $field1, Point(1 2) -> $literal2, 10 -> $literal3
            expect(filter("geo.distance(Location, geography'Point(1 2)') lt 10")).toContain("geo::distance(type::field($field1), $literal2) < $literal3");
        });

        it('geo.intersects', () => {
            // Location -> $field1, Polygon -> $literal2
            expect(filter("geo.intersects(Location, geography'Polygon((0 0, 0 1, 1 1, 1 0, 0 0))')")).toContain("geo::intersects(type::field($field1), $literal2)");
        });

        it('geo.length', () => {
            // Route -> $field1, 50 -> $literal2
            expect(filter("geo.length(Route) gt 50")).toContain("geo::length(type::field($field1)) > $literal2");
        });
    });

    describe('Lambda Operators', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('any', () => {
            expect(filter("Comments/any(c:c/Comment eq 'Good')")).toBeDefined();
        });

        it('all', () => {
            expect(filter("Comments/all(c:c/Score gt 5)")).toBeDefined();
        });
    });

    describe('Literals', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('String', () => expect(filter("Name eq 'StringValue'")).toBeDefined());
        it('Int', () => expect(filter("Age eq 123")).toBeDefined());
        it('Float', () => expect(filter("Score eq 12.34")).toBeDefined());
        it('Boolean', () => expect(filter("IsActive eq true")).toBeDefined());
        it('Null', () => expect(filter("Name eq null")).toBeDefined());
        it('GUID', () => expect(filter("Id eq 01234567-89ab-cdef-0123-456789abcdef")).toBeDefined());
        it('Date', () => expect(filter("DateVal eq 2020-01-01")).toBeDefined());
    });

    describe('Complex Scenarios', () => {
        const filter = (f: string) => parse(`$filter=${f}`).where;

        it('Nested grouping', () => {
            // SurrealDB parser adds extra parentheses for grouping
            const result = filter("((A eq 1) or (B eq 2)) and (C eq 3)");
            expect(result).toContain("((((type::field($field1) = $literal1) || (type::field($field2) = $literal2))) && (type::field($field3) = $literal3))");
        });

        it('Function in expression', () => {
            expect(filter("endswith(Name, 's') and Age gt 20")).toContain("string::ends_with(type::field($field1), type::string($param1)) && type::field($field2) > $literal2");
        });

        it('Multiple system options', () => {
            const result = parse('$filter=Age gt 18&$select=Name,Age&$orderby=Age desc&$top=5');
            expect(result.where).toBeDefined();
            expect(result.select).toBeDefined();
            expect(result.orderby).toBeDefined();
            expect(result.limit).toBe(5);
        });
    });

});
