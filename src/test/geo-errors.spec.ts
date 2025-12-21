import { describe, expect, it } from 'bun:test';
import { createQuery, SQLLang } from '../parser/main';

const parse = (input: string) => {
    return createQuery(input, { type: SQLLang.SurrealDB });
};

describe('Geo Literal Validation Errors', () => {

    describe('Point validation', () => {
        it('should throw error for Point with invalid data', () => {
            expect(() => parse("$filter=Location eq geography'Point(BAD)'"))
                .toThrow('Invalid Point data');
        });

        it('should throw error for Point with incomplete coordinates', () => {
            // Point with only one number should fail when trying to parse the second coordinate
            expect(() => parse("$filter=Location eq geography'Point(1)'"))
                .toThrow(); // Will throw "Expected closing parenthesis" from pointData
        });

        it('should throw error for Point with missing opening parenthesis', () => {
            // Without opening paren, pointData won't match, so pointLiteral will throw
            expect(() => parse("$filter=Location eq geography'Point 1 2)'"))
                .toThrow('Invalid Point data');
        });

        it('should throw error for Point with missing closing parenthesis', () => {
            // This will fail at the overall parse level, not a specific geo error
            expect(() => parse("$filter=Location eq geography'Point(1 2'"))
                .toThrow(); // Generic parse error for unclosed quote
        });
    });

    describe('LineString validation', () => {
        it('should throw error for LineString with invalid data', () => {
            expect(() => parse("$filter=Route eq geography'LineString(BAD)'"))
                .toThrow('Invalid LineString data');
        });

        it('should accept LineString with single position and close immediately', () => {
            // LineString(1 2) is technically valid - multiGeoLiteralFactory accepts 1+ items
            // OData spec requires 2+ positions but parser doesn't enforce this semantic rule
            const result = parse("$filter=Route eq geography'LineString(1 2)'");
            expect(result).toBeDefined();
        });
    });

    describe('Polygon validation', () => {
        it('should throw error for Polygon with invalid data', () => {
            // Polygon calls polygonData which calls multiGeoLiteralFactory with empty prefix
            expect(() => parse("$filter=Area eq geography'Polygon(BAD)'"))
                .toThrow(); // Will throw about expected items
        });

        it('should accept valid Polygon with ring', () => {
            // This is actually valid - a polygon with a single ring of 2 positions
            // OData spec requires rings to close (first=last) but parser doesn't enforce that
            const result = parse("$filter=Area eq geography'Polygon((1 2, 3 4))'");
            expect(result).toBeDefined();
        });
    });

    describe('Multi-geometry validation', () => {
        it('should throw error for MultiPoint with invalid data', () => {
            expect(() => parse("$filter=Locations eq geography'MultiPoint(BAD)'"))
                .toThrow('Invalid MultiPoint data');
        });

        it('should throw error for MultiLineString with invalid data', () => {
            expect(() => parse("$filter=Routes eq geography'MultiLineString(BAD)'"))
                .toThrow('Invalid MultiLineString data');
        });

        it('should throw error for MultiPolygon with invalid data', () => {
            expect(() => parse("$filter=Areas eq geography'MultiPolygon(BAD)'"))
                .toThrow('Invalid MultiPolygon data');
        });
    });

    describe('Collection validation', () => {
        it('should throw error for GeometryCollection with invalid data', () => {
            expect(() => parse("$filter=Shapes eq geography'Collection(BAD)'"))
                .toThrow('Invalid Collection data');
        });
    });
});
