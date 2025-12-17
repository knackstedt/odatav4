import Expressions from "./expressions";
import Lexer from "./lexer";
import ODataUri from "./odata-uri";
import PrimitiveLiteral from "./primitive-literal";
import Query from "./query";
import ResourcePath from "./resource-path";
import Utils, { ODataV4ParseError } from './utils';

export const parserFactory = function (
    fn: (value: Utils.SourceArray, index: number, metadataContext?: any) => Lexer.Token
) {
    return function (source: string, options) {
        options ||= {};
        const raw = new Uint16Array(source.length);
        let pos = 0;
        for (let i = 0; i < source.length; i++) {
            raw[i] = source.charCodeAt(i);
        }

        let result = fn(raw, pos, options.metadata);

        if (!result) {
            const source = Utils.stringify(raw, 0, raw.length);
            const marker = ' '.repeat(pos) + '^';
            const at = source + "\n" + marker;

            throw new ODataV4ParseError({
                msg: `Parse error at index ${pos}. No parse found.`,
                value: raw,
                index: pos,
                props: {
                    source,
                    marker,
                    character: Utils.stringify(raw, pos, pos + 1),
                    index: pos,
                    at,
                }
            });
        }

        // This block _may_ be optional, it appears to be a safety check.
        // If it's commented out, a query will still be built but will be incomplete.
        if (result.next < raw.length) {
            const source = Utils.stringify(raw, 0, raw.length);
            const marker = ' '.repeat(result.next) + '^';
            const at = source + "\n" + marker;

            throw new ODataV4ParseError({
                msg: `Parse error at index ${pos}. Incompletely parsed query ${result.next}/${raw.length}.`,
                value: raw,
                index: result.next,
                props:  {
                    source,
                    marker,
                    character: Utils.stringify(raw, result.next, result.next + 1),
                    index: result.next,
                    at,
                }
            });
        }

        return result;
    };
};


export function odataUri(source: string, options?: any): Lexer.Token { return parserFactory(ODataUri.odataUri)(source, options); }
export function resourcePath(source: string, options?: any): Lexer.Token { return parserFactory(ResourcePath.resourcePath)(source, options); }
export function query(source: string, options?: any): Lexer.Token { return parserFactory(Query.queryOptions)(source, options); }
export function filter(source: string, options?: any): Lexer.Token { return parserFactory(Expressions.boolCommonExpr)(source, options); }
export function keys(source: string, options?: any): Lexer.Token { return parserFactory(Expressions.keyPredicate)(source, options); }
export function literal(source: string, options?: any): Lexer.Token { return parserFactory(PrimitiveLiteral.primitiveLiteral)(source, options); }

export class Parser {
    odataUri = odataUri;
    resourcePath = resourcePath;
    query = query;
    filter = filter;
    keys = keys;
    literal = literal;
}

