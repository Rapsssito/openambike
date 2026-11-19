// A fake BLE client for tests: it records what is written and answers as the bike of the official-317 capture does.
import { jest } from '@jest/globals';

import { CHARACTERISTIC } from '../ble/protocol.js';

export const DEVICE = 'device-1';

/**
 * @param {string} text
 * @returns {DataView}
 */
export function ascii(text) {
    return new DataView(new TextEncoder().encode(text).buffer);
}

/**
 * @param {number[]} bytes
 * @returns {DataView}
 */
export function view(bytes) {
    return new DataView(Uint8Array.from(bytes).buffer);
}

/**
 * @param {DataView} value
 * @returns {string}
 */
export function hex(value) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), (b) =>
        b.toString(16).padStart(2, '0')
    ).join(' ');
}

/**
 * A fake BLE client that records what is written and answers as the bike of the official-317 capture does.
 * @param {{ authReply?: string | null, bonded?: boolean, reads?: Record<string, number[]> }} [options]
 */
export function fakeClient({ authReply = 'owner ok', bonded = true, reads = {} } = {}) {
    /** @type {Map<string, (value: DataView) => void>} */
    const listeners = new Map();
    /** What each characteristic returns when read; a write changes it as the bike does. */
    const values = new Map(Object.entries(reads));
    /**
     * How the bike answers a write to a characteristic that holds a setting: the value it then returns and notifies.
     * @type {Record<string, (bytes: number[]) => number[]>}
     */
    const answers = {
        [CHARACTERISTIC.assistMode.uuid]: (bytes) => [bytes[0], 0, 0, 0],
        [CHARACTERISTIC.assistLevels.uuid]: (bytes) => [...bytes, 0, 0],
        [CHARACTERISTIC.lights.uuid]: (bytes) => [0x0a, bytes[1]],
        [CHARACTERISTIC.lock.uuid]: (bytes) => bytes,
        [CHARACTERISTIC.gnssEnabled.uuid]: (bytes) => bytes,
        [CHARACTERISTIC.gsmEnabled.uuid]: (bytes) => bytes,
    };
    /** @type {{ uuid: string, bytes: string }[]} */
    const writes = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
        initialize: jest.fn(async () => undefined),
        requestDevice: jest.fn(async () => ({ deviceId: DEVICE, name: 'AMPLER3' })),
        connect: jest.fn(
            /** @type {(id: string, onDisconnect?: (id: string) => void) => Promise<void>} */ (async () => undefined)
        ),
        disconnect: jest.fn(async () => undefined),
        createBond: jest.fn(async () => undefined),
        isBonded: jest.fn(async () => bonded),
        read: jest.fn(
            /** @type {(id: string, service: string, uuid: string) => Promise<DataView>} */ (
                async (_id, _service, uuid) => view(values.get(uuid) ?? [])
            )
        ),
        write: jest.fn(
            /** @type {(id: string, service: string, uuid: string, value: DataView) => Promise<void>} */ (
                async (_id, _service, uuid, value) => {
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    // Yields a few times without timers, so that overlapping writes would show and fake timers still work.
                    for (let i = 0; i < 3; i++) await Promise.resolve();
                    writes.push({ uuid, bytes: hex(value) });
                    inFlight--;
                    const notify = listeners.get(uuid);
                    const answer = answers[uuid];
                    if (answer) {
                        const stored = answer(
                            Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
                        );
                        values.set(uuid, stored);
                        if (notify) notify(view(stored));
                    }
                    if (uuid === CHARACTERISTIC.auth.uuid && authReply !== null && notify) notify(ascii(authReply));
                    if (uuid === CHARACTERISTIC.iotState.uuid && notify) {
                        const text = JSON.stringify({ settings: { assist_mode: 1 } });
                        for (let at = 0; at < text.length; at += 50) notify(ascii(text.slice(at, at + 50)));
                        notify(ascii('EOM'));
                    }
                }
            )
        ),
        startNotifications: jest.fn(
            /** @type {(id: string, service: string, uuid: string, callback: (value: DataView) => void) => Promise<void>} */ (
                async (_id, _service, uuid, callback) => {
                    listeners.set(uuid, callback);
                }
            )
        ),
        stopNotifications: jest.fn(
            /** @type {(id: string, service: string, uuid: string) => Promise<void>} */ (
                async (_id, _service, uuid) => {
                    listeners.delete(uuid);
                }
            )
        ),
    };
    /**
     * Sends a notification as the bike would.
     * @param {string} uuid
     * @param {number[]} bytes
     */
    const notify = (uuid, bytes) => listeners.get(uuid)?.(view(bytes));
    return { client, writes, listeners, notify, maxInFlight: () => maxInFlight };
}
