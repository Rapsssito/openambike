// Auto-connect's history in the rider's words, for the fold under Settings, "Automatic": the signal as last read, and
// what auto-connect did and why, newest first; the newest few at first, all of them on asking.
import { t } from '../i18n/i18n.js';

/** @typedef {import('../auto-connect.js').Activity} Activity */

/** The bike's advertising older than this is out of range. */
const HEARD_MS = 15_000;

/** How many events the fold shows before the rider asks for all of them. */
export const RECENT_EVENTS = 5;

/** @param {number} dbm */
const dbmText = (dbm) => `${dbm} dBm`;

/**
 * The signal as last read: of the connection while connected, of the bike's advertising otherwise; after the connection
 * dropped, how long auto-connect still waits for it to come back.
 * @param {Activity} activity
 */
function signalText(activity) {
    if (activity.dropLeftMs !== undefined) {
        return t('activity.signalDropped', { time: `${Math.ceil(activity.dropLeftMs / 1000)} s` });
    }
    if (activity.connected) {
        return activity.signalNowDbm === undefined ? t('activity.signalMeasuring') : dbmText(activity.signalNowDbm);
    }
    if (activity.heardDbm !== undefined && (activity.heardAgoMs ?? Infinity) < HEARD_MS) {
        return dbmText(activity.heardDbm);
    }
    return t('activity.signalOut');
}

/**
 * What the fold says: the signal, the newest events, and all of them, newest first.
 * @param {Activity} activity
 * @param {string} [locale]
 * @returns {{ signal: string, recent: { time: string, text: string }[], history: { time: string, text: string }[] }}
 */
export function describeActivity(activity, locale = globalThis.document?.documentElement.lang || undefined) {
    if (!activity.running) return { signal: t('activity.stateOff'), recent: [], history: [] };
    const history = (activity.history ?? []).map(({ at, event, value }) => ({
        time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: t(/** @type {Parameters<typeof t>[0]} */ (`activity.${event}`), { value: String(value) }),
    }));
    return { signal: signalText(activity), recent: history.slice(0, RECENT_EVENTS), history };
}
