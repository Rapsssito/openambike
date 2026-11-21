// semantic-release, run by hand on main through .github/workflows/release.yml. The commits since the last tag decide
// the version (Conventional Commits: fix → patch, feat → minor, a breaking change → major); the release commits the
// Android version file, CHANGELOG.md and F-Droid's changes of the version, tags it, and attaches the signed APK built
// from that same commit to a GitHub release, which F-Droid compares with its own build of the tag.
import { CHANGELOG_TITLE, RELEASE_BODY_TEMPLATE } from './app/scripts/release.js';

const APK = 'app/android/app/build/outputs/apk/release/app-release.apk';

export default {
    branches: ['main'],
    tagFormat: 'v${version}',
    plugins: [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        [
            '@semantic-release/exec',
            {
                prepareCmd: [
                    'node app/scripts/release.js version ${nextRelease.version}',
                    'npm run build --workspace=app',
                    '(cd app && npx cap sync android)',
                    '(cd app/android && ./gradlew --no-daemon assembleRelease)',
                ].join(' && '),
            },
        ],
        './app/scripts/release.js',
        ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md', changelogTitle: CHANGELOG_TITLE }],
        [
            '@semantic-release/git',
            {
                assets: [
                    'app/android/app/version.properties',
                    'CHANGELOG.md',
                    'fastlane/metadata/android/en-US/changelogs/*.txt',
                ],
                message: 'chore(release): ${nextRelease.version} [skip ci]',
            },
        ],
        [
            '@semantic-release/github',
            {
                assets: [{ path: APK, name: 'OpenAMBike-${nextRelease.version}.apk', label: 'OpenAMBike (Android)' }],
                releaseBodyTemplate: RELEASE_BODY_TEMPLATE,
                successComment: false,
                failComment: false,
            },
        ],
    ],
};
