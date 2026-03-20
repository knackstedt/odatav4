export interface FormatOptions {
    indentSize?: number;
    substituteParams?: boolean;
    simplifyQuery?: boolean;
    parameters?: Map<string, any> | Record<string, any>;
}

type Token = {
    type: 'keyword' | 'operator' | 'identifier' | 'string' | 'paren' | 'comma' | 'other';
    value: string;
};

export function formatSurrealQL(sql: string, options: FormatOptions = {}): string {
    const { indentSize = 4, substituteParams = false, simplifyQuery = false, parameters } = options;

    // Convert parameters to Map if it's a Record
    let paramMap: Map<string, any> | undefined;
    if (parameters) {
        if (parameters instanceof Map) {
            paramMap = parameters;
        } else {
            paramMap = new Map(Object.entries(parameters));
        }
    }
    const indent = ' '.repeat(indentSize);

    const tokens = tokenize(sql);
    let result = '';
    let depth = 0;
    let baseDepth = 0;
    let inFunctionCall = 0;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const prevToken = i > 0 ? tokens[i - 1] : null;
        const nextToken = i < tokens.length - 1 ? tokens[i + 1] : null;

        if (token.type === 'keyword') {
            if (['AS', 'DESC', 'ASC'].includes(token.value)) {
                result += ' ' + token.value + ' ';
            } else {
                if (result.length > 0) {
                    result += ' \n';
                }
                result += token.value + ' ';

                if (token.value === 'SELECT') {
                    result += '\n' + indent;
                    baseDepth = 1;
                } else if (token.value === 'WHERE') {
                    result += '\n' + indent;
                    baseDepth = 1;
                    depth = 1;
                } else {
                    baseDepth = 0;
                }
            }
        } else if (token.type === 'paren') {
            if (token.value === '(') {
                if (prevToken && prevToken.type === 'identifier') {
                    result += '(';
                    depth++;
                    inFunctionCall++;
                } else {
                    result += '(\n' + indent.repeat(depth + 1);
                    depth++;
                }
            } else {
                depth--;
                if (inFunctionCall > 0) {
                    inFunctionCall--;
                    result += ')';
                } else {
                    result += '\n' + indent.repeat(depth) + ')';
                }
            }
        } else if (token.type === 'operator') {
            if (token.value === '&&') {
                result += ' && \n' + indent.repeat(depth);
            } else if (token.value === '||') {
                result += '\n' + indent.repeat(depth - 1) + ') || (\n' + indent.repeat(depth);
            } else {
                result += ' ' + token.value + ' ';
            }
        } else if (token.type === 'comma') {
            if (inFunctionCall > 0) {
                result += ', ';
            } else {
                result += ', \n' + indent.repeat(baseDepth);
            }
        } else {
            const needsSpace = prevToken &&
                prevToken.type !== 'paren' &&
                prevToken.value !== '(' &&
                prevToken.type !== 'other' &&
                !result.endsWith(' ') &&
                !result.endsWith('\n');

            if (needsSpace) {
                result += ' ';
            }

            // Substitute parameters if enabled
            let tokenValue = token.value;
            if (substituteParams && paramMap && token.type === 'identifier' && token.value.startsWith('$')) {
                const paramKey = token.value.substring(1); // Remove the $ prefix
                if (paramMap.has(paramKey)) {
                    const paramValue = paramMap.get(paramKey);
                    tokenValue = formatParameterValue(paramValue);
                } else if (paramMap.has(token.value)) {
                    // Try with the $ prefix as well
                    const paramValue = paramMap.get(token.value);
                    tokenValue = formatParameterValue(paramValue);
                }
            }

            result += tokenValue;
        }
    }

    result = result.split('\n').map(line => line.trimEnd()).join('\n');

    // Apply simplification if requested
    if (simplifyQuery) {
        result = simplifyQueryString(result);
    }

    return result.trim();
}

