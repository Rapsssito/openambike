// Encoding and decoding of the bike's BLE values, as docs/protocol.md specifies them. Pure functions: no Bluetooth, no
// interface, no storage, so that the tests run on captured frames alone. Multi-byte values are little-endian.

const UUID_SUFFIX = '-9b7b-452e-9a46-0a3313cbab03';

/**
 * Full UUID of one of the bike's services or characteristics, from the two hexadecimal digits that tell them apart.
 * @param {string} id two hexadecimal digits, such as `a6` for `fa5b81a6-…`
 * @returns {string}
 */
export function bikeUuid(id) {
    return `fa5b81${id}${UUID_SUFFIX}`;
}

/** Services, as the official app names them. */
export const SERVICE = Object.freeze({
    auth: bikeUuid('a0'),
    bike: bikeUuid('a1'),
    owner: bikeUuid('c0'),
});

/** Characteristics the app reads, writes or subscribes to, each with the service that holds it. */
export const CHARACTERISTIC = Object.freeze({
    auth: { service: SERVICE.auth, uuid: bikeUuid('a0') },
    gnssEnabled: { service: SERVICE.bike, uuid: bikeUuid('a2') },
    assistMode: { service: SERVICE.bike, uuid: bikeUuid('a3') },
    assistLevels: { service: SERVICE.bike, uuid: bikeUuid('a4') },
    lights: { service: SERVICE.bike, uuid: bikeUuid('a5') },
    battery: { service: SERVICE.bike, uuid: bikeUuid('a6') },
    firmwareVersion: { service: SERVICE.bike, uuid: bikeUuid('a7') },
    lock: { service: SERVICE.bike, uuid: bikeUuid('a8') },
    batteryExtended: { service: SERVICE.bike, uuid: bikeUuid('ac') },
    gsmEnabled: { service: SERVICE.bike, uuid: bikeUuid('ad') },
    asiMetrics: { service: SERVICE.bike, uuid: bikeUuid('b0') },
    range: { service: SERVICE.bike, uuid: bikeUuid('b1') },
    reset: { service: SERVICE.bike, uuid: bikeUuid('b2') },
    stateManagement: { service: SERVICE.owner, uuid: bikeUuid('c4') },
    iotState: { service: SERVICE.owner, uuid: bikeUuid('c7') },
    batteryFirmwareStatus: { service: SERVICE.owner, uuid: bikeUuid('c8') },
    motorCalibration: { service: SERVICE.owner, uuid: bikeUuid('d2') },
});

/** Prefix of the name the bike gives in its scan response (`AMPLER3` on a Stellar of 2022). */
export const NAME_PREFIX = 'AMPLER';

// Authentication.

/** Length of the owner key: the 28-character identifier of the owner's account. */
export const OWNER_KEY_LENGTH = 28;

/**
 * Whether a text has the form of an owner key: 28 characters of printable ASCII.
 * @param {string} key
 * @returns {boolean}
 */
export function isOwnerKey(key) {
    return key.length === OWNER_KEY_LENGTH && /^[\x21-\x7e]+$/.test(key);
}

/**
 * Bytes written to auth to authenticate: the owner key as ASCII.
 * @param {string} key
 * @returns {Uint8Array}
 */
export function encodeOwnerKey(key) {
    if (!isOwnerKey(key)) throw new RangeError(`An owner key is ${OWNER_KEY_LENGTH} characters of printable ASCII.`);
    return new TextEncoder().encode(key);
}

/**
 * Whether the bike's answer on auth accepts the key: the ASCII text `owner ok`. Any other answer is a failure.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isOwnerOk(bytes) {
    return decodeAscii(bytes) === 'owner ok';
}

// Commands.

/** Assist modes: none, and the owner's two configurable modes. */
export const ASSIST_MODES = Object.freeze([0, 1, 2]);

/**
 * @param {number} mode 0 for no assist, 1 or 2 for the owner's modes
 * @returns {Uint8Array}
 */
export function encodeAssistMode(mode) {
    if (!ASSIST_MODES.includes(mode)) throw new RangeError('The assist mode is 0, 1 or 2.');
    return Uint8Array.of(mode);
}

/**
 * Lights on or off. Byte 0 is always `01`, as the official app writes it; its meaning is unknown.
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function encodeLights(on) {
    return Uint8Array.of(0x01, on ? 0x01 : 0x00);
}

/**
 * Lock or unlock. Locked, the bike neither turns on nor assists from its own button.
 * @param {boolean} locked
 * @returns {Uint8Array}
 */
export function encodeLock(locked) {
    return Uint8Array.of(locked ? 0x01 : 0x00);
}

/**
 * GNSS or GSM on or off.
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function encodeSwitch(on) {
    return Uint8Array.of(on ? 0x01 : 0x00);
}

/**
 * Written to reset: the bike restarts its firmware and keeps its settings.
 * @returns {Uint8Array}
 */
