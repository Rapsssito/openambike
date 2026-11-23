// The automatic options, auto-lock, auto-unlock and auto-ride: settings of the phone that the app's native service keeps
// (Android only), shown in Settings, with or without a bike connected. Auto-connect has no switch of its own: it runs
// while auto-lock or auto-ride is on, which need it, and stops once both are off.
import { bicycle, bluetooth, lockClosed, lockOpen, time, warning } from 'ionicons/icons';

import { needsAutoConnect } from '../auto-connect.js';
import { t } from '../i18n/i18n.js';
import { describeActivity, RECENT_EVENTS } from './activity.js';
import { describeError } from './errors.js';
import { actionRow, button, card, confirmAction, el, fold, openSheet, section, showToast, switchRow } from './ui.js';

/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */
/** @typedef {import('../auto-connect.js').AutoConnect} AutoConnect */
/** @typedef {import('../auto-connect.js').Automatic} Automatic */

const NONE = Object.freeze({ autoLock: false, autoUnlock: false, autoRide: false });

/**
 * Auto-unlock is offered only with auto-lock, indented under it, so that a bike unlocked on arrival is locked again on
 * leaving. The web app shows auto-lock and auto-ride greyed out, and says that they need the Android app.
 * @param {object} options
 * @param {AutoConnect | null} options.autoConnect on Android only
 * @param {KeyStore} options.keyStore
 * @param {() => string | null} options.address the Bluetooth address of the bike auto-connect connects to
 * @param {(enabled: boolean) => void} [options.onShow] called whenever it shows whether auto-connect runs
 * @returns {{ element: HTMLElement, stop: () => void }} `stop` ends its watch of the app and of the activity
 */
export function automaticSection({ autoConnect, keyStore, address, onShow }) {
    /** @type {Automatic} */
    let automatic = NONE;
    const unavailable = autoConnect ? undefined : t('more.needsApp');
    const showAutomatic = () => {
        const enabled = needsAutoConnect(automatic);
        autoLockRow.set(automatic.autoLock);
        autoUnlockRow.set(automatic.autoUnlock);
        autoRideRow.set(automatic.autoRide);
        autoUnlockRow.element.hidden = !automatic.autoLock;
        activityFold.hidden = !enabled;
        if (!enabled) activityFold.open = false;
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
        const wanted = Boolean(autoConnect) && automatic.autoRide;
        rideLocationRow.hidden = !wanted || (await autoConnect?.hasBackgroundLocation().catch(() => true)) !== false;
    };
    // Back from Android's settings, where "all the time" is allowed, or after the permission was taken back.
    const onVisible = () => {
        if (document.visibilityState === 'visible') checkRideLocation();
    };
    document.addEventListener('visibilitychange', onVisible);
    /**
     * Sets the automatic options asked: auto-connect runs with them while one needs it, and stops otherwise. Shows what
     * the phone then has.
     * @param {Automatic} asked
     */
    const apply = async (asked) => {
        if (!autoConnect) return;
        const next = { ...asked, autoUnlock: asked.autoLock && asked.autoUnlock };
        try {
            if (!needsAutoConnect(next)) {
                await autoConnect.disable();
                automatic = NONE;
            } else {
                const ownerKey = await keyStore.load();
                const bike = address();
                if (ownerKey === null || bike === null) {
                    // With no bike known or no key saved, as before the first connection, nothing turns on.
                    await showToast(t('more.autoConnectNeedsBike'), 'error');
                } else {
                    await autoConnect.enable({ address: bike, key: ownerKey, ...next });
                    automatic = next;
                }
            }
        } catch (error) {
            const text = describeError(error);
            if (text) await showToast(text, 'error');
        }
        showAutomatic();
    };
    const autoLockRow = switchRow({
        label: t('more.autoLock'),
        iconName: lockClosed,
        info: t('more.autoLockInfo'),
        local: true,
        unavailable,
        onChange: (on) => apply({ ...automatic, autoLock: on }),
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
            await apply({ ...automatic, autoUnlock: on });
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
            await apply({ ...automatic, autoRide: on });
        },
    });
    autoUnlockRow.element.hidden = true;

    // The history, folded: the signal as last read, read every second while open and on screen, and what auto-connect
    // did and why, newest first: the newest few, and all of them in a sheet on asking, so that the page stays short.
    const signalList = el('div');
    const recentList = el('div');
    /** @param {string} first @param {string} second */
    const line = (first, second) =>
        el('div', { class: 'fold-line' }, [el('span', {}, [first]), el('span', {}, [second])]);
    /** @type {{ time: string, text: string }[]} */
    let allEvents = [];
    const showAllButton = button(t('activity.showAll'), { fill: 'outline' });
    showAllButton.hidden = true;
    showAllButton.addEventListener('click', () =>
        openSheet(t('activity.title'), [
            card([
                el(
                    'div',
                    { class: 'history-lines' },
                    allEvents.map(({ time: at, text }) => line(at, text))
                ),
            ]),
        ])
    );
    const readActivity = async () => {
        if (!autoConnect || document.visibilityState !== 'visible') return;
        const activity = await autoConnect.activity().catch(() => null);
        if (!activity) return;
        const { signal, recent, history } = describeActivity(activity);
        allEvents = history;
        signalList.replaceChildren(line(t('activity.signal'), signal));
        recentList.replaceChildren(
            ...(recent.length > 0
                ? recent.map(({ time: at, text }) => line(at, text))
                : [el('div', { class: 'fold-line' }, [t('activity.none')])])
        );
        showAllButton.hidden = history.length <= RECENT_EVENTS;
    };
    /** @type {ReturnType<typeof setInterval> | null} */
    let activityTimer = null;
    const stopActivity = () => {
        if (activityTimer !== null) clearInterval(activityTimer);
        activityTimer = null;
    };
    const activityFold = fold({
        iconName: time,
        label: t('activity.title'),
        content: [signalList, recentList, showAllButton],
        onToggle: (open) => {
            stopActivity();
            if (!open) return;
            readActivity();
            activityTimer = setInterval(readActivity, 1000);
        },
    });
    activityFold.hidden = true;

    // Indented under what they depend on: auto-unlock under auto-lock, the warning about location under auto-ride.
    for (const row of [autoUnlockRow.element, rideLocationRow]) row.classList.add('sub-option');
    const element = section(
        t('more.automatic'),
        [autoLockRow.element, autoUnlockRow.element, autoRideRow.element, rideLocationRow, activityFold],
        { iconName: bluetooth }
    );
    if (autoConnect) {
        autoConnect
            .status()
            .then(({ enabled, autoLock, autoUnlock, autoRide }) => {
                automatic = enabled ? { autoLock, autoUnlock, autoRide } : NONE;
                showAutomatic();
            })
            .catch(() => showAutomatic());
    } else {
        // In the web app, auto-lock and auto-ride show, off and greyed out, and auto-unlock, which depends on one, not.
        autoLockRow.set(false);
        autoRideRow.set(false);
        autoUnlockRow.element.hidden = true;
    }
    const stop = () => {
        document.removeEventListener('visibilitychange', onVisible);
        stopActivity();
    };
    return { element, stop };
}
