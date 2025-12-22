import { beforeAll, describe, expect, test } from "bun:test";
import type { Express } from 'express';
import request from 'supertest';

let app: Express;

beforeAll(() => {
    app = (global as any).app;
});

describe("OData V4 - Max Page Size Config", () => {
    test("should limit results to maxPageSize when not specified", async () => {
        // Default behavior without $top usually defaults to 100 or all.
        // With maxPageSize enforced, it should be capped.
        // However, if no $top is provided, server-driven paging applies.
        // We expect maxPageSize to act as the server-driven page size limit.
        const response = await request(app)
            .get("/api/odata-limited/post")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(5);
    });

    test("should limit results to maxPageSize when larger $top is requested", async () => {
        const response = await request(app)
            .get("/api/odata-limited/post?$top=10")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(5);
    });

    test("should allow smaller $top requests", async () => {
        const response = await request(app)
            .get("/api/odata-limited/post?$top=3")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(3);
    });

    test("should provide @odata.nextlink when more results exist", async () => {
        const response = await request(app)
            .get("/api/odata-limited/post")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(5);
        expect(response.body['@odata.nextlink']).toBeDefined();

        const nextLink = response.body['@odata.nextlink'];
        // URL parameters might be encoded: $skip -> %24skip
        const decodedLink = decodeURIComponent(nextLink);
        expect(decodedLink).toContain('$skip=5');
        expect(decodedLink).toContain('$top=5');
    });

    test("should include correct @odata.nextlink when using $skip", async () => {
        const response = await request(app)
            .get("/api/odata-limited/post?$skip=2")
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body.value.length).toBe(5);
        expect(response.body['@odata.nextlink']).toBeDefined();

        const nextLink = response.body['@odata.nextlink'];
        // original skip 2 + returned 5 = 7
        expect(decodeURIComponent(nextLink)).toContain('$skip=7');
    });

    test("should not provide @odata.nextlink on last page", async () => {
        // Assuming we have less than 100 posts (seed data typically small)
        // Let's interpret 'at end' as skip very high
        const response = await request(app)
            .get("/api/odata-limited/post?$skip=1000") // Assuming < 1000 posts
            .expect(200);

        expect(response.body.value).toBeArray();
        expect(response.body).not.toHaveProperty('@odata.nextlink');
    });
});
