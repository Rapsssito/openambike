// The automatic options, auto-connect, auto-lock, auto-unlock and auto-ride: settings of the phone that the app's native
// service keeps (Android only), shown in Settings, with or without a bike connected.
import { bicycle, bluetooth, lockClosed, lockOpen, warning } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { describeError } from './errors.js';
import { actionRow, confirmAction, section, showToast, switchRow } from './ui.js';

/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */
/** @typedef {import('../auto-connect.js').AutoConnect} AutoConnect */

/**
 * Auto-lock and auto-ride are offered only with auto-connect, and auto-unlock only with auto-lock, so that a bike
 * unlocked on arrival is locked again on leaving. The web app shows them greyed out, and says they need the app.
 * @param {object} options
 * @param {AutoConnect | null} options.autoConnect on Android only
 * @param {KeyStore} options.keyStore
 * @param {() => string | null} options.address the Bluetooth address of the bike auto-connect connects to
 * @param {HTMLElement[]} [options.rows] more rows, shown only while auto-connect is on
 * @param {(enabled: boolean) => void} [options.onShow] called whenever it shows whether auto-connect is on
 * @returns {{ element: HTMLElement, stop: () => void }} `stop` ends its watch of the app coming back on screen
 */
export function automaticSection({ autoConnect, keyStore, address, rows = [], onShow }) {
    /** @type {import('../auto-connect.js').Automatic} */
    let automatic = { autoLock: false, autoUnlock: false, autoRide: false };
    const unavailable = autoConnect ? undefined : t('more.needsApp');
    /** @param {boolean} enabled */
    const showAutoConnect = (enabled) => {
        autoConnectRow.set(enabled);
        autoLockRow.set(automatic.autoLock);
        autoUnlockRow.set(automatic.autoUnlock);
        autoRideRow.set(automatic.autoRide);
        autoLockRow.element.hidden = !enabled;
        autoUnlockRow.element.hidden = !enabled || !automatic.autoLock;
        autoRideRow.element.hidden = !enabled;
        for (const row of rows) row.hidden = !enabled;
        if (onShow) onShow(enabled);
        checkRideLocation();
    };
    // While auto-ride is on without location "all the time", a warning with "Allow": rides it starts with the app
    // closed would have no route, as after a restored backup or Android taking back the permissions of an app unused.
    const rideLocationRow = actionRow({
        iconName: warning,
        label: t('more.autoRideAllow'),
        detail: t('more.autoRideLocationOff'),
        onClick: async () => {
            if (autoConnect) await autoConnect.askBackgroundLocation().catch(() => false);
            await checkRideLocation();
        },
    });
    rideLocationRow.hidden = true;
    const checkRideLocation = async () => {
        const wanted = Boolean(autoConnect) && !autoRideRow.element.hidden && automatic.autoRide;
        rideLocationRow.hidden = !wanted || (await autoConnect?.hasBackgroundLocation().catch(() => true)) !== false;
    };
    // Back from Android's settings, where "all the time" is allowed, or after the permission was taken back.
    const onVisible = () => {
        if (document.visibilityState === 'visible') checkRideLocation();
    };
    document.addEventListener('visibilitychange', onVisible);
    /**
     * Turns auto-connect on, with the automatic asked, or off; shows what the phone then has.
     * @param {boolean} enabled
     * @param {import('../auto-connect.js').Automatic} asked
     */
    const applyAutoConnect = async (enabled, asked) => {
        if (!autoConnect) return;
        const next = { ...asked, autoUnlock: asked.autoLock && asked.autoUnlock };
        try {
            const ownerKey = enabled ? await keyStore.load() : null;
            const bike = address();
            const on = enabled && ownerKey !== null && bike !== null;
            if (on) {
                await autoConnect.enable({ address: bike, key: ownerKey, ...next });
                automatic = next;
            } else {
                await autoConnect.disable();
                automatic = { autoLock: false, autoUnlock: false, autoRide: false };
            }
            showAutoConnect(on);
            // Turned on with no bike known or no key saved, as before the first connection, it stays off.
            if (enabled && !on) await showToast(t('more.autoConnectNeedsBike'), 'error');
        } catch (error) {
            const text = describeError(error);
            if (text) await showToast(text, 'error');
        }
    };
    const autoConnectRow = switchRow({
        label: t('more.autoConnect'),
        iconName: bluetooth,
        info: t('more.autoConnectInfo'),
        local: true,
        unavailable,
        onChange: (on) => applyAutoConnect(on, automatic),
    });
    const autoLockRow = switchRow({
        label: t('more.autoLock'),
        iconName: lockClosed,
        info: t('more.autoLockInfo'),
        local: true,
        unavailable,
        onChange: (on) => applyAutoConnect(true, { ...automatic, autoLock: on }),
    });
    const autoUnlockRow = switchRow({
        label: t('more.autoUnlock'),
        iconName: lockOpen,
        info: t('more.autoUnlockInfo'),
        local: true,
        unavailable,
        onChange: async (on) => {
            // Turning it on is confirmed first, with what it does (docs/safety.md, "What the project never does").
            const header = t('more.autoUnlock');
            if (
                on &&
                !(await confirmAction({ header, message: t('more.autoUnlockConfirm'), confirm: t('more.turnOn') }))
            ) {
                return;
            }
            await applyAutoConnect(true, { ...automatic, autoUnlock: on });
        },
    });
    const autoRideRow = switchRow({
        label: t('more.autoRide'),
        iconName: bicycle,
        info: t('more.autoRideInfo'),
        local: true,
        unavailable,
        onChange: async (on) => {
            // Location "all the time" gives the rides it starts with the app closed their route; refused, the warning
            // under it stays, with "Allow".
            if (on && autoConnect) await autoConnect.askBackgroundLocation().catch(() => false);
            await applyAutoConnect(true, { ...automatic, autoRide: on });
        },
    });
    const element = section(
        t('more.automatic'),
        [
            autoConnectRow.element,
            autoLockRow.element,
            autoUnlockRow.element,
            autoRideRow.element,
            rideLocationRow,
            ...rows,
        ],
        { iconName: bluetooth }
    );
    if (autoConnect) {
        autoConnect
            .status()
            .then(({ enabled, autoLock, autoUnlock, autoRide }) => {
                automatic = { autoLock, autoUnlock, autoRide };
                showAutoConnect(enabled);
            })
            .catch(() => showAutoConnect(false));
    } else {
        // In the web app, every option shows, off and greyed out.
        for (const row of [autoConnectRow, autoLockRow, autoUnlockRow, autoRideRow]) row.set(false);
        for (const row of rows) row.hidden = true;
    }
    return { element, stop: () => document.removeEventListener('visibilitychange', onVisible) };
}
