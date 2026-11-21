import { DEFAULT_RATED_WH, fullCapacityWh, healthPercent, isRatedWh } from './battery-health.js';

/** The battery frame of the official-317 capture: 51.194 V, 58 mA, 74 %, 227 172 mWh. */
const BATTERY = { volts: 51.194, milliamps: 58, percent: 74, absoluteSoc: 227172 };

describe('battery health', () => {
    test('official-317: 227 172 mWh at 74 % is about 307 Wh when full, 91 % of 336 Wh', () => {
        expect(fullCapacityWh(BATTERY)).toBeCloseTo(307.0, 1);
        expect(healthPercent(BATTERY, 336)).toBeCloseTo(91.4, 1);
    });

    test('below 30 %, or with no absolute state of charge, there is no estimate', () => {
        expect(fullCapacityWh({ ...BATTERY, percent: 29 })).toBeNull();
        expect(fullCapacityWh({ ...BATTERY, absoluteSoc: null })).toBeNull();
        expect(healthPercent(null, 336)).toBeNull();
    });

    test('health is at most 100 %', () => {
        expect(healthPercent({ ...BATTERY, absoluteSoc: 300000, percent: 80 }, 336)).toBe(100);
    });

    test('336 Wh by default; a typed capacity is a whole number from 100 to 2000 Wh', () => {
        expect(DEFAULT_RATED_WH).toBe(336);
        expect(isRatedWh(500)).toBe(true);
        expect(isRatedWh(99)).toBe(false);
        expect(isRatedWh(2001)).toBe(false);
        expect(isRatedWh(336.5)).toBe(false);
        expect(isRatedWh(Number.NaN)).toBe(false);
    });
});
