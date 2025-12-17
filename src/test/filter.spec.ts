import { createQuery, SQLLang } from '../parser/main';

const processFilter = (filter: string) => {
    return createQuery(filter, { type: SQLLang.SurrealDB }).where;
}

// Basic comparison tests
describe('Basic comparisons', () => {
    test('equals operator', () => {
        const result = processFilter('$filter=value eq 123');
        expect(result).toContain('type::field($field1) = $literal1');
    });

    test('not equals operator', () => {
        const result = processFilter('$filter=value ne 123');
        expect(result).toContain('type::field($field1) != $literal1');
    });

    test('greater than operator', () => {
        const result = processFilter('$filter=value gt 123');
        expect(result).toContain('type::field($field1) > $literal1');
    });

    test('greater than or equal operator', () => {
        const result = processFilter('$filter=value ge 123');
        expect(result).toContain('type::field($field1) >= $literal1');
    });

    test('less than operator', () => {
        const result = processFilter('$filter=value lt 123');
        expect(result).toContain('type::field($field1) < $literal1');
    });

    test('less than or equal operator', () => {
        const result = processFilter('$filter=value le 123');
        expect(result).toContain('type::field($field1) <= $literal1');
    });

    test('complex less than or equal operator', () => {
        const result = processFilter('$filter=(value add 123) le 456');
        expect(result).toContain('type::field($field1) <= $literal1');
    });

    test('string comparison', () => {
        const result = processFilter("$filter=name eq 'John'");
        expect(result).toContain("type::field($field1) = $literal1");
    });
});

describe('Mathematical modifiers', () => {
    test('add operator', () => {
        const result = processFilter('$filter=(notes add users) gt 456');
        expect(result).toContain('(type::field($field1) + type::field($field2)) > $literal1');
    });

    test('sub operator', () => {
        const result = processFilter('$filter=(notes sub users) gt 456');
        expect(result).toContain('(type::field($field1) - type::field($field2)) > $literal1');
    });

    test('mul operator', () => {
        const result = processFilter('$filter=(notes mul users) gt 456');
        expect(result).toContain('(type::field($field1) * type::field($field2)) > $literal1');
    });

    test('div operator', () => {
        const result = processFilter('$filter=(notes div users) gt 456');
        expect(result).toContain('(type::field($field1) / type::field($field2)) > $literal1');
    });

    test('mod operator', () => {
        const result = processFilter('$filter=(notes mod users) lt 456');
        expect(result).toContain('(type::field($field1) % type::field($field2)) < $literal1');
    });
});

// Logical operators
describe('Logical operators', () => {
    test('and operator', () => {
        const result = processFilter("$filter=age gt 18 and name eq 'John'");
        expect(result).toContain("type::field($field1) > $literal1 && type::field($field2) = $literal2");
    });

    test('or operator', () => {
        const result = processFilter("$filter=age lt 12 or age gt 65");
        expect(result).toContain("type::field($field1) < $literal1 || type::field($field2) > $literal2");
    });

    test('not operator', () => {
        // ???
        const result = processFilter("$filter=not (age gt 18)");
        expect(result).toContain("!((type::field($field1) > $literal1))");
    });

    test('complex condition', () => {
        const result = processFilter("$filter=(age lt 12 or age gt 65) and active eq true");
        expect(result).toContain("(type::field($field1) < $literal1 || type::field($field2) > $literal2) && type::field($field3) = $literal3");
    });
});

// String functions
describe('String functions', () => {
    test('contains function', () => {
        const result = processFilter("$filter=contains(name, 'oh')");
        expect(result).toContain("string::contains(type::field($field1), type::string($param1))");
    });

    test('startswith function', () => {
        const result = processFilter("$filter=startswith(name, 'J')");
        expect(result).toContain("string::starts_with(type::field($field1), type::string($param1))");
    });

    test('endswith function', () => {
        const result = processFilter("$filter=endswith(name, 'n')");
        expect(result).toContain("string::ends_with(type::field($field1), type::string($param1))");
    });
});


// // Math operations
// describe('Math operations', () => {
//     test('add operation', () => {
//         const result = processFilter("$filter=price add 10 gt 100");
//         expect(result).toContain("price + 10 > 100");
//     });

//     test('sub operation', () => {
//         const result = processFilter("$filter=price sub 10 lt 50");
//         expect(result).toContain("price - 10 < 50");
//     });

//     test('mul operation', () => {
//         const result = processFilter("$filter=price mul 1.1 gt price");
//         expect(result).toContain("price * 1.1 > price");
//     });

//     test('div operation', () => {
//         const result = processFilter("$filter=price div 2 le 50");
//         expect(result).toContain("price / 2 <= 50");
//     });
// });

// // Complex expressions
// describe('Complex expressions', () => {
//     test('nested conditions with multiple operators', () => {
//         const query = "$filter=(age gt 20 and age lt 30) or (status eq 'premium' and subscribed eq true)";
//         const result = processFilter(query);
//         expect(result).toContain("(age > 20 AND age < 30) OR (status = 'premium' AND subscribed = true)");
//     });

//     test('combined string and numeric operations', () => {
//         const query = "$filter=startswith(name, 'J') and (age add 10) gt 30";
//         const result = processFilter(query);
//         expect(result).toContain("name STARTS WITH 'J' AND (age + 10) > 30");
//     });
// });

// // $expand support
// describe('expand support', () => {
//     test('simple expand with filter', () => {
//         const query = "$filter=orders($filter=amount gt 100)";
//         const result = processFilter(query);
//         expect(result).toContain("orders WHERE amount > 100");
//     });

//     test('nested expand with multiple filters', () => {
//         const query = "$filter=customers($filter=age gt 30;$expand=orders($filter=amount gt 200))";
//         const result = processFilter(query);
//         expect(result).toContain("customers WHERE age > 30 EXPAND orders WHERE amount > 200");
//     });

//     test('expand with logical conditions', () => {
//         const query = "$filter=products($filter=price lt 50 and inStock eq true)";
//         const result = processFilter(query);
//         expect(result).toContain("products WHERE price < 50 AND inStock = true");
//     });
// });

// Error handling
describe('Valid query handling', () => {
    test('incomplete filter expression', () => {
        expect(() => {
            processFilter("$filter=value eq 123 and title ");
        }).toThrow();
    });

    test('invalid operator', () => {
        expect(() => {
            processFilter("$filter=value INVALID 123");
        }).toThrow();
    });

    // TODO:
    // test('invalid key', () => {
    //     expect(() => {
    //         processFilter("$filter=va.lue eq 123");
    //     }).toThrow();
    // });

    test('invalid value', () => {
        expect(() => {
            processFilter("$filter=value eq str'ing");
        }).toThrow();
    });
});