function simplifyQueryString(query: string): string {
    let simplified = query;

    // Strip type::field('fieldname') => fieldname
    simplified = simplified.replace(/type::field\((['"`])([^'"`]+)\1\)/g, '$2');

    // Strip type::table('tablename') => tablename
    simplified = simplified.replace(/type::table\((['"`])([^'"`]+)\1\)/g, '$2');

    // Strip type::string('value') => 'value' ONLY when it contains a string literal
    // Don't strip if it contains a field reference or function call
    simplified = simplified.replace(/type::string\(((['"`])[^'"`]*\2)\)/g, '$1');

    // Strip type::number(...) => ... ONLY when it contains a number literal or simple expression
    // Don't strip if it contains complex nested function calls
    simplified = simplified.replace(/type::number\(((?:[^()]|\([^)]*\))*)\)/g, (match, content) => {
        // Only simplify if it's a simple expression (number, field, or simple function call)
        // Keep it if it has nested type:: calls
        if (content.includes('type::')) {
            return match; // Keep the type::number wrapper
        }
        return content;
    });

    // Strip type::record(...) => ... ONLY when it contains a string literal
    simplified = simplified.replace(/type::record\(((['"`])[^'"`]*\2)\)/g, '$1');

    // Remove redundant AS `fieldname` when field is already fieldname
    // e.g., name AS `name` => name
    simplified = simplified.replace(/(\w+)\s+AS\s+`\1`/g, '$1');

    return simplified;
}

function formatParameterValue(value: any): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (typeof value === 'string') {
        return `'${value.replace(/'/g, "\\'")}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(v => formatParameterValue(v)).join(', ')}]`;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function tokenize(sql: string): Token[] {
    const tokens: Token[] = [];
    const keywords = ['ORDER BY', 'GROUP BY', 'SELECT', 'FROM', 'WHERE', 'LIMIT', 'START', 'FETCH', 'AS', 'DESC', 'ASC'];
    const operators = [
        'CONTAINSNOT', 'CONTAINSALL', 'CONTAINSANY', 'CONTAINSNONE', 'CONTAINS',
        'NOTINSIDE', 'ALLINSIDE', 'ANYINSIDE', 'NONEINSIDE', 'INSIDE',
        'OUTSIDE', 'INTERSECTS',
        '&&', '||', '>=', '<=', '!=', '==', '?=', '*=', '=', '>', '<', '+', '-', '*', '/', '%', '**'
    ];

    let i = 0;

    while (i < sql.length) {
        if (/\s/.test(sql[i])) {
            i++;
            continue;
        }

        let matched = false;

        for (const kw of keywords) {
            if (sql.substring(i, i + kw.length) === kw) {
                const nextChar = sql[i + kw.length];
                if (!nextChar || /\s/.test(nextChar)) {
                    tokens.push({ type: 'keyword', value: kw });
                    i += kw.length;
                    matched = true;
                    break;
                }
            }
        }
        if (matched) continue;

        if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`') {
            const quote = sql[i];
            let str = quote;
            i++;
            while (i < sql.length) {
                str += sql[i];
                if (sql[i] === quote && sql[i - 1] !== '\\') {
                    i++;
                    break;
                }
                i++;
            }
            tokens.push({ type: 'string', value: str });
            continue;
        }

        if (sql[i] === '(' || sql[i] === ')') {
            tokens.push({ type: 'paren', value: sql[i] });
            i++;
            continue;
        }

        if (sql[i] === '[') {
            let bracket = '[';
            i++;
            while (i < sql.length && sql[i] !== ']') {
                bracket += sql[i];
                i++;
            }
            if (i < sql.length) {
                bracket += sql[i];
                i++;
            }
            tokens.push({ type: 'other', value: bracket });
            continue;
        }

        if (sql[i] === ',') {
            tokens.push({ type: 'comma', value: ',' });
            i++;
            continue;
        }

        for (const op of operators) {
            if (sql.substring(i, i + op.length) === op) {
                tokens.push({ type: 'operator', value: op });
                i += op.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        let identifier = '';
        while (i < sql.length && !/[\s(),\[\]]/.test(sql[i])) {
            identifier += sql[i];
            i++;
        }
        if (identifier) {
            tokens.push({ type: 'identifier', value: identifier });
        }
    }

    return tokens;
}
