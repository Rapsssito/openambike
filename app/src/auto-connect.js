// Auto-connect and auto-lock, Android only: what the app's native service needs to connect to the bike, lock it and
// let it go with the app closed (android/app/src/main/java/org/openambike/app/link/). This module prepares it from
// protocol.js and the translation files, so that the service knows neither the protocol nor the languages.
import { toHex } from './ble/native-client.js';
import { ASI_MOVEMENT_BYTES, CHARACTERISTIC, encodeLock, encodeOwnerKey, OWNER_OK } from './ble/protocol.js';
import { t } from './i18n/i18n.js';
import { rideConfig } from './rides/rides.js';

/** @typedef {import('./ble/native-client.js').BikeLinkPlugin} BikeLinkPlugin */

/**
 * What auto-connect does, as the service says it: where its timers stand, the ride being recorded, and its history,
 * newest first.
 * @typedef {object} Activity
 * @property {boolean} running
 * @property {'OFF' | 'IDLE' | 'NEAR' | 'CONNECTING' | 'CONNECTED' | 'LEAVING' | 'PAUSED'} [state]
 * @property {boolean} [connected] whether the bike is connected and accepted the key, whoever connected it
 * @property {boolean} [locked] the bike's lock as last known, also after the connection ended
 * @property {boolean} [lockHeld] whether the rider's own lock holds against auto-unlock
 * @property {number} [nearDbm] near the bike, before connecting: the advertising's median
 * @property {number} [nearForMs] and for how long it has been heard near
 * @property {number} [signalDbm] connected: the connection signal's median over the far time
 * @property {boolean} [signalSettled] whether readings cover all of the far time
 * @property {number} [signalNowDbm] connected: its latest reading
 * @property {number} [movedAgoMs] since the bike last reported movement, if it has
 * @property {number} [guardLeftMs] how long the ride guard still holds a lock back
 * @property {number} [parkedLeftMs] how long until a bike standing still near is let go
 * @property {number} [heardDbm] the bike's advertising as last heard
 * @property {number} [heardAgoMs] and how long ago
 * @property {number} [connectInMs] near the bike, its signal strong enough: how long until it connects
 * @property {number} [leaveInMs] connected, the rider leaving: how long until it locks or lets go
 * @property {number} [dropLeftMs] the connection dropped: how long it still waits for it to come back
 * @property {{ active: boolean, auto?: boolean, startInMs?: number, stopInMs?: number }} [ride] whether a ride is
 *     recorded and auto-ride started it; how long until auto-ride starts one while the bike moves, or stops its own while
 *     the bike stands
 * @property {{ at: number, event: string, value: number }[]} [history] `at` in milliseconds since 1970
 */

/**
 * The automatic options, as the rider sets them: auto-lock only with auto-connect, auto-unlock only with auto-lock,
 * auto-ride only with auto-connect.
 * @typedef {{ autoLock: boolean, autoUnlock: boolean, autoRide: boolean }} Automatic
 */

/**
 * When auto-connect connects and lets go, from the owner's measurements (docs/protocol.md, "Advertising";
 * docs/roadmap.md, "Auto-connect, auto-lock and rides").
 */
export const AUTO_CONNECT_THRESHOLDS = Object.freeze({
    /**
     * Connects once the median of the bike's advertising over `nearMs` is above this: about 1.5 m, phone in a pocket; the
     * time short, so that the bike unlocks soon after the rider reaches it.
     */
    nearDbm: -72,
    nearMs: 5_000,
    /**
     * Lets go once the median of the connection's signal over `farMs` is below this, after it was above it: about 2.5 to
     * 3 m, so that the lock goes out well before the link drops; a closed door or a wall (-80 dBm) between phone and bike
     * also counts as away.
     */
    farDbm: -76,
    farMs: 3_000,
    /** Lets go, and pauses, once the bike has not moved for this long near the phone. */
    parkedMs: 15 * 60_000,
    /** Never locks while the bike moved in the last this long. */
    rideGuardMs: 30_000,
    /** Ends a pause for standing near once the bike has not been heard above `farDbm` for this long: the rider left. */
    awayMs: 60_000,
});

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
const hex = (bytes) => toHex(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));

/**
 * What the notification says while auto-connect waits for the bike: which of the automatic options are on.
 * @param {{ autoLock: boolean, autoUnlock: boolean, autoRide: boolean }} options auto-unlock only with auto-lock
 */
export function onText({ autoLock, autoUnlock, autoRide }) {
    if (!autoLock) return t('autoConnect.onRide');
    if (autoUnlock) return t(autoRide ? 'autoConnect.onLockUnlockRide' : 'autoConnect.onLockUnlock');
    return t(autoRide ? 'autoConnect.onLockRide' : 'autoConnect.onLock');
}

/**
 * What the service runs auto-connect with.
 * @param {{ address: string, key: string, autoLock: boolean, autoUnlock?: boolean, autoRide?: boolean }} options the
 *     bike's Bluetooth address and owner key; auto-unlock only with auto-lock
 */
