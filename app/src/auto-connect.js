// Auto-connect and auto-lock, Android only: what the app's native service needs to connect to the bike, lock it and
// let it go with the app closed (android/app/src/main/java/org/openambike/app/link/). This module prepares it from
// protocol.js and the translation files, so that the service knows neither the protocol nor the languages.
import { toHex } from './ble/native-client.js';
import { ASI_MOVEMENT_BYTES, CHARACTERISTIC, encodeLock, encodeOwnerKey, OWNER_OK } from './ble/protocol.js';
import { t } from './i18n/i18n.js';
import { rideConfig } from './rides/rides.js';
import { currentThresholds } from './thresholds.js';

/** @typedef {import('./ble/native-client.js').BikeLinkPlugin} BikeLinkPlugin */

/**
 * What auto-connect does, as the service says it: whether it runs, and its events, newest first.
 * @typedef {object} EventsReport
 * @property {boolean} running
 * @property {{ at: number, event: string, value: number, extra?: number }[]} [events] `at` in milliseconds since 1970
 */

/**
 * The automatic options, as the rider sets them: auto-lock only with auto-connect, auto-unlock only with auto-lock,
 * auto-ride only with auto-connect.
 * @typedef {{ autoLock: boolean, autoUnlock: boolean, autoRide: boolean }} Automatic
 */

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
    const { auth, lock, asiMetrics, battery } = CHARACTERISTIC;
    const thresholds = currentThresholds();
    const minutes = String(thresholds.parkedMs / 60_000);
    return {
        address,
        autoLock,
        autoUnlock: autoLock && autoUnlock,
        autoRide,
        // What a ride auto-ride starts records, as one started by hand.
        ...(autoRide ? { ride: rideConfig() } : {}),
        // A ride records the battery's notifications too, which the app's session listens to only while it is open.
        ...(autoRide ? { battery: { service: battery.service, characteristic: battery.uuid } } : {}),
        auth: {
            service: auth.service,
            characteristic: auth.uuid,
            value: hex(encodeOwnerKey(key)),
            reply: hex(new TextEncoder().encode(OWNER_OK)),
        },
        lock: { service: lock.service, characteristic: lock.uuid, value: hex(encodeLock(true)) },
        unlock: { service: lock.service, characteristic: lock.uuid, value: hex(encodeLock(false)) },
        movement: { service: asiMetrics.service, characteristic: asiMetrics.uuid, ...ASI_MOVEMENT_BYTES },
        // What the rider set in Settings, the defaults where nothing is: every signal level and wait the service decides with.
        thresholds,
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
        /** @returns {Promise<EventsReport>} */
        async events() {
            return JSON.parse((await plugin.getAutoConnectEvents()).events);
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
