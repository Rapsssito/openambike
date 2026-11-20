// What a release adds to semantic-release (release.config.js): the Android version, written by
//   node app/scripts/release.js version <version>
// through @semantic-release/exec, and the texts of the release page and of CHANGELOG.md beside the changes.
import { writeFileSync } from 'node:fs';
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [command, version] = process.argv.slice(2);
    if (command === 'version' && version) {
        writeFileSync(VERSION_FILE, versionProperties(version));
    } else {
        console.error('Usage: node app/scripts/release.js version <version>');
        process.exit(2);
    }
}
