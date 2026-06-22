// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from "vite-plugin-dts";

export default defineConfig(({ mode }) => ({
    plugins: [dts({ rollupTypes: true })],
    build: {
        minify: false,
        lib: {
            // Multiple entry points: main (parser/utils) and express middleware
            entry: {
                main: resolve(__dirname, 'src/main.ts'),
                express: resolve(__dirname, 'src/express.ts'),
            },
            name: 'ODataV4',
            // Output both ESM and CJS formats
            formats: ['es', 'cjs'],
            fileName: (format, entryName) => {
                const name = entryName === 'main' ? 'odatav4' : entryName;
                if (format === 'es') return `${name}.js`;
                if (format === 'cjs') return `${name}.cjs`;
                return `${name}.${format}.js`;
            }
        },
        sourcemap: true,
        target: 'node18',
        // Externalize dependencies that shouldn't be bundled
        rollupOptions: {
            external: [
                /^node:.*/,  // Node built-ins
                'express',   // Peer dependencies
                'surrealdb'
            ]
        }
    }
}));
