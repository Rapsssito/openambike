import { ANDROID_LIBRARIES, collectLicences } from './licences.js';

describe('licences', () => {
    const licences = collectLicences();

    test("the app's own licence comes first", () => {
        expect(licences[0]).toMatchObject({ name: 'OpenAMBike', licence: 'AGPL-3.0-only' });
        expect(licences[0].text).toMatch(/GNU AFFERO GENERAL PUBLIC LICENSE/);
    });

    test('every production dependency, and what it depends on, is listed with its licence text', () => {
        const names = licences.map((l) => l.name);
        expect(names).toEqual(expect.arrayContaining(['@ionic/core', '@capacitor/core', 'ionicons', '@stencil/core']));
        for (const licence of licences) expect(licence.text.length).toBeGreaterThan(100);
    });

    test('the Android libraries from Gradle are listed under the Apache License 2.0', () => {
        for (const name of ANDROID_LIBRARIES) {
            expect(licences.find((l) => l.name === name)).toMatchObject({ licence: 'Apache-2.0' });
        }
    });
});
