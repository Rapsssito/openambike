import { CHANGELOG_TITLE, RELEASE_BODY_TEMPLATE, versionCode, versionProperties } from './release.js';

describe('the Android version of a release', () => {
    test('versionCode grows with every release', () => {
        expect(versionCode('0.1.0')).toBe(1_000);
        expect(versionCode('1.0.0')).toBe(1_000_000);
        expect(versionCode('1.2.3')).toBe(1_002_003);
        expect(versionCode('1.10.0')).toBeGreaterThan(versionCode('1.9.999'));
        expect(versionCode('2.0.0')).toBeGreaterThan(versionCode('1.999.999'));
    });

    test('a version that is not a plain release is refused', () => {
        expect(() => versionCode('1.0.0-beta.1')).toThrow(RangeError);
        expect(() => versionCode('1.1000.0')).toThrow(RangeError);
    });

    test('the version file holds both values', () => {
        expect(versionProperties('1.2.3')).toBe('versionCode=1002003\nversionName=1.2.3\n');
    });

    test('every release page says the app is unofficial, after its changes', () => {
        expect(RELEASE_BODY_TEMPLATE.startsWith('<%= nextRelease.notes %>')).toBe(true);
        expect(RELEASE_BODY_TEMPLATE).toContain('Not affiliated with or endorsed by Ampler Bikes OÜ.');
        expect(RELEASE_BODY_TEMPLATE).toContain('OpenAMBike-<%= nextRelease.version %>.apk');
    });

    test('the changelog says it once, under its title', () => {
        expect(CHANGELOG_TITLE.startsWith('# Changelog\n\n')).toBe(true);
        expect(CHANGELOG_TITLE).toContain('Not affiliated with or endorsed by Ampler Bikes OÜ.');
    });
});
