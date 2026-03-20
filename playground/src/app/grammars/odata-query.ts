import type * as Monaco from 'monaco-editor';

export function init(monaco: typeof Monaco) {
    monaco.languages.register({ id: 'odata-query' });

    monaco.languages.setMonarchTokensProvider('odata-query', {
        defaultToken: "invalid",
        tokenPostfix: ".odq",
        ignoreCase: false,

        queryOptions: [
            '$filter', '$select', '$expand', '$orderby', '$top', '$skip',
            '$count', '$search', '$format', '$compute', '$apply',
            '$skiptoken', '$deltatoken', '$schemaversion', '$index'
        ],

        logicalOperators: [
            'and', 'or', 'not'
        ],

        comparisonOperators: [
            'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'has', 'in'
        ],

        arithmeticOperators: [
            'add', 'sub', 'mul', 'div', 'mod'
        ],

        functions: [
            'contains', 'endswith', 'startswith', 'length', 'indexof', 'substring',
            'tolower', 'toupper', 'trim', 'concat',
            'year', 'month', 'day', 'hour', 'minute', 'second', 'fractionalseconds',
            'date', 'time', 'totaloffsetminutes', 'now', 'maxdatetime', 'mindatetime',
            'totalseconds',
            'round', 'floor', 'ceiling',
            'cast', 'isof',
            'geo.distance', 'geo.length', 'geo.intersects',
            'any', 'all'
        ],

        keywords: [
            'null', 'true', 'false', 'asc', 'desc', 'from'
        ],

        typeKeywords: [
            'Edm.Binary', 'Edm.Boolean', 'Edm.Byte', 'Edm.Date', 'Edm.DateTimeOffset',
            'Edm.Decimal', 'Edm.Double', 'Edm.Duration', 'Edm.Guid', 'Edm.Int16',
            'Edm.Int32', 'Edm.Int64', 'Edm.SByte', 'Edm.Single', 'Edm.Stream',
            'Edm.String', 'Edm.TimeOfDay', 'Edm.Geography', 'Edm.Geometry'
        ],

        brackets: [
            { open: '(', close: ')', token: 'delimiter.parenthesis' },
            { open: '[', close: ']', token: 'delimiter.bracket' }
        ],

        tokenizer: {
            root: [
                { include: '@whitespace' },
                { include: '@numbers' },
                { include: '@strings' },
                { include: '@identifiers' },

                [/[,;]/, 'delimiter'],
                [/[()[\]]/, '@brackets'],
                [/[:]/, 'delimiter.colon'],
                [/[\/]/, 'delimiter.slash'],

                [/[+\-*%]/, 'operator.arithmetic'],
                [/[=!<>]/, 'operator.comparison'],
                [/&/, 'delimiter.ampersand']
            ],

            whitespace: [
                [/\s+/, 'white']
            ],

            numbers: [
                [/-?\d+\.\d+([eE][+-]?\d+)?[fFdDmM]?/, 'number.float'],
                [/-?\d+[lL]?/, 'number'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex']
            ],

            strings: [
                [/'([^']|'')*'/, 'string'],
                [/'([^']|'')*$/, 'string.invalid']
            ],

            identifiers: [
                [/\$[a-z][a-z0-9]*/, {
                    cases: {
                        '@queryOptions': 'keyword.query',
                        '@default': 'identifier'
                    }
                }],

                [/[a-z_][a-zA-Z0-9_]*::[a-z_][a-zA-Z0-9_]*/i, 'predefined.namespace'],

                [/[a-z_][a-zA-Z0-9_]*\/[a-z_][a-zA-Z0-9.]*/i, 'type.qualified'],

                [/Edm\.[A-Z][a-zA-Z0-9]*/, {
                    cases: {
                        '@typeKeywords': 'type',
                        '@default': 'type'
                    }
                }],

                [/[a-z_][a-zA-Z0-9_.]*/, {
                    cases: {
                        '@logicalOperators': 'keyword.operator',
                        '@comparisonOperators': 'operator.comparison',
                        '@arithmeticOperators': 'operator.arithmetic',
                        '@functions': 'predefined',
                        '@keywords': 'keyword',
                        '@default': 'identifier'
                    }
                }]
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
            { token: 'predefined', foreground: 'DCDCAA' },
            { token: 'predefined.namespace', foreground: 'DCDCAA' },
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
        ],
    });
}
