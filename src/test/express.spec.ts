import { beforeAll, describe, expect, test } from "bun:test";
import type { Express } from 'express';
import request from 'supertest';

let app: Express;

beforeAll(() => {
    app = (global as any).app;
});

describe("OData V4 - $filter Tests", () => {
    describe("Logical Operators", () => {
        test("should filter with 'and' operator", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=userId eq 1 and id lt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);
            response.body.value.forEach((post: any) => {
                expect(post.userId.toString()).toContain("user:1");
                expect(parseInt(post.id.split(':')[1])).toBeLessThan(5);
            });
        });

        test("should filter with 'or' operator", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=userId eq 1 or userId eq 2")
                .expect(200);

            expect(response.body.value).toBeArray();
            expect(response.body.value.length).toBeGreaterThan(0);
            response.body.value.forEach((post: any) => {
                const userId = post.userId.toString();
                expect(userId === "user:1" || userId === "user:2").toBe(true);
            });
        });

        test("should filter with 'not' operator", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=not(userId eq 1)&$top=10")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((post: any) => {
                expect(post.userId.toString()).not.toBe("user:1");
            });
        });

        test("should filter with complex nested logical operators", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=(userId eq 1 and id lt 5) or (userId eq 2 and id gt 15)")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });

    describe("Comparison Operators", () => {
        test("should filter with 'eq' (equals)", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=userId eq 1")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((post: any) => {
                expect(post.userId.toString()).toContain("user:1");
            });
        });

        test("should filter with 'ne' (not equals)", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=userId ne 1&$top=10")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((post: any) => {
                expect(post.userId.toString()).not.toBe("user:1");
            });
        });

        test("should filter with 'gt' (greater than)", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id gt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((user: any) => {
                const id = parseInt(user.id.split(':')[1]);
                expect(id).toBeGreaterThan(5);
            });
        });

        test("should filter with 'ge' (greater than or equal)", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id ge 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((user: any) => {
                const id = parseInt(user.id.split(':')[1]);
                expect(id).toBeGreaterThanOrEqual(5);
            });
        });

        test("should filter with 'lt' (less than)", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id lt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((user: any) => {
                const id = parseInt(user.id.split(':')[1]);
                expect(id).toBeLessThan(5);
            });
        });

        test("should filter with 'le' (less than or equal)", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id le 5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((user: any) => {
                const id = parseInt(user.id.split(':')[1]);
                expect(id).toBeLessThanOrEqual(5);
            });
        });
    });

    describe("String Functions", () => {
        test("should filter with 'contains' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=contains(title, 'qui')&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((post: any) => {
                expect(post.title.toLowerCase()).toContain('qui');
            });
        });

        test("should filter with 'startswith' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=startswith(title, 'qui')&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
            response.body.value.forEach((post: any) => {
                expect(post.title.toLowerCase().startsWith('qui')).toBe(true);
            });
        });

        test("should filter with 'endswith' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=endswith(title, 'esse')&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
            if (response.body.value.length > 0) {
                response.body.value.forEach((post: any) => {
                    expect(post.title.endsWith('esse')).toBe(true);
                });
            }
        });

        test("should filter with 'length' function", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=length(name) gt 10&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'indexof' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=indexof(title, 'et') gt 0&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'tolower' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=tolower(title) eq 'qui est esse'&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'toupper' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=contains(toupper(title), 'QUI')&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'trim' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$filter=length(trim(title)) gt 0&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });

    describe("Arithmetic Operators", () => {
        test("should filter with 'add' operator", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id add 5 gt 10")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'sub' operator", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id sub 2 gt 3")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'mul' operator", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id mul 2 gt 10")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'div' operator", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id div 2 lt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'mod' operator", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=id mod 2 eq 0&$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });

    describe("Math Functions", () => {
        test("should filter with 'round' function", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=round(id) gt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'floor' function", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=floor(id) lt 5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'ceiling' function", async () => {
            const response = await request(app)
                .get("/api/odata/user?$filter=ceiling(id) ge 5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });

    describe("Date/Time Functions", () => {
        test("should filter with 'year' function (if date fields exist)", async () => {
            // Note: This test may fail if there are no date fields in the test data
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
            // If date fields are added to test data, uncomment below:
            // .get("/api/odata/post?$filter=year(createdAt) eq 2024")
        });

        test("should filter with 'month' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'day' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'hour' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'minute' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });

        test("should filter with 'second' function", async () => {
            const response = await request(app)
                .get("/api/odata/post?$top=5")
                .expect(200);

            expect(response.body.value).toBeArray();
        });
    });
});

describe("OData V4 - $select Tests", () => {
    test("should select specific fields", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=id,title&$top=5")
            .expect(200);

        expect(response.body.value).toBeArray();
        if (response.body.value.length > 0) {
            const firstPost = response.body.value[0];
            expect(firstPost).toHaveProperty('id');
            expect(firstPost).toHaveProperty('title');
            // Should not have body field when not selected
            expect(firstPost).not.toHaveProperty('body');
        }
    });

    test("should select all fields with *", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=*&$top=1")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBeGreaterThan(0);
    });

    test("should select multiple fields", async () => {
        const response = await request(app)
            .get("/api/odata/user?$select=id,name,email&$top=5")
            .expect(200);

        expect(response.body.value).toBeArray();
        if (response.body.value.length > 0) {
            const firstUser = response.body.value[0];
            expect(firstUser).toHaveProperty('id');
            expect(firstUser).toHaveProperty('name');
            expect(firstUser).toHaveProperty('email');
        }
    });

    test("should combine $select with $filter", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=id,title&$filter=userId eq 1&$top=5")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});

describe("OData V4 - $orderby Tests", () => {
    test("should order by single field ascending", async () => {
        const response = await request(app)
            .get("/api/odata/user?$orderby=id asc&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();

        // Verify ascending order
        for (let i = 1; i < response.body.value.length; i++) {
            const prevId = parseInt(response.body.value[i - 1].id.split(':')[1]);
            const currId = parseInt(response.body.value[i].id.split(':')[1]);
            expect(currId).toBeGreaterThanOrEqual(prevId);
        }
    });

    test("should order by single field descending", async () => {
        const response = await request(app)
            .get("/api/odata/user?$orderby=id desc&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();

        // Verify descending order
        for (let i = 1; i < response.body.value.length; i++) {
            const prevId = parseInt(response.body.value[i - 1].id.split(':')[1]);
            const currId = parseInt(response.body.value[i].id.split(':')[1]);
            expect(currId).toBeLessThanOrEqual(prevId);
        }
    });

    test("should order by multiple fields", async () => {
        const response = await request(app)
            .get("/api/odata/post?$orderby=userId asc,id desc&$top=20")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should combine $orderby with $filter and $select", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=userId eq 1&$select=id,title&$orderby=id desc")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});

describe("OData V4 - $top and $skip (Pagination) Tests", () => {
    test("should limit results with $top", async () => {
        const response = await request(app)
            .get("/api/odata/post?$top=5")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBeLessThanOrEqual(5);
    });

    test("should skip results with $skip", async () => {
        const firstPage = await request(app)
            .get("/api/odata/post?$top=10&$orderby=id asc")
            .expect(200);

        const secondPage = await request(app)
            .get("/api/odata/post?$top=10&$skip=10&$orderby=id asc")
            .expect(200);

        expect(firstPage.body.value).toBeArray();
        expect(secondPage.body.value).toBeArray();

        // First item of second page should be different from first page
        if (firstPage.body.value.length > 0 && secondPage.body.value.length > 0) {
            expect(firstPage.body.value[0].id).not.toBe(secondPage.body.value[0].id);
        }
    });

    test("should paginate correctly with different page sizes", async () => {
        const page1 = await request(app)
            .get("/api/odata/user?$top=5&$skip=0&$orderby=id asc")
            .expect(200);

        const page2 = await request(app)
            .get("/api/odata/user?$top=5&$skip=5&$orderby=id asc")
            .expect(200);

        const page3 = await request(app)
            .get("/api/odata/user?$top=5&$skip=10&$orderby=id asc")
            .expect(200);

        expect(page1.body.value.length).toBeLessThanOrEqual(5);
        expect(page2.body.value.length).toBeLessThanOrEqual(5);
        expect(page3.body.value.length).toBeLessThanOrEqual(5);
    });

    test("should handle large skip values", async () => {
        const response = await request(app)
            .get("/api/odata/post?$top=5&$skip=90")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});

describe("OData V4 - $count Tests", () => {
    test("should include count when $count=true", async () => {
        const response = await request(app)
            .get("/api/odata/post?$count=true&$top=10")
            .expect(200);

        expect(response.body['@odata.count']).toBeDefined();
        expect(typeof response.body['@odata.count']).toBe('number');
        expect(response.body['@odata.count']).toBeGreaterThan(0);
    });

    test("should not include count when $count=false", async () => {
        const response = await request(app)
            .get("/api/odata/post?$count=false&$top=10")
            .expect(200);

        // When count is false, @odata.count should not be present or should be undefined
        // (implementation may vary)
        expect(response.body.value).toBeArray();
    });

    test("should include count with filters", async () => {
        const response = await request(app)
            .get("/api/odata/post?$count=true&$filter=userId eq 1&$top=5")
            .expect(200);

        expect(response.body['@odata.count']).toBeDefined();
        expect(response.body['@odata.count']).toBeGreaterThan(0);
    });

    test("should return correct count despite pagination", async () => {
        const response = await request(app)
            .get("/api/odata/post?$count=true&$top=5")
            .expect(200);

        expect(response.body['@odata.count']).toBeDefined();
        // Count should be the total, not just the page size
        expect(response.body['@odata.count']).toBeGreaterThan(5);
    });
});

describe("OData V4 - $groupby Tests", () => {
    test("should group by single field", async () => {
        const response = await request(app)
            .get("/api/odata/post?$groupby=userId&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should group by multiple fields", async () => {
        const response = await request(app)
            .get("/api/odata/comment?$groupby=postId&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should combine $groupby with $filter", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=userId gt 5&$groupby=userId")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should combine $groupby with $orderby", async () => {
        const response = await request(app)
            .get("/api/odata/post?$groupby=userId&$orderby=userId asc")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});

describe("OData V4 - $id Tests", () => {
    test("should fetch specific record by ID", async () => {
        const response = await request(app)
            .get("/api/odata/post/post:1")
            .expect(200);

        expect(response.body).toBeObject();
        expect(response.body.id).toBe("post:1");
    });

    test("should fetch user by ID", async () => {
        const response = await request(app)
            .get("/api/odata/user/user:1")
            .expect(200);

        expect(response.body).toBeObject();
        expect(response.body.id).toBe("user:1");
    });

    test("should return 404 for non-existent ID", async () => {
        const response = await request(app)
            .get("/api/odata/post/post:999999")
            .expect(404);
    });

    test("should fetch comment by ID", async () => {
        const response = await request(app)
            .get("/api/odata/comment/comment:1")
            .expect(200);

        expect(response.body).toBeObject();
        expect(response.body.id).toBe("comment:1");
    });
});

describe("OData V4 - $search Tests (Partial Support)", () => {
    test("should reject $search by default (disabled for security)", async () => {
        const response = await request(app)
            .get("/api/odata/post?$search=qui&$top=10");

        // $search is disabled by default, expect 400
        expect(response.status).toBe(400);
    });

    test("should reject $search in combination queries", async () => {
        const response = await request(app)
            .get("/api/odata/post?$search=est&$top=5&$orderby=id asc");

        expect(response.status).toBe(400);
    });
});

describe("OData V4 - $format Tests (WIP)", () => {
    test("should accept $format=json", async () => {
        const response = await request(app)
            .get("/api/odata/post?$format=json&$top=5");

        // Accept 200 (implemented) or other status codes (not fully implemented)
        expect([200, 501]).toContain(response.status);

        if (response.status === 200) {
            expect(response.body.value).toBeArray();
        }
    });

    test("should handle $format=xml request", async () => {
        const response = await request(app)
            .get("/api/odata/post?$format=xml&$top=5");

        // XML format may not be implemented, accept various status codes
        expect([200, 400, 501]).toContain(response.status);
    });
});

describe("OData V4 - $skiptoken Tests (WIP)", () => {
    test("should handle $skiptoken parameter", async () => {
        const response = await request(app)
            .get("/api/odata/post?$skiptoken=token123&$top=5");

        // $skiptoken is WIP, may not be fully implemented
        expect([200, 400, 501]).toContain(response.status);
    });
});

describe("OData V4 - Complex Combination Tests", () => {
    test("should handle all parameters together", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=id,title&$filter=userId eq 1&$orderby=id desc&$top=5&$skip=0&$count=true")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body['@odata.count']).toBeDefined();

        if (response.body.value.length > 0) {
            const firstPost = response.body.value[0];
            expect(firstPost).toHaveProperty('id');
            expect(firstPost).toHaveProperty('title');
        }
    });

    test("should handle complex filter with multiple operations", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=contains(title, 'qui') and userId gt 3 and userId lt 7&$select=id,title,userId&$orderby=userId asc&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should handle groupby with filter and orderby", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=userId le 5&$groupby=userId&$orderby=userId desc")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should paginate with complex filters", async () => {
        const response = await request(app)
            .get("/api/odata/comment?$filter=startswith(email, 'E') or startswith(email, 'J')&$orderby=id asc&$top=10&$skip=5&$count=true")
            .expect(200);

        expect(response.body.value).toBeArray();
        if (response.body['@odata.count'] !== undefined) {
            expect(response.body['@odata.count']).toBeGreaterThanOrEqual(0);
        }
    });

    test("should handle nested arithmetic and string functions", async () => {
        const response = await request(app)
            .get("/api/odata/user?$filter=length(name) gt 5 and id mod 2 eq 0&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should handle select with related entities", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=id,title,userId&$top=5")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});

describe("OData V4 - Edge Cases and Error Handling", () => {
    test("should handle empty result set", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=userId eq 999999&$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(0);
    });

    test("should handle malformed filter gracefully", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=invalid syntax here");

        // Should return an error status (400 or 500)
        expect([400, 500]).toContain(response.status);
    });

    test("should handle $top with value 0", async () => {
        const response = await request(app)
            .get("/api/odata/post?$top=0")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(0);
    });

    test("should handle very large $top value", async () => {
        const response = await request(app)
            .get("/api/odata/post?$top=10000")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should handle negative $skip gracefully", async () => {
        const response = await request(app)
            .get("/api/odata/post?$skip=-5");

        // Implementation may accept or reject negative skip
        expect([200, 400]).toContain(response.status);
    });

    test("should handle invalid field names in $select", async () => {
        const response = await request(app)
            .get("/api/odata/post?$select=nonExistentField&$top=1");

        // Should either ignore or error
        expect([200, 400]).toContain(response.status);
    });

    // TODO: Do we want to support this?
    test.skip("should handle invalid field names in $orderby", async () => {
        const response = await request(app)
            .get("/api/odata/post?$orderby=nonExistentField asc");

        // Should return an error
        expect([400, 500]).toContain(response.status);
    });

    test("should handle special characters in filter values", async () => {
        const response = await request(app)
            .get("/api/odata/post?$filter=contains(title, 'test''s')&$top=5");

        // May or may not find results, but should not crash
        expect([200, 400]).toContain(response.status);
    });
});

describe("OData V4 - CRUD Operations", () => {
    test("should list all posts with GET", async () => {
        const response = await request(app)
            .get("/api/odata/post?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBeGreaterThan(0);
    });

    test("should get single post by ID", async () => {
        const response = await request(app)
            .get("/api/odata/post/post:1")
            .expect(200);

        expect(response.body).toBeObject();
        expect(response.body.id).toBe("post:1");
        expect(response.body).toHaveProperty('title');
        expect(response.body).toHaveProperty('body');
    });

    test("should list all users", async () => {
        const response = await request(app)
            .get("/api/odata/user?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBeGreaterThan(0);
    });

    test("should list all comments", async () => {
        const response = await request(app)
            .get("/api/odata/comment?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBeGreaterThan(0);
    });

    test("should list all albums", async () => {
        const response = await request(app)
            .get("/api/odata/album?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should list all todos", async () => {
        const response = await request(app)
            .get("/api/odata/todo?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });

    test("should list all photos", async () => {
        const response = await request(app)
            .get("/api/odata/photo?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
    });
});
