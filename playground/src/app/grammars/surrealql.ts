import type * as Monaco from 'monaco-editor';

export function init(monaco: typeof Monaco) {
    monaco.languages.register({ id: 'surrealql' });

    monaco.languages.setMonarchTokensProvider('surrealql', {
        defaultToken: "invalid",
        tokenPostfix: ".surrealql",
        ignoreCase: true,

        keywords: [
            'SELECT', 'FROM', 'WHERE', 'ORDER', 'BY', 'GROUP', 'LIMIT', 'START', 'FETCH',
            'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP',
            'DEFINE', 'REMOVE', 'NAMESPACE', 'DATABASE', 'TABLE', 'EVENT', 'FIELD', 'INDEX',
            'SCOPE', 'TOKEN', 'USER', 'FUNCTION', 'ANALYZER', 'PARAM',
            'USE', 'NS', 'DB', 'LET', 'RETURN', 'IF', 'ELSE', 'THEN', 'END',
            'FOR', 'IN', 'AS', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'NONE', 'EMPTY',
            'BEGIN', 'TRANSACTION', 'COMMIT', 'CANCEL', 'BREAK', 'CONTINUE',
            'RELATE', 'CONTENT', 'MERGE', 'PATCH', 'DIFF', 'SPLIT', 'AT',
            'PERMISSIONS', 'FULL', 'NONE', 'TRUE', 'FALSE',
            'SCHEMAFULL', 'SCHEMALESS', 'TYPE', 'VALUE', 'ASSERT', 'ON',
            'UNIQUE', 'SEARCH', 'COLUMNS', 'HIGHLIGHTS', 'MTREE', 'HNSW',
            'LIVE', 'KILL', 'SHOW', 'INFO', 'CHANGES', 'SINCE',
            'TIMEOUT', 'PARALLEL', 'EXPLAIN', 'VERSION',
            'ASC', 'DESC', 'COLLATE', 'NUMERIC', 'RAND',
            'OMIT', 'ONLY', 'WITH', 'NOINDEX', 'TEMPFILES'
        ],

        operators: [
            '=', '!=', '==', '?=', '*=', '~', '!~', '*~', '?~',
            '<', '<=', '>', '>=', '+', '-', '*', '/', '**',
            '&&', '||', '??', 'CONTAINS', 'CONTAINSNOT', 'CONTAINSALL', 'CONTAINSANY', 'CONTAINSNONE',
            'INSIDE', 'NOTINSIDE', 'ALLINSIDE', 'ANYINSIDE', 'NONEINSIDE',
            'OUTSIDE', 'INTERSECTS'
        ],

        builtinFunctions: [
            'count', 'array', 'bool', 'bytes', 'datetime', 'decimal', 'duration', 'float', 'int', 'number', 'object', 'point', 'string', 'table', 'thing',
            'math::abs', 'math::ceil', 'math::floor', 'math::round', 'math::sqrt', 'math::pow', 'math::max', 'math::min',
            'string::concat', 'string::contains', 'string::endsWith', 'string::join', 'string::len', 'string::lowercase', 'string::uppercase',
            'string::repeat', 'string::replace', 'string::reverse', 'string::slice', 'string::slug', 'string::split', 'string::startsWith', 'string::trim',
            'array::add', 'array::all', 'array::any', 'array::append', 'array::combine', 'array::complement', 'array::concat',
            'array::difference', 'array::distinct', 'array::flatten', 'array::group', 'array::insert', 'array::intersect',
            'array::len', 'array::max', 'array::min', 'array::pop', 'array::prepend', 'array::push', 'array::remove',
            'array::reverse', 'array::slice', 'array::sort', 'array::union', 'array::matches',
            'time::now', 'time::unix', 'time::day', 'time::hour', 'time::minute', 'time::month', 'time::year',
            'time::floor', 'time::round', 'time::group',
            'crypto::md5', 'crypto::sha1', 'crypto::sha256', 'crypto::sha512', 'crypto::argon2::compare', 'crypto::argon2::generate',
            'crypto::pbkdf2::compare', 'crypto::pbkdf2::generate', 'crypto::scrypt::compare', 'crypto::scrypt::generate',
            'geo::area', 'geo::bearing', 'geo::centroid', 'geo::distance', 'geo::hash::decode', 'geo::hash::encode',
            'http::head', 'http::get', 'http::put', 'http::post', 'http::patch', 'http::delete',
            'parse::email::host', 'parse::email::user', 'parse::url::domain', 'parse::url::fragment', 'parse::url::host',
            'parse::url::path', 'parse::url::port', 'parse::url::query',
            'rand', 'rand::bool', 'rand::enum', 'rand::float', 'rand::guid', 'rand::int', 'rand::string', 'rand::time', 'rand::uuid',
            'session::db', 'session::id', 'session::ip', 'session::ns', 'session::origin', 'session::sc',
            'type::bool', 'type::datetime', 'type::decimal', 'type::duration', 'type::field', 'type::fields',
            'type::float', 'type::int', 'type::number', 'type::point', 'type::string', 'type::table', 'type::thing',
            'meta::id', 'meta::tb', 'duration::days', 'duration::hours', 'duration::mins', 'duration::secs',
            'not', 'sleep', 'vector::add', 'vector::angle', 'vector::divide', 'vector::dot', 'vector::magnitude',
            'vector::multiply', 'vector::normalize', 'vector::project', 'vector::subtract', 'vector::distance::chebyshev',
            'vector::distance::euclidean', 'vector::distance::hamming', 'vector::distance::manhattan', 'vector::distance::minkowski',
            'vector::similarity::cosine', 'vector::similarity::jaccard', 'vector::similarity::pearson'
        ],

        typeKeywords: [
            'any', 'array', 'bool', 'bytes', 'datetime', 'decimal', 'duration', 'float', 'int', 'number',
            'object', 'option', 'record', 'geometry', 'point', 'string', 'uuid', 'set'
        ],

        brackets: [
            { open: '{', close: '}', token: 'delimiter.curly' },
            { open: '[', close: ']', token: 'delimiter.bracket' },
            { open: '(', close: ')', token: 'delimiter.parenthesis' }
        ],

        tokenizer: {
            root: [
                { include: '@whitespace' },
                { include: '@comments' },
                { include: '@numbers' },
                { include: '@strings' },
                { include: '@parameters' },
                { include: '@recordIds' },

                [/[;,.]/, 'delimiter'],
                [/[{}()\[\]]/, 'delimiter'],

                [/[a-z_][\w]*(::[a-z_][\w]*)+/i, 'predefined'],

                [/[a-z_][\w]*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@operators': 'operator',
                        '@typeKeywords': 'type',
                        '@builtinFunctions': 'predefined',
                        '@default': 'identifier'
                    }
                }],

                [/[<>=!~*+\-\/%&|?]+/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': 'operator'
                    }
                }],
            ],

            whitespace: [
                [/\s+/, 'white']
            ],

            comments: [
                [/--.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/#.*$/, 'comment']
            ],

            comment: [
                [/[^\/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],

            numbers: [
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/\d+/, 'number'],
                [/\d+[smhdwy]/, 'number.duration'],
                [/\d+ms|µs|us|ns/, 'number.duration']
            ],

            strings: [
                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                [/'/, 'string', '@string_single'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, 'string', '@string_double'],
                [/`/, 'string', '@string_backtick']
            ],

            string_single: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, 'string', '@pop']
            ],

            string_double: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, 'string', '@pop']
            ],

            string_backtick: [
                [/[^\\`]+/, 'string'],
                [/\\./, 'string.escape'],
                [/`/, 'string', '@pop']
            ],

            recordIds: [
                [/[a-z_][\w]*:(?![:\w])[a-z0-9_]+/i, 'type.identifier'],
                [/[a-z_][\w]*:⟨[^⟩]+⟩/i, 'type.identifier'],
                [/[a-z_][\w]*:\[[^\]]+\]/i, 'type.identifier'],
                [/[a-z_][\w]*:\{[^}]+\}/i, 'type.identifier']
            ],

            parameters: [
                [/\$[a-z_][\w]*/i, 'variable.parameter']
            ]
        }
    });

    monaco.editor.defineTheme('vs-dark', {
        base: 'vs-dark',
        inherit: true,
        colors: {},
        rules: [
            { token: 'keyword.query', foreground: 'C586C0' },
            { token: 'keyword.operator', foreground: 'C586C0' },
            { token: 'keyword', foreground: '#ff009e' },
            { token: 'operator.comparison', foreground: '#ff9b67' },
            { token: 'operator.arithmetic', foreground: '#ff9b67' },
            { token: 'predefined', foreground: '#ff9b67' },
            { token: 'predefined.namespace', foreground: '#ff9b67' },
            { token: 'variable.parameter', foreground: '#ffd000' },
            { token: 'type', foreground: '4EC9B0' },
            { token: 'type.qualified', foreground: '4EC9B0' },
            { token: 'identifier', foreground: '#ffd000' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'number.float', foreground: 'B5CEA8' },
            { token: 'number.hex', foreground: 'B5CEA8' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'string.invalid', foreground: 'F44747' },
            { token: 'delimiter', foreground: 'D4D4D4' },
            { token: 'delimiter.parenthesis', foreground: 'FFD700' },
            { token: 'delimiter.bracket', foreground: 'FFD700' },
            { token: 'delimiter.colon', foreground: 'D4D4D4' },
            { token: 'delimiter.slash', foreground: 'D4D4D4' },
            { token: 'delimiter.ampersand', foreground: 'D4D4D4' }
        ]
    });
}