export function encodeRestart() {
    return new TextEncoder().encode('reset');
}

/**
 * Written to state management: the bike turns all its electronics off until the charger is attached.
 * @returns {Uint8Array}
 */
export function encodeSleep() {
    return new TextEncoder().encode('shutdown');
}

/**
 * Written to motor calibration: recalibrates the torque sensor. Only this value is ever written there; `01`, the
 * factory motor calibration that spins the rear wheel, is never sent.
 * @returns {Uint8Array}
 */
export function encodeTorqueSensorCalibration() {
    return Uint8Array.of(0x00);
}

/**
 * Written to IoT state: asks the bike for its state as JSON.
 * @returns {Uint8Array}
 */
export function encodeIotStateRequest() {
    return Uint8Array.of(0x00);
}

// Assist levels.

/** Limits of the assist speed and assist amount the bike accepts; the bike's own maxima are never exceeded. */
export const ASSIST_LIMITS = Object.freeze({ minSpeedKmh: 10, maxSpeedKmh: 25, minPercent: 40, maxPercent: 100 });

/**
 * @typedef {object} AssistLevel
 * @property {number} speedKmh assist speed, 10 to 25 km/h
 * @property {number} powerPercent motor power, 40 to 100 %
 * @property {number} gainPercent gain, 40 to 100 %
 */

/**
 * @param {number} value
 * @returns {number}
 */
