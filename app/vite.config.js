import { defineConfig } from 'vite';

export default defineConfig({
    server: { host: true, port: 8100, strictPort: true },
    preview: { host: true, port: 8100, strictPort: true },
    build: { outDir: 'dist', target: 'es2022' },
});
