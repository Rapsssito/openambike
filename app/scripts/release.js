// What a release adds to semantic-release (release.config.js): the Android version, written by
//   node app/scripts/release.js version <version>
// through @semantic-release/exec; the texts of the release page and of CHANGELOG.md beside the changes; and, as a
// plugin of its own (prepare, below), the changes in F-Droid's words, committed with the release.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the Android build reads its version; F-Droid reads it there too. */
export const VERSION_FILE = fileURLToPath(new URL('../android/app/version.properties', import.meta.url));

/**
 * The Android versionCode of a semantic version, which grows with every release: major × 1 000 000 + minor × 1 000 +
 * patch.
 * @param {string} version
 * @returns {number}
 */
export function versionCode(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) throw new RangeError(`Not a release version: ${version}`);
    const [major, minor, patch] = match.slice(1).map(Number);
    if (minor > 999 || patch > 999 || major > 2099) throw new RangeError(`Version out of range: ${version}`);
    return major * 1_000_000 + minor * 1_000 + patch;
}

/**
 * The contents of the version file for a release.
 * @param {string} version
 * @returns {string}
 */
export function versionProperties(version) {
    return `versionCode=${versionCode(version)}\nversionName=${version}\n`;
}

/** What every public description says (docs/safety.md, "Name and trademark"). */
export const DISCLAIMER =
    'Unofficial, open-source companion app for Ampler e-bikes. Not affiliated with or endorsed by Ampler Bikes OÜ.';

/**
 * The body of each GitHub release: its changes, then the disclaimer and how to install it. A Lodash template, which
 * @semantic-release/github fills in.
 */
export const RELEASE_BODY_TEMPLATE = [
    '<%= nextRelease.notes %>',
    '',
    '---',
    '',
    DISCLAIMER,
    '',
    'Install `OpenAMBike-<%= nextRelease.version %>.apk` on an Android phone (Android 7 or later). Every release is signed with the same key, so a new one installs over the last.',
].join('\n');

/** The top of CHANGELOG.md, above the releases' changes, which say the disclaimer no more. */
export const CHANGELOG_TITLE = `# Changelog\n\n${DISCLAIMER}`;

/** Where F-Droid reads each version's changes, as `<versionCode>.txt`. */
export const FDROID_CHANGELOGS = fileURLToPath(
    new URL('../../fastlane/metadata/android/en-US/changelogs/', import.meta.url)
);

/** The longest changes F-Droid shows, in characters. */
export const FDROID_CHANGELOG_LIMIT = 500;

/** Where the changes go on when they are longer than F-Droid shows. */
const CHANGELOG_URL = 'https://github.com/Rapsssito/openambike/blob/main/CHANGELOG.md';

/**
 * A release's notes, as semantic-release writes them in Markdown, in the plain text F-Droid shows: no title, no links,
 * a line per change, and at most FDROID_CHANGELOG_LIMIT characters, the rest left to CHANGELOG.md.
 * @param {string} notes
 * @returns {string}
 */
export function fdroidChangelog(notes) {
    const lines = notes
        .split('\n')
        .filter((line) => !/^#{1,2} /.test(line))
        .map((line) =>
            line
                .replace(/^#{3,} (.*)$/, '$1:')
                .replace(/^\* /, '- ')
                .replace(/\*\*([^*]+):\*\* /g, '')
                .replace(/ \(\[[0-9a-f]{7,}\]\([^)]*\)\)/g, '')
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .trimEnd()
        )
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .split('\n');
    const more = `More in ${CHANGELOG_URL}`;
    let text = lines.join('\n');
    while (text.length + 1 > FDROID_CHANGELOG_LIMIT) {
        lines.pop();
        text = `${lines.join('\n').trimEnd()}\n${more}`;
    }
    return `${text}\n`;
}

/**
 * The prepare step of semantic-release, which loads this file as a plugin: writes the release's changes for F-Droid.
 * @param {unknown} _pluginConfig
 * @param {{ nextRelease: { version: string, notes?: string } }} context
 */
export function prepare(_pluginConfig, { nextRelease }) {
    mkdirSync(FDROID_CHANGELOGS, { recursive: true });
    writeFileSync(
        `${FDROID_CHANGELOGS}${versionCode(nextRelease.version)}.txt`,
        fdroidChangelog(nextRelease.notes ?? '')
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [command, version] = process.argv.slice(2);
    if (command === 'version' && version) {
        writeFileSync(VERSION_FILE, versionProperties(version));
    } else {
        console.error('Usage: node app/scripts/release.js version <version>');
        process.exit(2);
    }
}