function roundHalfUp(value) {
    return Math.floor(value + 0.5);
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampByte(value) {
    return Math.max(0, Math.min(255, value));
}

/**
 * Speed byte of an assist speed: (km/h − 10) × 17.
 * @param {number} kmh 10 to 25
 * @returns {number}
 */
export function speedByte(kmh) {
    const { minSpeedKmh, maxSpeedKmh } = ASSIST_LIMITS;
    if (!(kmh >= minSpeedKmh && kmh <= maxSpeedKmh)) {
        throw new RangeError(`The assist speed is ${minSpeedKmh} to ${maxSpeedKmh} km/h.`);
    }
    return clampByte(roundHalfUp((kmh - minSpeedKmh) * 17));
}

/**
 * Power byte and gain byte of an assist amount, which sets both to the same percent. They are computed in the order
 * the bike's own app computes them, so that they round as it does: 50 % gives `2b 2a`.
 * @param {number} percent 40 to 100
 * @returns {[number, number]}
 */
export function amountBytes(percent) {
    const { minPercent, maxPercent } = ASSIST_LIMITS;
    if (!(percent >= minPercent && percent <= maxPercent)) {
        throw new RangeError(`The assist amount is ${minPercent} to ${maxPercent} %.`);
    }
    const share = (percent - minPercent) / (maxPercent - minPercent);
    return [clampByte(roundHalfUp(share * 150 * 1.7)), clampByte(roundHalfUp(share * 100 * 2.55))];
}

/**
 * @typedef {object} AssistSetting
 * @property {number} speedKmh assist speed, 10 to 25 km/h
 * @property {number} amountPercent assist amount, 40 to 100 %
 */

/**
 * The 6 bytes written to assist levels: speed, power and gain of mode 1, then of mode 2.
 * @param {AssistSetting} mode1
 * @param {AssistSetting} mode2
 * @returns {Uint8Array}
 */
export function encodeAssistLevels(mode1, mode2) {
    return Uint8Array.from(
        [mode1, mode2].flatMap((mode) => [speedByte(mode.speedKmh), ...amountBytes(mode.amountPercent)])
    );
}

/**
 * The 6 bytes to write to change one mode's assist speed and amount, keeping the other mode's 3 bytes exactly as read.
 * @param {Uint8Array} current assist levels as read, at least 6 bytes
 * @param {1 | 2} mode
 * @param {AssistSetting} setting
 * @returns {Uint8Array}
 */
export function replaceAssistMode(current, mode, setting) {
    requireLength(current, 6, 'assist levels');
    if (mode !== 1 && mode !== 2) throw new RangeError('The assist mode to change is 1 or 2.');
    const bytes = Uint8Array.from(current.subarray(0, 6));
    bytes.set([speedByte(setting.speedKmh), ...amountBytes(setting.amountPercent)], (mode - 1) * 3);
    return bytes;
}

/**
 * Assist levels as read: 8 bytes, of which the first 6 are speed, power and gain of mode 1, then of mode 2.
 * @param {Uint8Array} bytes
 * @returns {{ mode1: AssistLevel, mode2: AssistLevel }}
 */
export function decodeAssistLevels(bytes) {
    requireLength(bytes, 6, 'assist levels');
    /** @param {number} at */
    const level = (at) => ({
        speedKmh: Math.round((10 + bytes[at] / 17) * 10) / 10,
        powerPercent: Math.round(40 + (bytes[at + 1] * 60) / 255),
        gainPercent: Math.round(40 + (bytes[at + 2] * 60) / 255),
    });
    return { mode1: level(0), mode2: level(3) };
}

// Values read or notified.

/**
 * @param {Uint8Array} bytes
 * @param {number} length
 * @param {string} name
 */
function requireLength(bytes, length, name) {
    if (bytes.length < length) throw new RangeError(`${name}: ${bytes.length} bytes, at least ${length} expected.`);
}

/**
 * @param {Uint8Array} bytes
 * @returns {DataView}
 */
function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * ASCII text, ended by the first `00` if there is one.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeAscii(bytes) {
    const end = bytes.indexOf(0);
    return new TextDecoder('ascii').decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/**
 * Assist mode: byte 0 of the 4 bytes the bike notifies or returns.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function decodeAssistMode(bytes) {
    requireLength(bytes, 1, 'assist mode');
    return bytes[0];
}

/**
 * Lights: on when byte 1 is not `00`.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function decodeLights(bytes) {
    requireLength(bytes, 2, 'lights');
    return bytes[1] !== 0;
}

/**
 * Lock, GNSS or GSM: on (locked) when byte 0 is not `00`.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function decodeSwitch(bytes) {
    requireLength(bytes, 1, 'switch');
    return bytes[0] !== 0;
}

/**
 * @typedef {object} Battery
 * @property {number} volts
 * @property {number} milliamps positive while the battery discharges, negative while it charges
 * @property {number} percent
 * @property {number | null} absoluteSoc absolute state of charge, in a unit not yet confirmed (about 1 mWh); null in a
 *     frame shorter than 11 bytes
 */

/**
 * Battery: voltage, current, charge and absolute state of charge.
 * @param {Uint8Array} bytes
 * @returns {Battery}
 */
export function decodeBattery(bytes) {
    requireLength(bytes, 8, 'battery');
    const data = view(bytes);
    return {
        volts: data.getUint32(0, true) / 1000,
        milliamps: data.getInt16(4, true),
        percent: data.getUint8(6),
        absoluteSoc: bytes.length >= 11 ? data.getUint32(7, true) : null,
    };
}

/**
 * Battery extended: the temperature of each battery pack, in °C.
 * @param {Uint8Array} bytes
 * @returns {{ packTemperaturesC: [number, number] }}
 */
export function decodeBatteryExtended(bytes) {
    requireLength(bytes, 6, 'battery extended');
    const data = view(bytes);
    return { packTemperaturesC: [data.getInt16(2, true) / 10, data.getInt16(4, true) / 10] };
}

/** Factor between torque in N·m times rotational speed in rpm, and power in W. */
const RIDER_POWER_DIVISOR = 9.5488;

/**
 * @typedef {object} AsiMetrics
 * @property {number} odometerKm
 * @property {number} motorWatts
 * @property {number} speedKmh
 * @property {number} riderWatts
 */

/**
 * ASI metrics: odometer, motor power, speed and rider power.
 * @param {Uint8Array} bytes
 * @returns {AsiMetrics}
 */
export function decodeAsiMetrics(bytes) {
    requireLength(bytes, 12, 'ASI metrics');
    const data = view(bytes);
    return {
        odometerKm: data.getUint32(0, true) / 100,
        motorWatts: data.getUint16(4, true),
        speedKmh: data.getUint16(6, true) / 10,
        riderWatts: (data.getUint16(8, true) * data.getUint16(10, true)) / RIDER_POWER_DIVISOR,
    };
}

/**
 * Range: one unsigned byte, in a unit not yet known.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function decodeRange(bytes) {
    requireLength(bytes, 1, 'range');
    return bytes[0];
}

/**
 * Firmware version: the version, then two commit identifiers, separated by spaces.
 * @param {Uint8Array} bytes
 * @returns {{ version: string, commits: string[] }}
 */
export function decodeFirmwareVersion(bytes) {
    const [version = '', ...commits] = decodeAscii(bytes).trim().split(/\s+/);
    return { version, commits };
}

// IoT state.

/** The notification that ends the IoT state. */
const END_OF_MESSAGE = 'EOM';

/**
 * Collects the notifications of the IoT state until `EOM`, then parses the JSON they carry.
 * @returns {{ push: (bytes: Uint8Array) => Record<string, unknown> | null }} `push` returns the state once complete
 */
export function createIotStateReader() {
    /** @type {string[]} */
    let parts = [];
    return {
        push(bytes) {
            const text = new TextDecoder('ascii').decode(bytes);
            if (text !== END_OF_MESSAGE) {
                parts.push(text);
                return null;
            }
            const json = parts.join('');
            parts = [];
            return JSON.parse(json);
        },
    };
}
