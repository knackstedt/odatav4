import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

const processFilter = (filter: string) => {
    return createQuery(filter, { type: SQLLang.SurrealDB }).where;
}

// Basic comparison tests
describe('Basic comparisons', () => {
    it('equals operator', () => {
        const result = processFilter('$filter=value eq 123');
        expect(result).toContain('type::field($field1) = $literal1');
    });

    it('not equals operator', () => {
        const result = processFilter('$filter=value ne 123');
        expect(result).toContain('type::field($field1) != $literal1');
    });

    it('greater than operator', () => {
        const result = processFilter('$filter=value gt 123');
        expect(result).toContain('type::field($field1) > $literal1');
    });

    it('greater than or equal operator', () => {
        const result = processFilter('$filter=value ge 123');
        expect(result).toContain('type::field($field1) >= $literal1');
    });

    it('less than operator', () => {
        const result = processFilter('$filter=value lt 123');
        expect(result).toContain('type::field($field1) < $literal1');
    });

    it('less than or equal operator', () => {
        const result = processFilter('$filter=value le 123');
        expect(result).toContain('type::field($field1) <= $literal1');
    });

    it('complex less than or equal operator', () => {
        const result = processFilter('$filter=(value add 123) le 456');
        expect(result).toContain('(type::field($field1) + $literal1) <= $literal2');
    });

    it('string comparison', () => {
        const result = processFilter("$filter=name eq 'John'");
        expect(result).toContain("type::field($field1) = $literal1");
    });
});

describe('Mathematical modifiers', () => {
    it('add operator', () => {
        const result = processFilter('$filter=(notes add users) gt 456');
        expect(result).toContain('(type::field($field1) + type::field($field2)) > $literal1');
    });

    it('sub operator', () => {
        const result = processFilter('$filter=(notes sub users) gt 456');
        expect(result).toContain('(type::field($field1) - type::field($field2)) > $literal1');
    });

    it('mul operator', () => {
        const result = processFilter('$filter=(notes mul users) gt 456');
        expect(result).toContain('(type::field($field1) * type::field($field2)) > $literal1');
    });

    it('div operator', () => {
        const result = processFilter('$filter=(notes div users) gt 456');
        expect(result).toContain('(type::field($field1) / type::field($field2)) > $literal1');
    });

    it('mod operator', () => {
        const result = processFilter('$filter=(notes mod users) lt 456');
        expect(result).toContain('(type::field($field1) % type::field($field2)) < $literal1');
    });
});

// Logical operators
describe('Logical operators', () => {
    it('and operator', () => {
        const result = processFilter("$filter=age gt 18 and name eq 'John'");
        expect(result).toContain("type::field($field1) > $literal1 && type::field($field2) = $literal2");
    });

    it('or operator', () => {
        const result = processFilter("$filter=age lt 12 or age gt 65");
        expect(result).toContain("type::field($field1) < $literal1 || type::field($field2) > $literal2");
    });

    it('not operator', () => {
        // ???
        const result = processFilter("$filter=not (age gt 18)");
        expect(result).toContain("!((type::field($field1) > $literal1))");
    });

    it('complex condition', () => {
        const result = processFilter("$filter=(age lt 12 or age gt 65) and active eq true");
        expect(result).toContain("(((type::field($field1) < $literal1 || type::field($field2) > $literal2)) && type::field($field3) = $literal3)");
    });
});

// String functions
describe('String functions', () => {
    it('contains function', () => {
        const result = processFilter("$filter=contains(name, 'oh')");
        expect(result).toContain("string::contains(type::field($field1), type::string($param1))");
    });

    it('startswith function', () => {
        const result = processFilter("$filter=startswith(name, 'J')");
        expect(result).toContain("string::starts_with(type::field($field1), type::string($param1))");
    });

    it('endswith function', () => {
        const result = processFilter("$filter=endswith(name, 'n')");
        expect(result).toContain("string::ends_with(type::field($field1), type::string($param1))");
    });
});


// Math operations
describe('Math operations', () => {
    it('add operation', () => {
        const result = processFilter("$filter=price add 10 gt 100");
        expect(result).toContain("type::field($field1) + $literal1 > $literal2");
    });

    it('sub operation', () => {
        const result = processFilter("$filter=price sub 10 lt 50");
        expect(result).toContain("type::field($field1) - $literal1 < $literal2");
    });

    it('mul operation', () => {
        const result = processFilter("$filter=price mul 1.1 gt price");
        expect(result).toContain("type::field($field1) * $literal1 > type::field($field2)");
    });

    it('div operation', () => {
        const result = processFilter("$filter=price div 2 le 50");
        expect(result).toContain("type::field($field1) / $literal1 <= $literal2");
    });
});


// Complex expressions
describe('Complex expressions', () => {
    it('nested conditions with multiple operators', () => {
        const query = "$filter=(age gt 20 and age lt 30) or (status eq 'premium' and subscribed eq true)";
        const result = processFilter(query);
        expect(result).toContain("(((type::field($field1) > $literal1 && type::field($field2) < $literal2)) || ((type::field($field3) = $literal3 && type::field($field4) = $literal4)))");
    });

    it('combined string and numeric operations', () => {
        const query = "$filter=startswith(name, 'J') and (age add 10) gt 30";
        const result = processFilter(query);
        expect(result).toContain("(string::starts_with(type::field($field1), type::string($param1)) && (type::field($field2) + $literal2) > $literal3)");
    });
});

// // $expand support
// describe('expand support', () => {
//     it('simple expand with filter', () => {
//         const query = "$filter=orders($filter=amount gt 100)";
//         const result = processFilter(query);
//         expect(result).toContain("orders WHERE amount > 100");
//     });

//     it('nested expand with multiple filters', () => {
//         const query = "$filter=customers($filter=age gt 30;$expand=orders($filter=amount gt 200))";
//         const result = processFilter(query);
//         expect(result).toContain("customers WHERE age > 30 EXPAND orders WHERE amount > 200");
//     });

//     it('expand with logical conditions', () => {
//         const query = "$filter=products($filter=price lt 50 and inStock eq true)";
//         const result = processFilter(query);
//         expect(result).toContain("products WHERE price < 50 AND inStock = true");
//     });
// });

// Error handling
describe('Valid query handling', () => {
    it('incomplete filter expression', () => {
        expect(() => {
            processFilter("$filter=value eq 123 and title ");
        }).toThrow();
    });

    it('invalid operator', () => {
        expect(() => {
            processFilter("$filter=value INVALID 123");
        }).toThrow();
    });

    // TODO:
    // it('invalid key', () => {
    //     expect(() => {
    //         processFilter("$filter=va.lue eq 123");
    //     }).toThrow();
    // });

    it('invalid value', () => {
        expect(() => {
            processFilter("$filter=value eq str'ing");
        }).toThrow();
    });
});
