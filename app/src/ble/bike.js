// The connection with one bike: finding it, bonding, connecting, authenticating with the owner key, and sending
// commands one at a time. What goes over the air is built and read by protocol.js; this module only moves it.
import {
    CHARACTERISTIC,
    createIotStateReader,
    decodeAssistLevels,
    decodeAssistMode,
    decodeBattery,
    decodeBatteryExtended,
    decodeAscii,
    decodeAsiMetrics,
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
    isOwnerOk,
    replaceAssistMode,
    NAME_PREFIX,
    SERVICE,
} from './protocol.js';

/** @typedef {typeof CHARACTERISTIC[keyof typeof CHARACTERISTIC]} Characteristic */
/** @typedef {import('./protocol.js').AssistSetting} AssistSetting */
/** @typedef {import('./protocol.js').AssistLevel} AssistLevel */

/**
 * The part of `BleClient` of `@capacitor-community/bluetooth-le` this module uses, so that tests can pass a fake.
 * @typedef {object} BleClientLike
 * @property {(options?: { androidNeverForLocation?: boolean }) => Promise<void>} initialize
 * @property {(options: { namePrefix?: string, optionalServices?: string[] }) => Promise<{ deviceId: string, name?: string }>} requestDevice
 * @property {(deviceId: string, onDisconnect?: (deviceId: string) => void) => Promise<void>} connect
 * @property {(deviceId: string) => Promise<void>} disconnect
 * @property {(deviceId: string) => Promise<void>} createBond
 * @property {(deviceId: string) => Promise<boolean>} isBonded
 * @property {(deviceId: string, service: string, characteristic: string) => Promise<DataView>} read
 * @property {(deviceId: string, service: string, characteristic: string, value: DataView) => Promise<void>} write
 * @property {(deviceId: string, service: string, characteristic: string, callback: (value: DataView) => void) => Promise<void>} startNotifications
 * @property {(deviceId: string, service: string, characteristic: string) => Promise<void>} stopNotifications
 */

/** How long the bike has to answer the owner key. */
export const AUTH_TIMEOUT_MS = 5000;

/** How long the bike has to send its whole IoT state. */
export const IOT_STATE_TIMEOUT_MS = 10000;

/** Thrown when the bike does not accept the owner key. */
export class AuthenticationError extends Error {}

/**
 * @param {DataView} value
 * @returns {Uint8Array}
 */
