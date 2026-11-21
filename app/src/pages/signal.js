// The signal test: every bike a scan hears, with its address and how strong its signal is, to set the thresholds of
// auto-connect (docs/roadmap.md). It only listens to the bikes' advertising and sends nothing; a bike is heard only
// while no app is connected to it (docs/protocol.md, "Advertising"). Android only.
import { bicycle, informationCircleOutline } from 'ionicons/icons';

import { SCAN_MODE, scanForBikes } from '../ble/bike.js';
import { t } from '../i18n/i18n.js';
import { describeError } from './errors.js';
import { card, el, icon, openSheet, section, showToast, valueRow } from './ui.js';

/** @typedef {import('../ble/bike.js').BleClientLike} BleClientLike */

/** The time over which the average and the number of readings are taken. */
export const SIGNAL_WINDOW_MS = 5000;

/**
 * The latest reading, and the average and number of the readings of the last `windowMs`.
 * @param {{ at: number, rssi: number }[]} readings oldest first
 * @param {number} now
 * @param {number} [windowMs]
 * @returns {{ latest: number | null, average: number | null, count: number }}
 */
export function signalStats(readings, now, windowMs = SIGNAL_WINDOW_MS) {
    const recent = readings.filter((reading) => now - reading.at <= windowMs);
    const latest = readings.at(-1)?.rssi ?? null;
    if (recent.length === 0) return { latest, average: null, count: 0 };
    const average = recent.reduce((sum, reading) => sum + reading.rssi, 0) / recent.length;
    return { latest, average: Math.round(average), count: recent.length };
}

/**
 * Opens the signal test over the screen; the scan runs until it is closed.
 * @param {BleClientLike} client
 */
export async function openSignalTest(client) {
    const list = el('div');
    /** @type {Map<string, { readings: { at: number, rssi: number }[], rows: ReturnType<typeof valueRow>[] }>} */
    const bikes = new Map();
    /** @param {number | null} value */
    const dbm = (value) => (value === null ? t('common.unknown') : t('signal.dbm', { value: String(value) }));

    const refresh = () => {
        const now = Date.now();
        for (const bike of bikes.values()) {
            // Readings older than the window are dropped, so that the list does not grow while the test runs.
            bike.readings = bike.readings.filter((reading) => now - reading.at <= SIGNAL_WINDOW_MS);
            const stats = signalStats(bike.readings, now);
            const [, latest, average, count] = bike.rows;
            latest.set(dbm(stats.latest));
            average.set(dbm(stats.average));
            count.set(String(stats.count));
        }
    };
    const timer = setInterval(refresh, 500);

    /** @type {(() => Promise<void>) | null} */
    let stop = null;
    let closed = false;
    const close = () => {
        closed = true;
        clearInterval(timer);
        stop?.().catch(() => undefined);
    };

    await openSheet(
        t('signal.title'),
        [
            card([
                el('div', { class: 'row' }, [
                    icon(informationCircleOutline, { class: 'row-icon' }),
                    el('span', { class: 'row-label' }, [t('signal.note')]),
                ]),
            ]),
            el('p', { class: 'status-message', role: 'status' }, [t('home.searching')]),
            list,
        ],
        close
    );

    try {
        const stopScan = await scanForBikes(
            client,
            (found) => {
                let bike = bikes.get(found.deviceId);
                if (!bike) {
                    const rows = [
                        valueRow(t('signal.address')),
                        valueRow(t('signal.now')),
                        valueRow(t('signal.average')),
                        valueRow(t('signal.readings')),
                    ];
                    rows[0].set(found.deviceId);
                    bike = { readings: [], rows };
                    bikes.set(found.deviceId, bike);
                    list.append(
                        section(
                            found.name,
                            rows.map((row) => row.element),
                            { iconName: bicycle }
                        )
                    );
                }
                if (found.rssi !== null) bike.readings.push({ at: Date.now(), rssi: found.rssi });
            },
            { scanMode: SCAN_MODE.lowLatency }
        );
        if (closed) await stopScan();
        else stop = stopScan;
    } catch (error) {
        const text = describeError(error);
        if (text) await showToast(text, 'error');
    }
}
