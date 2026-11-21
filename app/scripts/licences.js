// The licences of everything the app ships, for its "Open-source licences" screen: the app's own, every library in the
// app's production dependencies with the licence text it ships, and the Android libraries the native build adds, which
// npm does not list. A Vite plugin hands them to the app as the module `virtual:licences`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} Licence
 * @property {string} name
 * @property {string} version
 * @property {string} licence an SPDX identifier
 * @property {string} text
 */

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIRTUAL_ID = 'virtual:licences';

/**
 * Libraries of the Android build that come from Gradle, not npm, all under the Apache License 2.0: what
 * `android/app/build.gradle` and the Capacitor plugins' own `build.gradle` files depend on.
 */
export const ANDROID_LIBRARIES = [
    'AndroidX Activity',
    'AndroidX AppCompat',
    'AndroidX CoordinatorLayout',
    'AndroidX Core',
    'AndroidX Core KTX',
    'AndroidX Core SplashScreen',
    'AndroidX Fragment',
    'AndroidX WebKit',
    'Apache Cordova Android',
    'Kotlin Standard Library',
];

/**
 * The licence of a package: its file LICENSE, LICENCE or COPYING, with or without an extension; or, for a package that
 * ships none, the section of its README headed "License" or "Licence", up to the next heading.
 * @param {string} dir
 * @returns {string}
 */
function licenceText(dir) {
    const names = readdirSync(dir);
    const file = names.find((name) => /^(licen[cs]e|copying)(\.(txt|md))?$/i.test(name));
    if (file) return readFileSync(join(dir, file), 'utf8').trim();
    const readme = names.find((name) => /^readme(\.(md|markdown|txt))?$/i.test(name));
    if (!readme) return '';
    const section = /^#+\s*licen[cs]e\b[^\n]*\n([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(
        readFileSync(join(dir, readme), 'utf8')
    );
    return section ? section[1].trim() : '';
}

/**
 * @param {string} name
 * @param {string} from the directory of the package that depends on it
 * @returns {string | null} the directory of the package, as Node resolves it from there
 */
function packageDir(name, from) {
    for (let dir = from; ; dir = dirname(dir)) {
        try {
            const file = join(dir, 'node_modules', name, 'package.json');
            readFileSync(file);
            return dirname(file);
        } catch {
            if (dirname(dir) === dir) return null;
        }
    }
}

/**
 * @param {string} [appDir]
 * @returns {Licence[]} the app first, then the libraries by name
 */
export function collectLicences(appDir = APP_DIR) {
    const app = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    /** @type {Map<string, Licence>} */
    const libraries = new Map();
    /**
     * @param {string} name
     * @param {string} from
     */
    const visit = (name, from) => {
        const dir = packageDir(name, from);
        if (!dir) return;
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const id = `${pkg.name}@${pkg.version}`;
        if (libraries.has(id)) return;
        libraries.set(id, { name: pkg.name, version: pkg.version, licence: pkg.license ?? '', text: licenceText(dir) });
        for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, dir);
    };
    for (const dependency of Object.keys(app.dependencies ?? {})) visit(dependency, appDir);

    const apache = readFileSync(join(APP_DIR, 'scripts', 'apache-2.0.txt'), 'utf8').trim();
    const android = ANDROID_LIBRARIES.map((name) => ({ name, version: '', licence: 'Apache-2.0', text: apache }));
    const own = {
        name: 'OpenAMBike',
        version: '',
        licence: app.license,
        text: readFileSync(join(appDir, '..', 'LICENSE'), 'utf8').trim(),
    };
    const sorted = [...libraries.values(), ...android].sort((a, b) => a.name.localeCompare(b.name));
    return [own, ...sorted];
}

/** @returns {import('vite').Plugin} */
export function licencesPlugin() {
    return {
        name: 'openambike-licences',
        resolveId: (id) => (id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : null),
        load(id) {
            if (id !== `\0${VIRTUAL_ID}`) return null;
            // Many libraries share a licence text: each text is written once.
            const licences = collectLicences();
            const texts = [...new Set(licences.map((l) => l.text))];
            const entries = licences.map((l) => ({ ...l, text: texts.indexOf(l.text) }));
            return `const texts = ${JSON.stringify(texts)};
export default ${JSON.stringify(entries)}.map((l) => ({ ...l, text: texts[l.text] }));`;
        },
    };
}
