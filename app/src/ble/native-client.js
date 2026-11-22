// The Bluetooth client of the Android app: the app's own native plugin, BikeLink, which holds the link to the bike in a
// service of its own (android/app/src/main/java/org/openambike/app/link/), offered with the methods bike.js uses. Bytes
// cross the bridge as hexadecimal text. The web app uses @capacitor-community/bluetooth-le instead.

/** @typedef {import('./bike.js').BleClientLike} BleClientLike */
/** @typedef {import('./bike.js').ScanResult} ScanResult */

/**
 * The part of a Capacitor plugin's listener handle this module uses.
 * @typedef {{ remove: () => Promise<void> }} ListenerHandle
 */

/**
 * The native plugin, as Capacitor's `registerPlugin('BikeLink')` returns it.
 * @typedef {object} BikeLinkPlugin
 * @property {() => Promise<void>} initialize
 * @property {(options: { namePrefix?: string, scanMode?: number }) => Promise<void>} requestLEScan
 * @property {() => Promise<void>} stopLEScan
 * @property {(options: { deviceId: string }) => Promise<{ value: boolean }>} isBonded
 * @property {(options: { deviceId: string }) => Promise<void>} createBond
 * @property {(options: { deviceId: string }) => Promise<void>} connect
 * @property {(options: { deviceId: string }) => Promise<void>} disconnect
 * @property {(options: { deviceId: string, service: string, characteristic: string }) => Promise<{ value: string }>} read
 * @property {(options: { deviceId: string, service: string, characteristic: string, value: string }) => Promise<void>} write
 * @property {(options: { deviceId: string, service: string, characteristic: string }) => Promise<void>} startNotifications
 * @property {(options: { deviceId: string, service: string, characteristic: string }) => Promise<void>} stopNotifications
 * @property {(options: { deviceId: string }) => Promise<{ value: number }>} readRssi
 * @property {() => Promise<{ enabled: boolean, config?: string, restored?: string }>} getAutoConnect `restored`, the
 *     automatic options a backup brought back, without the key, while auto-connect has no settings on this phone
 * @property {(options: { config?: string }) => Promise<void>} setAutoConnect turns it off without `config`
 * @property {() => Promise<void>} pauseAutoConnect
 * @property {() => Promise<{ activity: string }>} getAutoConnectActivity where auto-connect's timers stand and its
 *     history, as JSON text
 * @property {(options: { config: string }) => Promise<{ id: number }>} startRide
 * @property {() => Promise<{ id?: number }>} stopRide
 * @property {(options: { paused: boolean }) => Promise<void>} pauseRide
 * @property {() => Promise<{ active: boolean, id?: number, paused?: boolean }>} getRide
 * @property {() => Promise<{ rides: { id: number, size: number, summary?: string }[] }>} listRides each with the summary
 *     kept by `saveRideSummary`, if any
 * @property {(options: { id: number, summary: string }) => Promise<void>} saveRideSummary
 * @property {() => Promise<{ granted: boolean }>} requestBackgroundLocation location "all the time", for auto-ride
 * @property {() => Promise<{ granted: boolean }>} getBackgroundLocation whether it is granted, asking nothing
 * @property {() => Promise<{ key?: string }>} getKeyBackup the owner key's copy for Android's backup
 * @property {(options: { key?: string }) => Promise<void>} setKeyBackup without `key`, removes the copy
 * @property {(options: { held: boolean }) => Promise<void>} setLockHeld the rider locked or unlocked the bike in the app
 * @property {(options: { id: number, from: number }) => Promise<{ text: string, next: number }>} readRide
 * @property {(options: { id: number }) => Promise<void>} deleteRide
 * @property {(options: { name: string, text: string, type: string, title: string }) => Promise<void>} shareFile
 * @property {(event: string, listener: (data: any) => void) => Promise<ListenerHandle>} addListener
 */

/**
 * @param {DataView} value
 * @returns {string}
 */
export function toHex(value) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), (byte) =>
        byte.toString(16).padStart(2, '0')
    ).join('');
}

/**
 * @param {string} text
 * @returns {DataView}
 */
export function fromHex(text) {
    const digits = text.replaceAll(' ', '');
    const bytes = new Uint8Array(digits.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return new DataView(bytes.buffer);
}

/**
 * @param {string} deviceId
 * @param {string} service
 * @param {string} characteristic
 */
function notificationKey(deviceId, service, characteristic) {
    return `${deviceId}|${service.toLowerCase()}|${characteristic.toLowerCase()}`;
}

/**
 * @param {BikeLinkPlugin} plugin
 * @returns {BleClientLike}
 */
export function createNativeClient(plugin) {
    /** @type {Map<string, (value: DataView) => void>} */
    const notifications = new Map();
    /** @type {Map<string, (deviceId: string) => void>} */
    const disconnections = new Map();
    /** @type {((result: ScanResult) => void) | null} */
    let onScanResult = null;
    /** @type {Promise<unknown> | null} */
    let listening = null;

    // The plugin's events reach the callbacks registered for them; listened to once, on the first use.
    function listen() {
        listening ??= Promise.all([
            plugin.addListener(
                'notification',
                /** @param {{ deviceId: string, service: string, characteristic: string, value: string }} event */
                (event) =>
                    notifications.get(notificationKey(event.deviceId, event.service, event.characteristic))?.(
                        fromHex(event.value)
                    )
            ),
            plugin.addListener(
                'disconnected',
                /** @param {{ deviceId: string }} event */
                (event) => disconnections.get(event.deviceId)?.(event.deviceId)
            ),
            plugin.addListener(
                'scanResult',
                /** @param {{ deviceId: string, name: string, rssi: number }} event */
                (event) =>
                    onScanResult?.({
                        device: { deviceId: event.deviceId, name: event.name },
                        localName: event.name,
                        rssi: event.rssi,
                    })
            ),
        ]);
        return listening;
    }

    return {
        async initialize() {
            await listen();
            await plugin.initialize();
        },

        async requestDevice() {
            // The Android app lists the bikes itself (bike.js, scanForBikes); only a browser needs its own chooser.
            throw new Error('The Android app has no device chooser.');
        },

        async requestLEScan(options, callback) {
            await listen();
            onScanResult = callback;
            await plugin.requestLEScan({ namePrefix: options.namePrefix, scanMode: options.scanMode });
        },

        async stopLEScan() {
            onScanResult = null;
            await plugin.stopLEScan();
        },

        async connect(deviceId, onDisconnect) {
            await listen();
            if (onDisconnect) disconnections.set(deviceId, onDisconnect);
            else disconnections.delete(deviceId);
            await plugin.connect({ deviceId });
        },

        async disconnect(deviceId) {
            await plugin.disconnect({ deviceId });
        },

        async createBond(deviceId) {
            await plugin.createBond({ deviceId });
        },

        async isBonded(deviceId) {
            return (await plugin.isBonded({ deviceId })).value;
        },

        async read(deviceId, service, characteristic) {
            return fromHex((await plugin.read({ deviceId, service, characteristic })).value);
        },

        async write(deviceId, service, characteristic, value) {
            await plugin.write({ deviceId, service, characteristic, value: toHex(value) });
        },

        async startNotifications(deviceId, service, characteristic, callback) {
            await listen();
            notifications.set(notificationKey(deviceId, service, characteristic), callback);
            await plugin.startNotifications({ deviceId, service, characteristic });
        },

        async stopNotifications(deviceId, service, characteristic) {
            notifications.delete(notificationKey(deviceId, service, characteristic));
            await plugin.stopNotifications({ deviceId, service, characteristic });
        },
    };
}