export function autoConnectConfig({ address, key, autoLock, autoUnlock = false, autoRide = false }) {
    const { auth, lock, asiMetrics } = CHARACTERISTIC;
    const minutes = String(AUTO_CONNECT_THRESHOLDS.parkedMs / 60_000);
    return {
        address,
        autoLock,
        autoUnlock: autoLock && autoUnlock,
        autoRide,
        // What a ride auto-ride starts records, as one started by hand.
        ...(autoRide ? { ride: rideConfig() } : {}),
        auth: {
            service: auth.service,
            characteristic: auth.uuid,
            value: hex(encodeOwnerKey(key)),
            reply: hex(new TextEncoder().encode(OWNER_OK)),
        },
        lock: { service: lock.service, characteristic: lock.uuid, value: hex(encodeLock(true)) },
        unlock: { service: lock.service, characteristic: lock.uuid, value: hex(encodeLock(false)) },
        movement: { service: asiMetrics.service, characteristic: asiMetrics.uuid, ...ASI_MOVEMENT_BYTES },
        thresholds: AUTO_CONNECT_THRESHOLDS,
        texts: {
            title: t('app.name'),
            quietChannel: t('autoConnect.quietChannel'),
            alertChannel: t('autoConnect.alertChannel'),
            // Every channel is made whenever the service starts, the ride's too.
            rideChannel: t('rides.channel'),
            // Waiting for the bike, it says what is on, which is why auto-connect runs.
            looking: onText({ autoLock, autoUnlock: autoLock && autoUnlock, autoRide }),
            connected: t('autoConnect.connected'),
            connectedLocked: t('autoConnect.connectedLocked'),
            connectedUnlocked: t('autoConnect.connectedUnlocked'),
            paused: t('autoConnect.paused'),
            mayBeUnlocked: t('autoConnect.mayBeUnlocked'),
            pausedParked: t('autoConnect.pausedParked', { minutes }),
            pausedParkedLocked: t('autoConnect.pausedParkedLocked', { minutes }),
        },
    };
}

/**
 * Whether the automatic options need auto-connect: auto-lock or auto-ride. On its own it would only hold the bike's
 * connection, which the rider cannot turn on or off by itself.
 * @param {Partial<Automatic>} options
 */
export const needsAutoConnect = ({ autoLock, autoRide }) => Boolean(autoLock || autoRide);

/**
 * Auto-connect, as the screens use it.
 * @param {BikeLinkPlugin} plugin
 */
export function createAutoConnect(plugin) {
    /** @returns {Promise<{ enabled: boolean } & Automatic>} */
    async function status() {
        const { enabled, config } = await plugin.getAutoConnect();
        const saved = enabled && config ? JSON.parse(config) : {};
        return {
            enabled,
            autoLock: Boolean(saved.autoLock),
            autoUnlock: Boolean(saved.autoUnlock),
            autoRide: Boolean(saved.autoRide),
        };
    }

    /** @param {{ address: string, key: string } & Partial<Automatic> & { autoLock: boolean }} options */
    async function enable(options) {
        await plugin.setAutoConnect({ config: JSON.stringify(autoConnectConfig(options)) });
    }

    return {
        status,
        enable,
        async disable() {
            await plugin.setAutoConnect({});
        },
        /** Turns off auto-connect left on alone by an earlier version, with neither auto-lock nor auto-ride. */
        async turnOffAlone() {
            const { enabled, autoLock, autoRide } = await status();
            if (enabled && !needsAutoConnect({ autoLock, autoRide })) await plugin.setAutoConnect({});
        },
        /**
         * Sends what auto-connect runs with again, if it is on: the texts in the language of now, and the key the bike
         * accepted last. After a backup was restored, it turns auto-connect on again with the options it brought back,
         * which hold no key.
         * @param {{ address: string, key: string }} options
         * @returns {Promise<{ restored: boolean, autoRide: boolean }>} whether a restored backup turned it on, and with
         *     auto-ride
         */
        async refresh({ address, key }) {
            const { enabled, config, restored } = await plugin.getAutoConnect();
            const saved = enabled && config ? JSON.parse(config) : restored ? JSON.parse(restored) : null;
            if (!saved || !needsAutoConnect(saved)) {
                // Left on alone by an earlier version, it turns off, as no switch shows it.
                if (enabled) await plugin.setAutoConnect({});
                return { restored: false, autoRide: false };
            }
            const autoLock = Boolean(saved.autoLock);
            await enable({
                address,
                key,
                autoLock,
                autoUnlock: autoLock && Boolean(saved.autoUnlock),
                autoRide: Boolean(saved.autoRide),
            });
            return { restored: !enabled, autoRide: Boolean(saved.autoRide) };
        },
        /**
         * The rider locked or unlocked the bike in the app: a lock by hand holds against auto-unlock until they unlock
         * it by hand.
         * @param {boolean} locked
         */
        async lockPressed(locked) {
            await plugin.setLockHeld({ held: locked });
        },
        /**
         * Asks for location "all the time", for the route of the rides auto-ride starts with the app closed.
         * @returns {Promise<boolean>} whether it was granted
         */
        async askBackgroundLocation() {
            return (await plugin.requestBackgroundLocation()).granted;
        },
        /** @returns {Promise<boolean>} whether location "all the time" is granted, asking nothing */
        async hasBackgroundLocation() {
            return (await plugin.getBackgroundLocation()).granted;
        },
        /** @returns {Promise<Activity>} */
        async activity() {
            return JSON.parse((await plugin.getAutoConnectActivity()).activity);
        },
        /** The rider disconnected: auto-connect waits until they connect again. */
        async pause() {
            await plugin.pauseAutoConnect();
        },
        /** The rider asked to connect: a pause ends, and the app connects even after auto-connect let the bike go. */
        async riderConnecting() {
            await plugin.riderConnecting();
        },
        /**
         * The connection's signal strength, in dBm.
         * @param {string} deviceId
         */
        async readRssi(deviceId) {
            return (await plugin.readRssi({ deviceId })).value;
        },
    };
}

/** @typedef {ReturnType<typeof createAutoConnect>} AutoConnect */
