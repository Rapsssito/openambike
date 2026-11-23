// Auto-connect's activity in the rider's words, for the fold under Settings, "Automatic": the signal, whether the bike
// moves, the lock and the ride, each with its countdown while one runs, and the history, newest first.
import { AUTO_CONNECT_THRESHOLDS } from '../auto-connect.js';
import { t } from '../i18n/i18n.js';
import { duration } from './format.js';

/** @typedef {import('../auto-connect.js').Activity} Activity */
/** @typedef {import('../auto-connect.js').Automatic} Automatic */

/** The bike's advertising older than this is out of range. */
const HEARD_MS = 15_000;
/** The bike moves while it reported movement this recently. */
const MOVING_MS = 5_000;

/**
 * A countdown: seconds under a minute, minutes and seconds above.
 * @param {number} ms
 */
const countdown = (ms) => (ms < 60_000 ? `${Math.ceil(ms / 1000)} s` : duration(ms));

/** @param {number} dbm */
const dbmText = (dbm) => `${dbm} dBm`;

/**
 * The signal as last read: of the connection while connected, of the bike's advertising otherwise; after the connection
 * dropped, how long auto-connect still waits for it to come back.
 * @param {Activity} activity
 */
function signalText(activity) {
    if (activity.dropLeftMs !== undefined) return t('activity.signalDropped', { time: countdown(activity.dropLeftMs) });
    if (activity.connected) {
        return activity.signalNowDbm === undefined ? t('activity.signalMeasuring') : dbmText(activity.signalNowDbm);
    }
    if (activity.heardDbm !== undefined && (activity.heardAgoMs ?? Infinity) < HEARD_MS) {
        return dbmText(activity.heardDbm);
    }
    return t('activity.signalOut');
}

/** @param {Activity} activity */
function movingText(activity) {
    if (!activity.connected) return t('activity.unknown');
    const moving = activity.movedAgoMs !== undefined && activity.movedAgoMs < MOVING_MS;
    return t(moving ? 'activity.movingYes' : 'activity.movingNo');
}

/**
 * The lock, with the signal that changes it, or the countdown to the change.
 * @param {Activity} activity
 * @param {Automatic} automatic
 */
function lockText(activity, automatic) {
    if (activity.state === 'PAUSED') return t('activity.statePaused');
    if (activity.leaveInMs !== undefined && activity.locked !== true) {
        return t('activity.lockingIn', { time: countdown(activity.leaveInMs) });
    }
    const unlocks = automatic.autoUnlock && !activity.lockHeld;
    if (activity.locked === true) {
        if (unlocks && activity.connectInMs !== undefined) {
            return t('activity.unlockingIn', { time: countdown(activity.connectInMs) });
        }
        if (automatic.autoUnlock && activity.lockHeld) return t('activity.lockedByYou');
        if (!unlocks) return t('activity.locked');
        return t('activity.lockedTo', { dbm: String(AUTO_CONNECT_THRESHOLDS.nearDbm) });
    }
    if (activity.locked === false) return t('activity.unlockedTo', { dbm: String(AUTO_CONNECT_THRESHOLDS.farDbm) });
    return t('activity.unknown');
}

/** @param {Activity} activity */
function rideText(activity) {
    const ride = activity.ride;
    if (ride?.stopInMs !== undefined) return t('activity.rideStoppingIn', { time: countdown(ride.stopInMs) });
    if (ride?.active) return t('activity.rideActive');
    if (ride?.startInMs !== undefined) return t('activity.rideStartingIn', { time: countdown(ride.startInMs) });
    return t('activity.rideInactive');
}

/**
 * The lines of the fold: the signal, the movement, the lock with auto-lock on, the ride with auto-ride on, and the
 * history.
 * @param {Activity} activity
 * @param {Automatic} automatic the options the rider turned on
 * @param {string} [locale]
 * @returns {{ now: { label: string, value: string }[], history: { time: string, text: string }[] }}
 */
export function describeActivity(activity, automatic, locale = globalThis.document?.documentElement.lang || undefined) {
    if (!activity.running) return { now: [{ label: t('activity.state'), value: t('activity.stateOff') }], history: [] };
    const now = [
        { label: t('activity.signal'), value: signalText(activity) },
        { label: t('activity.moving'), value: movingText(activity) },
        ...(automatic.autoLock ? [{ label: t('activity.lock'), value: lockText(activity, automatic) }] : []),
        ...(automatic.autoRide ? [{ label: t('activity.ride'), value: rideText(activity) }] : []),
    ];
    const history = (activity.history ?? []).map(({ at, event, value }) => ({
        time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: t(/** @type {Parameters<typeof t>[0]} */ (`activity.${event}`), { value: String(value) }),
    }));
    return { now, history };
}
