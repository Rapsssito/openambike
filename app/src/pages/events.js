// Auto-connect's events in the rider's words, for the fold under Settings, "Automatic": what auto-connect did and
// why, newest first; the newest few at first, all of them on asking.
import { t } from '../i18n/i18n.js';

/** @typedef {import('../auto-connect.js').EventsReport} EventsReport */

/** How many events the fold shows before the rider asks for all of them. */
export const RECENT_EVENTS = 5;

/**
 * What the fold says: the newest events, and all of them, newest first.
 * @param {EventsReport} report
 * @param {string} [locale]
 * @returns {{ recent: { time: string, text: string }[], events: { time: string, text: string }[] }}
 */
export function describeEvents(report, locale = globalThis.document?.documentElement.lang || undefined) {
    if (!report.running) return { recent: [], events: [] };
    const events = (report.events ?? []).map(({ at, event, value, extra = 0 }) => ({
        time: new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: t(/** @type {Parameters<typeof t>[0]} */ (`events.${event}`), {
            value: String(value),
            extra: String(extra),
        }),
    }));
    return { recent: events.slice(0, RECENT_EVENTS), events };
}
