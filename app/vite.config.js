import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';

import { licencesPlugin } from './scripts/licences.js';

/** The version a release writes for the Android build, shown in the app. */
const version = /^versionName=(.+)$/m.exec(
    readFileSync(new URL('android/app/version.properties', import.meta.url), 'utf8')
)?.[1];

export default defineConfig({
    define: { __APP_VERSION__: JSON.stringify(version ?? '') },
    plugins: [licencesPlugin()],
    server: { host: true, port: 8100, strictPort: true },
    preview: { host: true, port: 8100, strictPort: true },
    build: { outDir: 'dist', target: 'es2022' },
});
