// Auto-connect's activity in the rider's words, for the fold under Settings, "Automatic": what it is doing now and where
// its timers stand, also while the app is on screen and only watches, and its history, newest first.
import { t } from '../i18n/i18n.js';
import { duration } from './format.js';

/** @typedef {import('../auto-connect.js').Activity} Activity */
/** @typedef {import('../auto-connect.js').Automatic} Automatic */

/** @param {number} ms */
const seconds = (ms) => String(Math.ceil(ms / 1000));

/**
 * What auto-connect is doing, in a sentence.
 * @param {Activity} activity
 */
function stateText(activity) {
    switch (activity.state) {
        case 'APP':
            return t(activity.connected ? 'activity.stateApp' : 'activity.stateAppLooking');
        case 'IDLE':
            return t('activity.stateIdle');
        case 'NEAR':
            return activity.nearDbm === undefined
                ? t('activity.stateIdle')
                : t('activity.stateNear', { dbm: String(activity.nearDbm) });
        case 'CONNECTING':
            return t('activity.stateConnecting');
        case 'CONNECTED':
            return t('activity.stateConnected');
        case 'LEAVING':
            return t('activity.stateLeaving');
        case 'PAUSED':
            return t('activity.statePaused');
        default:
            return t('activity.stateOff');
    }
}

/**
 * The lines of the fold: what it does now, with its timers while the bike is connected, and the history.
 * @param {Activity} activity
 * @param {Automatic} automatic the options the rider turned on
 * @param {string} [locale]
 * @returns {{ now: { label: string, value: string }[], history: { time: string, text: string }[] }}
 */
export function describeActivity(activity, automatic, locale = globalThis.document?.documentElement.lang || undefined) {
    if (!activity.running) return { now: [{ label: t('activity.state'), value: t('activity.stateOff') }], history: [] };
    const now = [{ label: t('activity.state'), value: stateText(activity) }];
    const holding = activity.connected && (activity.state === 'APP' || activity.state === 'CONNECTED');
    if (holding) {
        now.push({
            label: t('activity.signal'),
            // The latest reading, and the median over the far time that auto-lock decides on, once measured.
            value:
                activity.signalNowDbm === undefined
                    ? t('activity.signalMeasuring')
                    : activity.signalDbm === undefined || !activity.signalSettled
                      ? t('activity.signalNow', { now: String(activity.signalNowDbm) })
                      : t('activity.signalValue', {
                            now: String(activity.signalNowDbm),
                            median: String(activity.signalDbm),
                        }),
        });
        if (automatic.autoLock) {
            const ago = activity.movedAgoMs;
            const left = activity.guardLeftMs ?? 0;
            now.push({
                label: t('activity.movement'),
                value:
                    ago === undefined
                        ? t('activity.neverMoved')
                        : left > 0
                          ? t('activity.movedWaiting', { ago: String(Math.floor(ago / 1000)), left: seconds(left) })
                          : t('activity.movedCanLock', { ago: duration(ago) }),
            });
        }
        now.push({
            label: t('activity.parked'),
            value: t('activity.parkedLeft', { time: duration(activity.parkedLeftMs ?? 0) }),
        });
        now.push({
            label: t('activity.lock'),
            value:
                automatic.autoUnlock && activity.lockHeld
                    ? t('activity.lockHeld')
                    : activity.locked === undefined
                      ? t('activity.lockUnknown')
                      : t(activity.locked ? 'activity.locked' : 'activity.unlocked'),
        });
    }
    const history = (activity.history ?? []).map(({ at, event, value }) => ({
        time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: t(/** @type {Parameters<typeof t>[0]} */ (`activity.${event}`), { value: String(value) }),
    }));
    return { now, history };
}
