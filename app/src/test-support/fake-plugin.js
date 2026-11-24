// A fake of the app's native plugin, BikeLink: its methods and events over the fake bike of fake-client.js, with bytes
// as hexadecimal text, as they cross the bridge.
import { jest } from '@jest/globals';

import { fromHex, toHex } from '../ble/native-client.js';

/**
 * A fake BikeLink plugin: the native plugin's methods and events over the fake bike of fake-client.js, with bytes as
 * hexadecimal text, as they cross the bridge.
 * @param {ReturnType<typeof import('./fake-client.js').fakeClient>} fake
 */
export function fakePlugin(fake) {
    /** @type {Map<string, Set<(data: any) => void>>} */
    const listeners = new Map();
    /**
     * @param {string} event
     * @param {unknown} data
     */
    const emit = (event, data) => {
        for (const listener of listeners.get(event) ?? []) listener(data);
    };
    // The fake bike's client, typed as the methods bike.js uses rather than as Jest's mocks.
    const bike = /** @type {import('../ble/bike.js').BleClientLike} */ (/** @type {unknown} */ (fake.client));
    const plugin = {
        initialize: jest.fn(async () => undefined),
        requestLEScan: jest.fn(
            /** @type {(options: { namePrefix?: string }) => Promise<void>} */ (
                async (options) =>
                    bike.requestLEScan(options, (result) =>
                        emit('scanResult', {
                            deviceId: result.device.deviceId,
                            name: result.localName,
                            rssi: result.rssi,
                        })
                    )
            )
        ),
        stopLEScan: jest.fn(async () => bike.stopLEScan()),
        /** @param {{ deviceId: string }} options */
        isBonded: async ({ deviceId }) => ({ value: await bike.isBonded(deviceId) }),
        /** @param {{ deviceId: string }} options */
        createBond: async ({ deviceId }) => bike.createBond(deviceId),
        /** @param {{ deviceId: string }} options */
        connect: async ({ deviceId }) => bike.connect(deviceId),
        /** @param {{ deviceId: string }} options */
        disconnect: async ({ deviceId }) => {
            await bike.disconnect(deviceId);
            emit('disconnected', { deviceId });
        },
        /** @param {{ deviceId: string, service: string, characteristic: string }} options */
        read: async ({ deviceId, service, characteristic }) => ({
            value: toHex(await bike.read(deviceId, service, characteristic)),
        }),
        /** @param {{ deviceId: string, service: string, characteristic: string, value: string }} options */
        write: async ({ deviceId, service, characteristic, value }) =>
            bike.write(deviceId, service, characteristic, fromHex(value)),
        /** @param {{ deviceId: string, service: string, characteristic: string }} options */
        startNotifications: async ({ deviceId, service, characteristic }) =>
            bike.startNotifications(deviceId, service, characteristic, (value) =>
                // The native side names UUIDs in upper or lower case alike; Java's UUID gives lower case.
                emit('notification', {
                    deviceId,
                    service,
                    characteristic: characteristic.toUpperCase(),
                    value: toHex(value),
                })
            ),
        /** @param {{ deviceId: string, service: string, characteristic: string }} options */
        stopNotifications: async ({ deviceId, service, characteristic }) =>
            bike.stopNotifications(deviceId, service, characteristic),
        addListener: jest.fn(
            /** @type {(event: string, listener: (data: any) => void) => Promise<{ remove: () => Promise<void> }>} */ (
                async (event, listener) => {
                    if (!listeners.has(event)) listeners.set(event, new Set());
                    listeners.get(event)?.add(listener);
                    return { remove: async () => void listeners.get(event)?.delete(listener) };
                }
            )
        ),
        readRssi: jest.fn(async () => ({ value: -63 })),
        /** What auto-connect runs with, as the native service keeps it; undefined while it is off. */
        autoConnect: /** @type {string | undefined} */ (undefined),
        paused: false,
        /** The automatic options a backup brought back, as the service keeps them apart from its settings. */
        restored: /** @type {string | undefined} */ (undefined),
        getAutoConnect: async () => ({
            enabled: plugin.autoConnect !== undefined,
            ...(plugin.autoConnect !== undefined ? { config: plugin.autoConnect } : {}),
            ...(plugin.autoConnect === undefined && plugin.restored !== undefined ? { restored: plugin.restored } : {}),
        }),
        /** @param {{ config?: string }} options */
        setAutoConnect: async ({ config }) => {
            plugin.autoConnect = config;
        },
        pauseAutoConnect: async () => {
            plugin.paused = true;
        },
        riderConnecting: async () => {
            plugin.paused = false;
        },
        /** What the service says auto-connect does, as src/auto-connect.js reads it. */
        events: /** @type {object} */ ({ running: false }),
        getAutoConnectEvents: async () => ({ events: JSON.stringify(plugin.events) }),
        /** Whether the rider's lock holds, as the service keeps it. */
        lockHeld: false,
        /** @param {{ held: boolean }} options */
        setLockHeld: async ({ held }) => {
            plugin.lockHeld = held;
        },
        /** The owner key's copy for Android's backup. */
        keyBackup: /** @type {string | undefined} */ (undefined),
        getKeyBackup: async () => (plugin.keyBackup ? { key: plugin.keyBackup } : {}),
        /** @param {{ key?: string }} options */
        setKeyBackup: async ({ key }) => {
            plugin.keyBackup = key;
        },
        /** What the rider answers to location "all the time". */
        backgroundLocation: true,
        requestBackgroundLocation: async () => ({ granted: plugin.backgroundLocation }),
        setBackHandled: async () => undefined,
        getBackgroundLocation: async () => ({ granted: plugin.backgroundLocation }),
        /** The rides kept, as the service keeps their files, and the one being recorded. */
        rides: /** @type {Map<number, string>} */ (new Map()),
        /** The summaries kept, apart from the rides. */
        summaries: /** @type {Map<number, string>} */ (new Map()),
        /** How many times each ride's file was read. */
        reads: /** @type {Map<number, number>} */ (new Map()),
        ride: /** @type {{ id: number, paused: boolean, config: string } | null} */ (null),
        /** What was offered through the share menu. */
        shared: /** @type {{ name: string, text: string, type: string, title: string }[]} */ ([]),
        /** @param {{ config: string }} options */
        startRide: async ({ config }) => {
            const id = plugin.ride?.id ?? 1_700_000_000_000 + plugin.rides.size;
            plugin.ride ??= { id, paused: false, config };
            if (!plugin.rides.has(id)) plugin.rides.set(id, `${JSON.stringify({ t: id, type: 'start' })}\n`);
            return { id };
        },
        stopRide: async () => {
            const id = plugin.ride?.id;
            plugin.ride = null;
            return id === undefined ? {} : { id };
        },
        /** @param {{ paused: boolean }} options */
        pauseRide: async ({ paused }) => {
            if (plugin.ride) plugin.ride.paused = paused;
        },
        getRide: async () =>
            plugin.ride ? { active: true, id: plugin.ride.id, paused: plugin.ride.paused } : { active: false },
        listRides: async () => ({
            rides: [...plugin.rides.keys()]
                .sort((a, b) => b - a)
                .map((id) => {
                    const summary = plugin.summaries.get(id);
                    return { id, size: plugin.rides.get(id)?.length ?? 0, ...(summary ? { summary } : {}) };
                }),
        }),
        /** @param {{ id: number, from: number }} options */
        readRide: async ({ id, from }) => {
            plugin.reads.set(id, (plugin.reads.get(id) ?? 0) + 1);
            const text = plugin.rides.get(id) ?? '';
            const end = text.lastIndexOf('\n') + 1;
            return { text: text.slice(from, Math.max(from, end)), next: Math.max(from, end) };
        },
        /** @param {{ id: number, summary: string }} options */
        saveRideSummary: async ({ id, summary }) => {
            plugin.summaries.set(id, summary);
        },
        /** @param {{ id: number }} options */
        deleteRide: async ({ id }) => {
            plugin.rides.delete(id);
            plugin.summaries.delete(id);
        },
        /** @param {{ name: string, text: string, type: string, title: string }} file */
        shareFile: async (file) => {
            plugin.shared.push(file);
        },
        emit,
    };
    return plugin;
}