function bytesOf(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * @param {Uint8Array} bytes
 * @returns {DataView}
 */
function viewOf(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Asks the user to choose a bike, through the system's or the browser's device chooser.
 * @param {BleClientLike} client
 * @param {{ native: boolean }} platform whether the app runs as the Android app rather than in a browser
 * @returns {Promise<Bike>}
 */
export async function chooseBike(client, platform) {
    await client.initialize({ androidNeverForLocation: true });
    const device = await client.requestDevice({
        namePrefix: NAME_PREFIX,
        optionalServices: [SERVICE.auth, SERVICE.bike, SERVICE.owner],
    });
    return new Bike(client, device.deviceId, platform);
}

export class Bike {
    /** @type {Promise<unknown>} */
    #queue = Promise.resolve();
    /** @type {Set<(deviceId: string) => void>} */
    #disconnectListeners = new Set();

    /**
     * @param {BleClientLike} client
     * @param {string} deviceId
     * @param {{ native: boolean }} platform
     */
    constructor(client, deviceId, platform) {
        this.client = client;
        this.deviceId = deviceId;
        this.platform = platform;
    }

    /**
     * Runs operations one after another: the bike gets one write at a time, each after the previous one finished.
     * @template T
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    #enqueue(operation) {
        const run = this.#queue.then(operation, operation);
        this.#queue = run.catch(() => undefined);
        return run;
    }

    /** @param {(deviceId: string) => void} listener called when the bike disconnects */
    onDisconnect(listener) {
        this.#disconnectListeners.add(listener);
        return () => this.#disconnectListeners.delete(listener);
    }

    /**
     * Connects, bonding first on Android if the phone has no bond with the bike: the bike then shows a 6-digit code
     * that the user types in the system's dialog. In a browser, the browser handles bonding.
     */
    async connect() {
        if (this.platform.native && !(await this.client.isBonded(this.deviceId))) {
            await this.client.createBond(this.deviceId);
        }
        await this.client.connect(this.deviceId, (id) => {
            for (const listener of this.#disconnectListeners) listener(id);
        });
    }

    async disconnect() {
        await this.client.disconnect(this.deviceId);
    }

    /**
     * Writes the owner key and waits for the bike's answer. Throws AuthenticationError unless it answers `owner ok`.
     * @param {string} key
     */
    async authenticate(key) {
        const bytes = encodeOwnerKey(key);
        const { service, uuid } = CHARACTERISTIC.auth;
        await this.#enqueue(async () => {
            /** @type {(value: Uint8Array | null) => void} */
            let settle = () => undefined;
            const answer = new Promise((resolve) => (settle = resolve));
            const timer = setTimeout(() => settle(null), AUTH_TIMEOUT_MS);
            await this.client.startNotifications(this.deviceId, service, uuid, (value) => settle(bytesOf(value)));
            try {
                await this.client.write(this.deviceId, service, uuid, viewOf(bytes));
                const reply = await answer;
                if (!reply) throw new AuthenticationError('The bike did not answer the owner key.');
                if (!isOwnerOk(reply)) throw new AuthenticationError('The bike refused the owner key.');
            } finally {
                clearTimeout(timer);
                await this.client.stopNotifications(this.deviceId, service, uuid);
            }
        });
    }

    /**
     * @param {Characteristic} characteristic
     * @returns {Promise<Uint8Array>}
     */
    read(characteristic) {
        return this.#enqueue(async () =>
            bytesOf(await this.client.read(this.deviceId, characteristic.service, characteristic.uuid))
        );
    }

    /**
     * @param {Characteristic} characteristic
     * @param {Uint8Array} bytes
     * @returns {Promise<void>}
     */
    write(characteristic, bytes) {
        return this.#enqueue(() =>
            this.client.write(this.deviceId, characteristic.service, characteristic.uuid, viewOf(bytes))
        );
    }

    /**
     * Calls `callback` with each notification of a characteristic until the returned function is called.
     * @param {Characteristic} characteristic
     * @param {(bytes: Uint8Array) => void} callback
     * @returns {Promise<() => Promise<void>>}
     */
    async subscribe(characteristic, callback) {
        const { service, uuid } = characteristic;
        await this.#enqueue(() =>
            this.client.startNotifications(this.deviceId, service, uuid, (value) => callback(bytesOf(value)))
        );
        return () => this.#enqueue(() => this.client.stopNotifications(this.deviceId, service, uuid));
    }

    // Values.

    /** @returns {Promise<number>} */
    async readAssistMode() {
        return decodeAssistMode(await this.read(CHARACTERISTIC.assistMode));
    }

    /** @returns {Promise<{ mode1: AssistLevel, mode2: AssistLevel }>} */
    async readAssistLevels() {
        return decodeAssistLevels(await this.read(CHARACTERISTIC.assistLevels));
    }

    /** @returns {Promise<boolean>} */
    async readLights() {
        return decodeLights(await this.read(CHARACTERISTIC.lights));
    }

    /** @returns {Promise<boolean>} */
    async readLocked() {
        return decodeSwitch(await this.read(CHARACTERISTIC.lock));
    }

    /** @returns {Promise<boolean>} */
    async readGnss() {
        return decodeSwitch(await this.read(CHARACTERISTIC.gnssEnabled));
    }

    /** @returns {Promise<boolean>} */
    async readGsm() {
        return decodeSwitch(await this.read(CHARACTERISTIC.gsmEnabled));
    }

    async readBattery() {
        return decodeBattery(await this.read(CHARACTERISTIC.battery));
    }

    async readBatteryExtended() {
        return decodeBatteryExtended(await this.read(CHARACTERISTIC.batteryExtended));
    }

    async readAsiMetrics() {
        return decodeAsiMetrics(await this.read(CHARACTERISTIC.asiMetrics));
    }

    /** @returns {Promise<number>} */
    async readRange() {
        return decodeRange(await this.read(CHARACTERISTIC.range));
    }

    async readFirmwareVersion() {
        return decodeFirmwareVersion(await this.read(CHARACTERISTIC.firmwareVersion));
    }

    /** @returns {Promise<string>} */
    async readBatteryFirmwareStatus() {
        return decodeAscii(await this.read(CHARACTERISTIC.batteryFirmwareStatus));
    }

    /**
     * Asks for the IoT state and collects it. It holds the owner key, the serial number and the last position.
     * @returns {Promise<Record<string, unknown>>}
     */
    async readIotState() {
        const { service, uuid } = CHARACTERISTIC.iotState;
        return this.#enqueue(async () => {
            const reader = createIotStateReader();
            /** @type {(state: Record<string, unknown> | null) => void} */
            let settle = () => undefined;
            /** @type {(error: unknown) => void} */
            let fail = () => undefined;
            const complete = new Promise((resolve, reject) => {
                settle = resolve;
                fail = reject;
            });
            const timer = setTimeout(() => settle(null), IOT_STATE_TIMEOUT_MS);
            await this.client.startNotifications(this.deviceId, service, uuid, (value) => {
                try {
                    const state = reader.push(bytesOf(value));
                    if (state) settle(state);
                } catch (error) {
                    fail(error);
                }
            });
            try {
                await this.client.write(this.deviceId, service, uuid, viewOf(encodeIotStateRequest()));
                const state = await complete;
                if (!state) throw new Error('The bike did not send its whole IoT state.');
                return state;
            } finally {
                clearTimeout(timer);
                await this.client.stopNotifications(this.deviceId, service, uuid);
            }
        });
    }

    // Commands.

    /** @param {number} mode 0 for no assist, 1 or 2 */
    setAssistMode(mode) {
        return this.write(CHARACTERISTIC.assistMode, encodeAssistMode(mode));
    }

    /** @param {boolean} on */
    setLights(on) {
        return this.write(CHARACTERISTIC.lights, encodeLights(on));
    }

    /** @param {boolean} locked */
    setLocked(locked) {
        return this.write(CHARACTERISTIC.lock, encodeLock(locked));
    }

    /** @param {boolean} on */
    setGnss(on) {
        return this.write(CHARACTERISTIC.gnssEnabled, encodeSwitch(on));
    }

    /** @param {boolean} on */
    setGsm(on) {
        return this.write(CHARACTERISTIC.gsmEnabled, encodeSwitch(on));
    }

    /**
     * Writes both assist modes at once, as the bike expects all 6 bytes.
     * @param {AssistSetting} mode1
     * @param {AssistSetting} mode2
     */
    setAssistLevels(mode1, mode2) {
        return this.write(CHARACTERISTIC.assistLevels, encodeAssistLevels(mode1, mode2));
    }

    /**
     * Changes one mode's assist speed and amount: reads the current levels, keeps the other mode's bytes as read,
     * writes the 6 bytes, and returns the levels read back.
     * @param {1 | 2} mode
     * @param {AssistSetting} setting
     * @returns {Promise<{ mode1: AssistLevel, mode2: AssistLevel }>}
     */
    async changeAssistMode(mode, setting) {
        const current = await this.read(CHARACTERISTIC.assistLevels);
        await this.write(CHARACTERISTIC.assistLevels, replaceAssistMode(current, mode, setting));
        return this.readAssistLevels();
    }

    /** Restarts the bike's firmware; it disconnects and keeps its settings. */
    restart() {
        return this.write(CHARACTERISTIC.reset, encodeRestart());
    }

    /** Turns all the bike's electronics off; only attaching the charger turns it on again. */
    sleep() {
        return this.write(CHARACTERISTIC.stateManagement, encodeSleep());
    }

    /** Recalibrates the torque sensor. The factory motor calibration is not offered. */
    calibrateTorqueSensor() {
        return this.write(CHARACTERISTIC.motorCalibration, encodeTorqueSensorCalibration());
    }
}
