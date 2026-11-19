// A connected, authenticated bike and everything known about it, kept live: values read when the session starts,
// then updated by the bike's notifications. Screens read the state and call the commands; they never talk to the bike
// directly.
import {
    CHARACTERISTIC,
    decodeAssistMode,
    decodeAsiMetrics,
    decodeBattery,
    decodeLights,
    decodeRange,
    decodeSwitch,
} from './ble/protocol.js';

/** @typedef {import('./ble/bike.js').Bike} Bike */
/** @typedef {import('./ble/protocol.js').AssistLevel} AssistLevel */
/** @typedef {import('./ble/protocol.js').AssistSetting} AssistSetting */

/**
 * @typedef {object} BikeState
 * @property {import('./ble/protocol.js').Battery | null} battery
 * @property {[number, number] | null} packTemperaturesC
 * @property {import('./ble/protocol.js').AsiMetrics | null} metrics
 * @property {number | null} range in a unit not yet known
 * @property {number | null} assistMode 0 for no assist, 1 or 2
 * @property {{ mode1: AssistLevel, mode2: AssistLevel } | null} assistLevels
 * @property {boolean | null} lights
 * @property {boolean | null} locked
 * @property {boolean | null} gnss
 * @property {boolean | null} gsm
 * @property {{ version: string, commits: string[] } | null} firmware
 * @property {string | null} batteryFirmwareStatus
 * @property {Record<string, unknown> | null} iotState
 */

/** How often pack temperatures are read, as the official app reads them. */
export const TEMPERATURE_INTERVAL_MS = 10000;

/**
 * Characteristics the bike notifies, with how each notification changes the state.
 * @type {[keyof typeof CHARACTERISTIC, (bytes: Uint8Array) => Partial<BikeState>][]}
 */
const NOTIFIED = [
    ['battery', (bytes) => ({ battery: decodeBattery(bytes) })],
    ['asiMetrics', (bytes) => ({ metrics: decodeAsiMetrics(bytes) })],
    ['range', (bytes) => ({ range: decodeRange(bytes) })],
    ['assistMode', (bytes) => ({ assistMode: decodeAssistMode(bytes) })],
    ['lights', (bytes) => ({ lights: decodeLights(bytes) })],
    ['lock', (bytes) => ({ locked: decodeSwitch(bytes) })],
    ['gnssEnabled', (bytes) => ({ gnss: decodeSwitch(bytes) })],
    ['gsmEnabled', (bytes) => ({ gsm: decodeSwitch(bytes) })],
];

/**
 * @param {Bike} bike connected and authenticated
 */
export function createSession(bike) {
    /** @type {BikeState} */
    let state = {
        battery: null,
        packTemperaturesC: null,
        metrics: null,
        range: null,
        assistMode: null,
        assistLevels: null,
        lights: null,
        locked: null,
        gnss: null,
        gsm: null,
        firmware: null,
        batteryFirmwareStatus: null,
        iotState: null,
    };
    /** @type {Set<(state: BikeState) => void>} */
    const listeners = new Set();
    /** @type {(() => Promise<void>)[]} */
    let unsubscribers = [];
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;

    /** @param {Partial<BikeState>} change */
    function update(change) {
        state = { ...state, ...change };
        for (const listener of listeners) listener(state);
    }

    async function readTemperatures() {
        update({ packTemperaturesC: (await bike.readBatteryExtended()).packTemperaturesC });
    }

    return {
        /** @returns {BikeState} */
        get state() {
            return state;
        },

        bike,

        /**
         * @param {(state: BikeState) => void} listener called on every change
         * @returns {() => void} removes the listener
         */
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /** Reads every value, then keeps them live. */
        async start() {
            update({
                battery: await bike.readBattery(),
                metrics: await bike.readAsiMetrics(),
                range: await bike.readRange(),
                assistMode: await bike.readAssistMode(),
                assistLevels: await bike.readAssistLevels(),
                lights: await bike.readLights(),
                locked: await bike.readLocked(),
                gnss: await bike.readGnss(),
                gsm: await bike.readGsm(),
                firmware: await bike.readFirmwareVersion(),
                batteryFirmwareStatus: await bike.readBatteryFirmwareStatus(),
            });
            await readTemperatures();
            for (const [name, decode] of NOTIFIED) {
                unsubscribers.push(await bike.subscribe(CHARACTERISTIC[name], (bytes) => update(decode(bytes))));
            }
            timer = setInterval(() => readTemperatures().catch(() => undefined), TEMPERATURE_INTERVAL_MS);
            update({ iotState: await bike.readIotState().catch(() => null) });
        },

        /** Ends the notifications and the reads; the connection itself is left as it is. */
        async stop() {
            if (timer !== null) clearInterval(timer);
            timer = null;
            for (const unsubscribe of unsubscribers) await unsubscribe().catch(() => undefined);
            unsubscribers = [];
            listeners.clear();
        },

        // Commands. Each resolves once the bike has the write; the state changes when the bike notifies the new value.

        /** @param {number} mode */
        setAssistMode: (mode) => bike.setAssistMode(mode),
        /** @param {boolean} on */
        setLights: (on) => bike.setLights(on),
        /** @param {boolean} locked */
        setLocked: (locked) => bike.setLocked(locked),
        /** @param {boolean} on */
        setGnss: (on) => bike.setGnss(on),
        /** @param {boolean} on */
        setGsm: (on) => bike.setGsm(on),

        /**
         * Changes one mode's assist speed and amount, and shows the levels the bike then returns.
         * @param {1 | 2} mode
         * @param {AssistSetting} setting
         */
        async changeAssistMode(mode, setting) {
            update({ assistLevels: await bike.changeAssistMode(mode, setting) });
        },

        restart: () => bike.restart(),
        sleep: () => bike.sleep(),
        calibrateTorqueSensor: () => bike.calibrateTorqueSensor(),
    };
}

/** @typedef {ReturnType<typeof createSession>} Session */
