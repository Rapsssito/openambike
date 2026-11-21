import {
    amountBytes,
    bikeUuid,
    CHARACTERISTIC,
    createIotStateReader,
    decodeAscii,
    decodeAsiMetrics,
    decodeAssistLevels,
    decodeAssistMode,
    decodeBattery,
    decodeBatteryExtended,
    decodeFirmwareVersion,
    decodeLights,
    decodeRange,
    decodeSwitch,
    encodeAssistLevels,
    encodeAssistMode,
    encodeIotStateRequest,
    encodeLights,
    encodeLock,
    encodeOwnerKey,
    encodeRestart,
    encodeSleep,
    encodeSwitch,
    encodeTorqueSensorCalibration,
    replaceAssistMode,
    isOwnerKey,
    isOwnerOk,
    SERVICE,
    speedByte,
} from './protocol.js';

/**
 * Bytes from hexadecimal written as in docs/protocol.md: `0a 1f 00`.
 * @param {string} text
 * @returns {Uint8Array}
 */
function hex(text) {
    return Uint8Array.from(text.split(' '), (byte) => parseInt(byte, 16));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

/** An owner key of the right form, anonymised as the protocol's quotes are: 28 characters. */
const ANONYMISED_KEY = 'A'.repeat(28);

describe('UUIDs', () => {
    test('a characteristic is built from its two distinguishing digits', () => {
        expect(bikeUuid('a6')).toBe('fa5b81a6-9b7b-452e-9a46-0a3313cbab03');
    });

    test('each characteristic belongs to the service the discovery of official-317 shows', () => {
        expect(CHARACTERISTIC.auth.service).toBe(SERVICE.auth);
        expect(CHARACTERISTIC.assistLevels.service).toBe(SERVICE.bike);
        expect(CHARACTERISTIC.stateManagement.service).toBe(SERVICE.owner);
        expect(CHARACTERISTIC.motorCalibration.service).toBe(SERVICE.owner);
    });
});

describe('authentication', () => {
    test('the owner key is written as its 28 ASCII bytes', () => {
        expect(encodeOwnerKey(ANONYMISED_KEY)).toEqual(new TextEncoder().encode(ANONYMISED_KEY));
    });

    test('a key of another length or with spaces is refused before anything is sent', () => {
        expect(isOwnerKey('A'.repeat(27))).toBe(false);
        expect(isOwnerKey(`${'A'.repeat(27)} `)).toBe(false);
        expect(() => encodeOwnerKey('short')).toThrow(RangeError);
    });

    test('official-317: the bike accepts the key with the text "owner ok"', () => {
        expect(isOwnerOk(hex('6f 77 6e 65 72 20 6f 6b'))).toBe(true);
    });

    test('any other answer is a failure', () => {
        expect(isOwnerOk(hex('6f 77 6e 65 72'))).toBe(false);
        expect(isOwnerOk(new Uint8Array())).toBe(false);
    });
});

describe('commands', () => {
    test('official-317: assist mode is one byte, 00, 01 or 02', () => {
        expect(toHex(encodeAssistMode(2))).toBe('02');
        expect(toHex(encodeAssistMode(0))).toBe('00');
        expect(toHex(encodeAssistMode(1))).toBe('01');
        expect(() => encodeAssistMode(3)).toThrow(RangeError);
    });

    test('official-317: lights on is 01 01, off is 01 00', () => {
        expect(toHex(encodeLights(true))).toBe('01 01');
        expect(toHex(encodeLights(false))).toBe('01 00');
    });

    test('official-317: lock is 01, unlock is 00', () => {
        expect(toHex(encodeLock(true))).toBe('01');
        expect(toHex(encodeLock(false))).toBe('00');
    });

    test('official-317: GNSS and GSM on are 01, off are 00', () => {
        expect(toHex(encodeSwitch(true))).toBe('01');
        expect(toHex(encodeSwitch(false))).toBe('00');
    });

    test('official-317: restart writes ASCII "reset" and sleep ASCII "shutdown"', () => {
        expect(toHex(encodeRestart())).toBe('72 65 73 65 74');
        expect(toHex(encodeSleep())).toBe('73 68 75 74 64 6f 77 6e');
    });

    test('official-317: the torque sensor calibration writes 00, never the motor calibration 01', () => {
        expect(toHex(encodeTorqueSensorCalibration())).toBe('00');
    });

    test('official-317: the IoT state request is 00', () => {
        expect(toHex(encodeIotStateRequest())).toBe('00');
    });
});

describe('assist levels', () => {
    test('official-317: speeds of 10, 17 and 25 km/h are 00, 77 and ff', () => {
        expect(speedByte(10)).toBe(0x00);
        expect(speedByte(17)).toBe(0x77);
        expect(speedByte(25)).toBe(0xff);
    });

    test("official-317 and the tests on the bike: amounts round as the bike's own app rounds them", () => {
        expect(toHex(Uint8Array.from(amountBytes(40)))).toBe('00 00');
        expect(toHex(Uint8Array.from(amountBytes(50)))).toBe('2b 2a');
        expect(toHex(Uint8Array.from(amountBytes(60)))).toBe('55 55');
        expect(toHex(Uint8Array.from(amountBytes(70)))).toBe('80 7f');
        expect(toHex(Uint8Array.from(amountBytes(75)))).toBe('95 95');
        expect(toHex(Uint8Array.from(amountBytes(100)))).toBe('ff ff');
    });

    test("nothing beyond the bike's maxima is encoded", () => {
        expect(() => speedByte(25.1)).toThrow(RangeError);
        expect(() => speedByte(9.9)).toThrow(RangeError);
        expect(() => speedByte(Number.NaN)).toThrow(RangeError);
        expect(() => amountBytes(101)).toThrow(RangeError);
        expect(() => amountBytes(39)).toThrow(RangeError);
    });

    test('official-317: 17 km/h and 70 % on mode 1, 25 km/h and 75 % on mode 2', () => {
        const bytes = encodeAssistLevels({ speedKmh: 17, amountPercent: 70 }, { speedKmh: 25, amountPercent: 75 });
        expect(toHex(bytes)).toBe('77 80 7f ff 95 95');
    });

    test('on the bike: mode 2 at 25 km/h and 70 %, mode 1 unchanged', () => {
        const bytes = encodeAssistLevels({ speedKmh: 25, amountPercent: 50 }, { speedKmh: 25, amountPercent: 70 });
        expect(toHex(bytes)).toBe('ff 2b 2a ff 80 7f');
    });

    test('official-317: the 8 bytes read decode to both modes, the last two ignored', () => {
        expect(decodeAssistLevels(hex('ff 2b 2a ff 95 95 00 00'))).toEqual({
            mode1: { speedKmh: 25, powerPercent: 50, gainPercent: 50 },
            mode2: { speedKmh: 25, powerPercent: 75, gainPercent: 75 },
        });
        expect(decodeAssistLevels(hex('77 80 7f ff 95 95 00 00')).mode1).toEqual({
            speedKmh: 17,
            powerPercent: 70,
            gainPercent: 70,
        });
    });

    test('on the bike: changing mode 2 to 25 km/h and 60 % keeps the 3 bytes of mode 1 as read', () => {
        const current = hex('ff 2b 2a ff 95 95 00 00');
        expect(toHex(replaceAssistMode(current, 2, { speedKmh: 25, amountPercent: 60 }))).toBe('ff 2b 2a ff 55 55');
        expect(toHex(replaceAssistMode(hex('ff 01 07 ff 95 95'), 2, { speedKmh: 20, amountPercent: 70 }))).toBe(
            'ff 01 07 aa 80 7f'
        );
    });

    test('official-317: changing mode 1 to 17 km/h and 70 %', () => {
        expect(toHex(replaceAssistMode(hex('ff 2b 2a ff 95 95 00 00'), 1, { speedKmh: 17, amountPercent: 70 }))).toBe(
            '77 80 7f ff 95 95'
        );
    });

    test('a mode other than 1 or 2, a short read or values beyond the maxima are refused', () => {
        const current = hex('ff 2b 2a ff 95 95 00 00');
        expect(() =>
            replaceAssistMode(current, /** @type {1} */ (/** @type {unknown} */ (3)), {
                speedKmh: 20,
                amountPercent: 50,
            })
        ).toThrow(RangeError);
        expect(() => replaceAssistMode(hex('ff 2b 2a'), 1, { speedKmh: 20, amountPercent: 50 })).toThrow(RangeError);
        expect(() => replaceAssistMode(current, 1, { speedKmh: 30, amountPercent: 50 })).toThrow(RangeError);
    });

    test('decoding what was encoded gives back each mode', () => {
        for (let speedKmh = 10; speedKmh <= 25; speedKmh++) {
            for (let amountPercent = 40; amountPercent <= 100; amountPercent += 5) {
                const levels = decodeAssistLevels(
                    encodeAssistLevels({ speedKmh, amountPercent }, { speedKmh, amountPercent })
                );
                expect(levels.mode2).toEqual({ speedKmh, powerPercent: amountPercent, gainPercent: amountPercent });
            }
        }
    });
});

describe('values read or notified', () => {
    test('official-317: assist mode is byte 0 of four', () => {
        expect(decodeAssistMode(hex('02 00 00 00'))).toBe(2);
    });

    test('official-317: the lights reply 0a 01 is on, 0a 00 off', () => {
        expect(decodeLights(hex('0a 01'))).toBe(true);
        expect(decodeLights(hex('0a 00'))).toBe(false);
    });

    test('official-317: lock, GNSS and GSM are one byte', () => {
        expect(decodeSwitch(hex('01'))).toBe(true);
        expect(decodeSwitch(hex('00'))).toBe(false);
    });

    test('official-317: battery standing, 51.194 V, +58 mA, 74 %', () => {
        expect(decodeBattery(hex('fa c7 00 00 3a 00 4a 64 77 03 00'))).toEqual({
            volts: 51.194,
            milliamps: 58,
            percent: 74,
            absoluteSoc: 227172,
        });
    });

    test('ride-charge: riding, the battery discharges at +915 mA', () => {
        expect(decodeBattery(hex('d2 c5 00 00 93 03 48 65 67 03 00'))).toEqual({
            volts: 50.642,
            milliamps: 915,
            percent: 72,
            absoluteSoc: 223077,
        });
    });

    test('ride-charge: on the charger, the current is negative', () => {
        expect(decodeBattery(hex('1c cc 00 00 ad f4 48 fb 67 03 00'))).toEqual({
            volts: 52.252,
            milliamps: -2899,
            percent: 72,
            absoluteSoc: 223227,
        });
    });

    test('a battery frame of 8 to 10 bytes has no absolute state of charge; a shorter one is refused', () => {
        expect(decodeBattery(hex('fa c7 00 00 3a 00 4a 64')).absoluteSoc).toBeNull();
        expect(() => decodeBattery(hex('fa c7 00 00 3a 00 4a'))).toThrow(RangeError);
    });

    test('official-317: 81 cycles, and pack temperatures of 22.5 °C and 23.3 °C', () => {
        expect(decodeBatteryExtended(hex('51 00 e1 00 e9 00 ff ff 00 00 8f 00'))).toEqual({
            cycles: 81,
            packTemperaturesC: [22.5, 23.3],
        });
    });

    test('official-317: standing, odometer 3774.23 km and nothing else', () => {
        expect(decodeAsiMetrics(hex('4f c2 05 00 00 00 00 00 00 00 00 00'))).toEqual({
            odometerKm: 3774.23,
            motorWatts: 0,
            speedKmh: 0,
            riderWatts: 0,
        });
    });

    test('ride-charge: riding at 14 km/h, motor 41 W, rider about 96 W', () => {
        const metrics = decodeAsiMetrics(hex('55 c2 05 00 29 00 8c 00 33 00 12 00'));
        expect(metrics.odometerKm).toBe(3774.29);
        expect(metrics.motorWatts).toBe(41);
        expect(metrics.speedKmh).toBe(14);
        expect(metrics.riderWatts).toBeCloseTo((51 * 18) / 9.5488, 6);
    });

    test('ride-charge: one factor of the rider power alone gives 0 W', () => {
        expect(decodeAsiMetrics(hex('56 c2 05 00 00 00 85 00 df 03 00 00')).riderWatts).toBe(0);
    });

    test('official-317: range is one byte', () => {
        expect(decodeRange(hex('40'))).toBe(64);
    });

    test('official-317: firmware version, then two commit identifiers, ended by 00', () => {
        const bytes = Uint8Array.from([...new TextEncoder().encode('v3.9.0 1e774d1c f551786850'), 0]);
        expect(decodeFirmwareVersion(bytes)).toEqual({ version: 'v3.9.0', commits: ['1e774d1c', 'f551786850'] });
    });

    test('official-317: battery firmware status is ASCII', () => {
        expect(decodeAscii(new TextEncoder().encode('Up to date'))).toBe('Up to date');
    });
});

describe('IoT state', () => {
    // Built in the format official-317 shows (JSON in notifications of up to 50 bytes, then EOM), with invented
    // values: the real state holds the owner key, the serial number and the position.
    const state = { settings: { assist_mode: 1, lock: false }, battery: { range: 64, serial_number: 'SERIAL' } };
    const text = JSON.stringify(state);
    /** @type {Uint8Array[]} */
    const chunks = [];
    for (let at = 0; at < text.length; at += 50) chunks.push(new TextEncoder().encode(text.slice(at, at + 50)));

    test('the parts are joined and parsed at EOM', () => {
        const reader = createIotStateReader();
        for (const chunk of chunks) expect(reader.push(chunk)).toBeNull();
        expect(reader.push(new TextEncoder().encode('EOM'))).toEqual(state);
    });

    test('a reader starts afresh after each state', () => {
        const reader = createIotStateReader();
        for (const chunk of chunks) reader.push(chunk);
        reader.push(new TextEncoder().encode('EOM'));
        for (const chunk of chunks) reader.push(chunk);
        expect(reader.push(new TextEncoder().encode('EOM'))).toEqual(state);
    });
});
