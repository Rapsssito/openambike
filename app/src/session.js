// A connected, authenticated bike and everything known about it, kept live: values read when the session starts,
// then updated by the bike's notifications. When the link drops, the session pauses and keeps what it knew; started
// again on the same bike, it reads everything anew. Screens read the state and call the commands; they never talk to
// the bike directly.
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
 * @property {boolean} connected whether the bike is connected and its values live
 * @property {import('./ble/protocol.js').Battery | null} battery
 * @property {number | null} batteryCycles the battery's charge cycles
 * @property {[number, number] | null} packTemperaturesC
 * @property {import('./ble/protocol.js').AsiMetrics | null} metrics
 * @property {number | null} range in kilometres
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

/**
 * Whether the battery is charging: its current is negative while it charges (docs/protocol.md, "Battery current").
 * @param {import('./ble/protocol.js').Battery | null} battery
 * @returns {boolean}
 */
export function isCharging(battery) {
    return battery !== null && battery.milliamps < 0;
}

/** How often battery extended (pack temperatures and cycles) is read, as the official app reads it. */
export const TEMPERATURE_INTERVAL_MS = 10000;

/**
 * How long a command waits, after its write, for the bike to notify the value it asked for. The bike notifies the
 * lights 0.3 to 0.7 s after the write (docs/protocol.md, "Lights").
 */
export const CONFIRM_TIMEOUT_MS = 5000;

/** The bike took the write but did not notify the value asked for in time, such as the lights while it charges. */
export class NotConfirmedError extends Error {
    /** @param {string} setting */
    constructor(setting) {
        super(`The bike did not confirm the change of ${setting}`);
        this.name = 'NotConfirmedError';
    }
}

/** The link dropped, or the session stopped, before the bike confirmed a command. */
export class InterruptedError extends Error {
    constructor() {
        super('The bike disconnected before it confirmed the change');
        this.name = 'InterruptedError';
    }
}

/** @typedef {'assistMode' | 'lights' | 'locked' | 'gnss' | 'gsm'} Setting */

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
 * The state of a bike before anything is read from it.
 * @returns {BikeState}
 */
export function emptyState() {
    return {
        connected: false,
        battery: null,
        batteryCycles: null,
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
}

/**
 * @param {Bike} bike connected and authenticated
 * @param {{ confirmTimeoutMs?: number }} [options]
 */
export function createSession(bike, { confirmTimeoutMs = CONFIRM_TIMEOUT_MS } = {}) {
    /** @type {BikeState} */
    let state = emptyState();
    /** @type {Set<(state: BikeState) => void>} */
    const listeners = new Set();
    /** @type {(() => Promise<void>)[]} */
    let unsubscribers = [];
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;

    /**
     * Commands waiting for the bike to notify the value they asked for.
     * @type {Set<{ setting: Setting, value: unknown, resolve: () => void, reject: (error: Error) => void }>}
     */
    const waiters = new Set();

    /** @param {Partial<BikeState>} change */
    function update(change) {
        state = { ...state, ...change };
        // Only a value the bike sent now confirms a command, not one the state already held.
        for (const waiter of waiters) {
            if (waiter.setting in change && change[waiter.setting] === waiter.value) {
                waiters.delete(waiter);
                waiter.resolve();
            }
        }
        for (const listener of listeners) listener(state);
    }

    /**
     * Writes a setting, and resolves once the bike notifies the value asked for: the state changes only then.
     * @template {Setting} S
     * @param {S} setting
     * @param {BikeState[S]} value
     * @param {() => Promise<void>} write
     */
    async function confirmed(setting, value, write) {
        if (!state.connected) throw new InterruptedError();
        /** @type {{ setting: Setting, value: unknown, resolve: () => void, reject: (error: Error) => void }} */
        let waiter = { setting, value, resolve: () => undefined, reject: () => undefined };
        const confirmation = new Promise((resolve, reject) => {
            waiter = { setting, value, resolve: () => resolve(undefined), reject };
        });
        // Waiting starts before the write: the bike may notify before the write is acknowledged.
        waiters.add(waiter);
        confirmation.catch(() => undefined);
        try {
            await write();
        } catch (error) {
            waiters.delete(waiter);
            throw error;
        }
        const timeout = setTimeout(() => {
            if (waiters.delete(waiter)) waiter.reject(new NotConfirmedError(setting));
        }, confirmTimeoutMs);
        try {
            await confirmation;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function readBatteryExtended() {
        const { cycles, packTemperaturesC } = await bike.readBatteryExtended();
        update({ batteryCycles: cycles, packTemperaturesC });
    }

    /** Ends the notifications and the reads, and marks the values as no longer live; the listeners stay. */
    async function pause() {
        if (timer !== null) clearInterval(timer);
        timer = null;
        for (const unsubscribe of unsubscribers) await unsubscribe().catch(() => undefined);
        unsubscribers = [];
        for (const waiter of waiters) waiter.reject(new InterruptedError());
        waiters.clear();
        if (state.connected) update({ connected: false });
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

        /** Reads every value, then keeps them live. Called again after `pause`, on the same bike reconnected. */
        async start() {
            await pause();
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
            await readBatteryExtended();
            for (const [name, decode] of NOTIFIED) {
                unsubscribers.push(await bike.subscribe(CHARACTERISTIC[name], (bytes) => update(decode(bytes))));
            }
            timer = setInterval(() => readBatteryExtended().catch(() => undefined), TEMPERATURE_INTERVAL_MS);
            update({ connected: true });
            update({ iotState: await bike.readIotState().catch(() => null) });
        },

        /** Called when the link drops: keeps the values and the listeners, to start again on reconnection. */
        pause,

        /** Ends the notifications, the reads and the listeners; the connection itself is left as it is. */
        async stop() {
            await pause();
            listeners.clear();
        },

        // Commands. Each setting resolves once the bike notifies the value asked for, and fails with NotConfirmedError
        // if it does not in time, or InterruptedError if the link drops first; the state changes only with the bike's
        // notification, never before.

        /** @param {number} mode */
        setAssistMode: (mode) => confirmed('assistMode', mode, () => bike.setAssistMode(mode)),
        /** @param {boolean} on */
        setLights: (on) => confirmed('lights', on, () => bike.setLights(on)),
        /** @param {boolean} locked */
        setLocked: (locked) => confirmed('locked', locked, () => bike.setLocked(locked)),
        /** @param {boolean} on */
        setGnss: (on) => confirmed('gnss', on, () => bike.setGnss(on)),
        /** @param {boolean} on */
        setGsm: (on) => confirmed('gsm', on, () => bike.setGsm(on)),

        /**
         * Changes both modes' assist speed and amount in one write, and shows the levels the bike then returns.
         * @param {AssistSetting} mode1
         * @param {AssistSetting} mode2
         */
        async changeAssistLevels(mode1, mode2) {
            update({ assistLevels: await bike.changeAssistLevels(mode1, mode2) });
        },

        // Nothing the bike notifies confirms these yet (docs/roadmap.md, "The meaning of the rest of the
        // characteristics"): each resolves once the bike has the write.
        restart: () => bike.restart(),
        sleep: () => bike.sleep(),
        calibrateTorqueSensor: () => bike.calibrateTorqueSensor(),
    };
}

/** @typedef {ReturnType<typeof createSession>} Session */
