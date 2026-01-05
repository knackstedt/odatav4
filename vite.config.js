// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from "vite-plugin-dts";

export default defineConfig(({ mode }) => ({
    plugins: [dts({ rollupTypes: true })],
    build: {
        minify: false,
        lib: {
            // Main entry point for the library
            entry: resolve(__dirname, 'src/main.ts'),
            name: 'ODataV4',
            // Output both ESM and CJS formats
            formats: ['es', 'cjs'],
            fileName: (format) => {
                if (format === 'es') return 'odatav4.js';
                if (format === 'cjs') return 'odatav4.cjs';
                return `odatav4.${format}.js`;
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
