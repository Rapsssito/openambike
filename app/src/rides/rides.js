// Rides, Android only: the app's native service records them with the app closed, and this module asks it to start,
// pause and stop, lists and reads what it kept, and exports rides as GPX through Android's share menu.
import { ASI_ODOMETER, CHARACTERISTIC } from '../ble/protocol.js';
import { t } from '../i18n/i18n.js';
import { KM_PER_MILE } from '../pages/format.js';
import { loadUnits } from '../preferences.js';
import { ridesToGpx } from './gpx.js';
import { createRideReader, SUMMARY_VERSION } from './ride.js';

/** @typedef {import('../ble/native-client.js').BikeLinkPlugin} BikeLinkPlugin */
/** @typedef {import('./ride.js').RideReader} RideReader */
/** @typedef {import('./ride.js').RideSummary} RideSummary */
/** @typedef {Omit<RideSummary, 'route'>} HistoryEntry a ride's summary as the history keeps it, without its route */

/**
 * A summary kept, if it was made the way rides are summed up now.
 * @param {string | undefined} text
 * @returns {HistoryEntry | null}
 */
function keptSummary(text) {
    if (!text) return null;
    try {
        const { version, ...summary } = JSON.parse(text);
        return version === SUMMARY_VERSION ? summary : null;
    } catch {
        return null;
    }
}

/** The bike's characteristics a ride keeps the notifications of: speed and power, and the battery's energy. */
export const RIDE_CHARACTERISTICS = Object.freeze([CHARACTERISTIC.asiMetrics.uuid, CHARACTERISTIC.battery.uuid]);

/**
 * A ride's name, as its export and its row in the history show it: its date and time.
 * @param {number} id when it started
 * @param {string} [locale]
 */
export function rideName(id, locale = globalThis.document?.documentElement.lang || undefined) {
    return new Date(id).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What the service records a ride with, started by hand or by auto-ride: the characteristics it keeps, where the
 * odometer is, for the distance its notification shows, in the rider's units, and the texts of its notification.
 * @param {import('../preferences.js').Units} [units]
 */
export function rideConfig(units = loadUnits()) {
    return {
        characteristics: RIDE_CHARACTERISTICS,
        odometer: { characteristic: CHARACTERISTIC.asiMetrics.uuid, ...ASI_ODOMETER },
        distance: units === 'mi' ? { kmPerUnit: KM_PER_MILE, unit: 'mi' } : { kmPerUnit: 1, unit: 'km' },
        texts: {
            title: t('app.name'),
            quietChannel: t('autoConnect.quietChannel'),
            alertChannel: t('autoConnect.alertChannel'),
            rideChannel: t('rides.channel'),
            riding: t('rides.recording'),
            ridePaused: t('rides.pausedNotification'),
            pause: t('rides.pause'),
            resume: t('rides.resume'),
        },
    };
}

/** @param {BikeLinkPlugin} plugin */
export function createRides(plugin) {
    /** What has been read of each ride, so that a ride that grows is read only from where it was left. */
    /** @type {Map<number, { reader: RideReader, next: number }>} */
    const read = new Map();

    /**
     * A ride's reader, brought up to date with its file.
     * @param {number} id
     * @returns {Promise<RideReader>}
     */
    async function reader(id) {
        let entry = read.get(id);
        if (!entry) {
            entry = { reader: createRideReader(id), next: 0 };
            read.set(id, entry);
        }
        const { text, next } = await plugin.readRide({ id, from: entry.next });
        entry.reader.push(text);
        entry.next = next;
        return entry.reader;
    }

    /**
     * Offers rides as one GPX file through Android's share menu.
     * @param {number[]} ids
     */
    async function exportRides(ids) {
        const rides = [];
        for (const id of [...ids].sort((a, b) => a - b)) rides.push({ name: rideName(id), reader: await reader(id) });
        const day = new Date(Math.max(...ids)).toISOString().slice(0, 10);
        const name = ids.length === 1 ? `openambike-ride-${day}.gpx` : `openambike-rides-${day}.gpx`;
        await plugin.shareFile({
            name,
            text: ridesToGpx(rides, { creator: t('app.name') }),
            type: 'application/gpx+xml',
            title: t('rides.export'),
        });
    }

    return {
        /** Starts a ride; Android asks for the phone's location the first time. */
        async start() {
            return (await plugin.startRide({ config: JSON.stringify(rideConfig()) })).id;
        },

        /** @returns {Promise<number | null>} the ride stopped, if any */
        async stop() {
            return (await plugin.stopRide()).id ?? null;
        },

        /** @param {boolean} paused */
        async setPaused(paused) {
            await plugin.pauseRide({ paused });
        },

        /** @returns {Promise<{ id: number, paused: boolean } | null>} the ride being recorded */
        async active() {
            const ride = await plugin.getRide();
            return ride.active && ride.id !== undefined ? { id: ride.id, paused: Boolean(ride.paused) } : null;
        },

        /** @returns {Promise<number[]>} the rides kept, newest first */
        async list() {
            return (await plugin.listRides()).rides.map((ride) => ride.id);
        },

        reader,

        /**
         * The rides kept, newest first, but the one being recorded, as summaries. The summary of a ride that ended is
         * kept by the service once made, so that its file is read only once.
         * @param {number | null} [activeId]
         * @returns {Promise<HistoryEntry[]>}
         */
        async history(activeId = null) {
            const entries = [];
            for (const ride of (await plugin.listRides()).rides) {
                if (ride.id === activeId) continue;
                let entry = keptSummary(ride.summary);
                if (!entry) {
                    // Read on its own, not kept in memory: the history may hold many rides.
                    const whole = createRideReader(ride.id);
                    whole.push((await plugin.readRide({ id: ride.id, from: 0 })).text);
                    const { route: _route, ...summary } = whole.summary();
                    entry = summary;
                    if (summary.ended) {
                        const text = JSON.stringify({ version: SUMMARY_VERSION, ...summary });
                        await plugin.saveRideSummary({ id: ride.id, summary: text }).catch(() => undefined);
                    }
                }
                entries.push(entry);
            }
            return entries;
        },

        /** @param {number} id */
        async remove(id) {
            await plugin.deleteRide({ id });
            read.delete(id);
        },

        exportRides,
    };
}

/** @typedef {ReturnType<typeof createRides>} Rides */
