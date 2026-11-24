import {
    changeThreshold,
    currentThresholds,
    DEFAULT_THRESHOLDS,
    isDefault,
    MIN_SIGNAL_GAP_DBM,
    normalizeThresholds,
    saveThresholds,
    THRESHOLD_FIELDS,
} from './thresholds.js';
import en from './i18n/en.json' with { type: 'json' };
import es from './i18n/es.json' with { type: 'json' };

/** A device's storage, as the browser gives it. */
function fakeStorage() {
    /** @type {Map<string, string>} */
    const items = new Map();
    return {
        getItem: (/** @type {string} */ key) => items.get(key) ?? null,
        setItem: (/** @type {string} */ key, /** @type {string} */ value) => void items.set(key, value),
        removeItem: (/** @type {string} */ key) => void items.delete(key),
    };
}

describe('the thresholds the rider can set', () => {
    beforeEach(() => {
        Object.assign(globalThis, { localStorage: fakeStorage() });
    });
    afterAll(() => {
        Reflect.deleteProperty(globalThis, 'localStorage');
    });

    test('the defaults', () => {
        expect(DEFAULT_THRESHOLDS).toEqual({
            nearDbm: -73,
            farDbm: -78,
            signalMs: 5_000,
            movementMs: 5_000,
            awayMs: 30_000,
            parkedMs: 900_000,
        });
        // Only these four are the rider's to set; the waits after a dropped connection and for standing still stay as code.
        expect(THRESHOLD_FIELDS.map((field) => field.key)).toEqual(['nearDbm', 'farDbm', 'signalMs', 'movementMs']);
    });

    test('each value the rider can set comes with its name, its explanation and its unit, in every language', () => {
        for (const { label, info, ends, unit } of THRESHOLD_FIELDS) {
            for (const texts of [en, es]) {
                for (const key of [label, info, ...(ends ?? [])]) expect(texts).toHaveProperty([key]);
            }
            expect(['dBm', 's']).toContain(unit);
        }
    });

    test('each default the rider can set lies within its limits, on its step', () => {
        for (const { key, min, max, step } of THRESHOLD_FIELDS) {
            const value = DEFAULT_THRESHOLDS[key];
            expect(value).toBeGreaterThanOrEqual(min);
            expect(value).toBeLessThanOrEqual(max);
            expect((value - min) % step).toBe(0);
        }
    });

    test('with nothing saved, the defaults apply, and changing nothing is the default', () => {
        expect(currentThresholds()).toEqual(DEFAULT_THRESHOLDS);
        expect(isDefault(currentThresholds())).toBe(true);
    });

    test('what is saved comes back, and only what differs from the default is kept', () => {
        saveThresholds({ ...DEFAULT_THRESHOLDS, signalMs: 8_000 });
        expect(currentThresholds()).toEqual({ ...DEFAULT_THRESHOLDS, signalMs: 8_000 });
        expect(JSON.parse(globalThis.localStorage.getItem('openambike.thresholds') ?? '')).toEqual({ signalMs: 8_000 });
        expect(isDefault(currentThresholds())).toBe(false);
    });

    test('saving the defaults forgets what was saved', () => {
        saveThresholds({ ...DEFAULT_THRESHOLDS, movementMs: 9_000 });
        saveThresholds(DEFAULT_THRESHOLDS);
        expect(globalThis.localStorage.getItem('openambike.thresholds')).toBeNull();
        expect(currentThresholds()).toEqual(DEFAULT_THRESHOLDS);
    });

    test('anything unusable saved falls back to the default, and a value is brought within its limits and step', () => {
        expect(normalizeThresholds({ signalMs: 'x', movementMs: null, nearDbm: Number.NaN })).toEqual(
            DEFAULT_THRESHOLDS
        );
        expect(normalizeThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
        const { min, max } = /** @type {NonNullable<typeof THRESHOLD_FIELDS[number]>} */ (
            THRESHOLD_FIELDS.find((field) => field.key === 'movementMs')
        );
        expect(normalizeThresholds({ movementMs: 1 }).movementMs).toBe(min);
        expect(normalizeThresholds({ movementMs: 99_999_999 }).movementMs).toBe(max);
        expect(normalizeThresholds({ signalMs: 5_400 }).signalMs).toBe(5_000);
    });

    test("the waits that are not the rider's to set stay as they are in the code, whatever was saved", () => {
        globalThis.localStorage.setItem('openambike.thresholds', JSON.stringify({ awayMs: 5_000, parkedMs: 60_000 }));
        expect(currentThresholds()).toEqual(DEFAULT_THRESHOLDS);
        saveThresholds({ ...DEFAULT_THRESHOLDS, awayMs: 5_000, parkedMs: 60_000 });
        expect(globalThis.localStorage.getItem('openambike.thresholds')).toBeNull();
    });

    test('a broken save leaves the defaults', () => {
        globalThis.localStorage.setItem('openambike.thresholds', '{not json');
        expect(currentThresholds()).toEqual(DEFAULT_THRESHOLDS);
    });

    test('letting go is always weaker than connecting, by at least the gap', () => {
        expect(MIN_SIGNAL_GAP_DBM).toBe(2);
        // Raising "connect" above "let go" pulls nothing; lowering it below pushes "let go" down with it.
        expect(changeThreshold(DEFAULT_THRESHOLDS, 'nearDbm', -85)).toMatchObject({ nearDbm: -85, farDbm: -87 });
        // Raising "let go" up to "connect" pushes "connect" up with it.
        expect(changeThreshold(DEFAULT_THRESHOLDS, 'farDbm', -70)).toMatchObject({ nearDbm: -68, farDbm: -70 });
        // Moving one within the gap changes nothing else.
        expect(changeThreshold(DEFAULT_THRESHOLDS, 'nearDbm', -60)).toEqual({ ...DEFAULT_THRESHOLDS, nearDbm: -60 });
    });

    test('at the end of the scale the other one stays within its limits, and the gap holds', () => {
        const near = /** @type {NonNullable<typeof THRESHOLD_FIELDS[number]>} */ (
            THRESHOLD_FIELDS.find((field) => field.key === 'nearDbm')
        );
        const far = /** @type {NonNullable<typeof THRESHOLD_FIELDS[number]>} */ (
            THRESHOLD_FIELDS.find((field) => field.key === 'farDbm')
        );
        const lowest = changeThreshold(DEFAULT_THRESHOLDS, 'nearDbm', near.min);
        expect(lowest.nearDbm - lowest.farDbm).toBeGreaterThanOrEqual(MIN_SIGNAL_GAP_DBM);
        expect(lowest.farDbm).toBeGreaterThanOrEqual(far.min);
        const highest = changeThreshold(DEFAULT_THRESHOLDS, 'farDbm', far.max);
        expect(highest.nearDbm - highest.farDbm).toBeGreaterThanOrEqual(MIN_SIGNAL_GAP_DBM);
        expect(highest.nearDbm).toBeLessThanOrEqual(near.max);
    });

    test('a saved pair that is too close is spread apart when read', () => {
        const { nearDbm, farDbm } = normalizeThresholds({ nearDbm: -80, farDbm: -79 });
        expect(nearDbm - farDbm).toBeGreaterThanOrEqual(MIN_SIGNAL_GAP_DBM);
    });
});
