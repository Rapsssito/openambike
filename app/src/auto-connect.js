// Auto-connect and auto-lock, Android only: what the app's native service needs to connect to the bike, lock it and
// let it go with the app closed (android/app/src/main/java/org/openambike/app/link/). This module prepares it from
// protocol.js and the translation files, so that the service knows neither the protocol nor the languages.
import { toHex } from './ble/native-client.js';
import { ASI_MOVEMENT_BYTES, CHARACTERISTIC, encodeLock, encodeOwnerKey, OWNER_OK } from './ble/protocol.js';
import { t } from './i18n/i18n.js';
import { rideConfig } from './rides/rides.js';

/** @typedef {import('./ble/native-client.js').BikeLinkPlugin} BikeLinkPlugin */

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
    /** Connects once the bike's advertising averages above this for `nearMs`: about 1.5 m, phone in a pocket. */
    nearDbm: -72,
    nearMs: 10_000,
    /**
     * Lets go once the connection's signal averages below this for `farMs`: about 4 to 5 m, early enough to lock
     * before the link drops at walking pace with the rider's body between phone and bike; a wall (-80 dBm) does not.
     */
    farDbm: -80,
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
            looking: t('autoConnect.looking'),
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
            if (!saved) return { restored: false, autoRide: false };
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
        /** The rider disconnected: auto-connect waits until they connect again. */
        async pause() {
            await plugin.pauseAutoConnect();
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
