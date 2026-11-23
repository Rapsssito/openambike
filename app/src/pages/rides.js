// The rides tab, Android only: start, pause and stop a ride, which the app's native service records with the app
// closed, see it as it goes, and the history of rides, each with its figures, charts and route, exported as GPX one by
// one or all at once. A ride records whether the bike is connected or not: the bike's figures fill in while it is.
import { bicycle, map, play, pause, shareOutline, speedometer, stop, time, trash } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { rideName, watchRides } from '../rides/rides.js';
import { describeError } from './errors.js';
import { distance, duration, number, speed } from './format.js';
import {
    actionRow,
    button,
    card,
    confirmAction,
    el,
    icon,
    lineChart,
    openSheet,
    page,
    section,
    showToast,
    stat,
    whileBusy,
} from './ui.js';

/** @typedef {import('../rides/rides.js').Rides} Rides */
/** @typedef {import('../rides/ride.js').RideSummary} RideSummary */
/** @typedef {import('../preferences.js').Units} Units */

/** How often the ride being recorded, and whether one is, is read again while the app is on screen. */
const LIVE_MS = 2000;

/**
 * @param {unknown} error
 */
async function report(error) {
    const text = describeError(error);
    if (text) await showToast(text, 'error');
}

/**
 * A ride's figures, as tiles.
 * @param {RideSummary} ride
 * @param {Units} units
 */
function figures(ride, units) {
    const watts = (/** @type {number | null} */ value) =>
        value === null ? t('common.unknown') : `${number(value, 0)} W`;
    /** @type {[string, string, string][]} */
    const rows = [
        [t('rides.movingTime'), time, duration(ride.movingMs)],
        [t('rides.totalTime'), time, duration(ride.totalMs)],
        [
            t('rides.distance'),
            map,
            ride.distanceFrom === null ? t('common.unknown') : distance(ride.distanceKm, units, undefined, 2),
        ],
        [
            t('rides.averageSpeed'),
            speedometer,
            ride.averageKmh === null ? t('common.unknown') : speed(ride.averageKmh, units),
        ],
        [t('rides.maxSpeed'), speedometer, ride.maxKmh === null ? t('common.unknown') : speed(ride.maxKmh, units)],
        [t('rides.motorPower'), bicycle, watts(ride.averageMotorWatts)],
        [t('rides.riderPower'), bicycle, watts(ride.averageRiderWatts)],
        [t('rides.energy'), bicycle, ride.energyWh === null ? t('common.unknown') : `${number(ride.energyWh, 1)} Wh`],
    ];
    return el(
        'div',
        { class: 'grid-2 inner' },
        rows.map(([label, iconName, value]) => {
            const tile = stat(label, iconName);
            tile.set(value);
            return tile.element;
        })
    );
}

/**
 * @param {object} options
 * @param {Rides} options.rides
 * @param {() => Units} options.units
 * @param {Node} options.status the connection status shown in the header
 * @param {(container: HTMLElement, route: [number, number][]) => Promise<unknown>} [options.showRoute] draws a ride's route on a
 *     map in the container; without it, no map is shown
 * @returns {{ element: HTMLElement, render: () => void }}
 */
export function ridesPage({ rides, units, status, showRoute }) {
    // The ride being recorded.
    const movingTime = stat(t('rides.movingTime'), time);
    const rideDistance = stat(t('rides.distance'), map);
    const averageSpeed = stat(t('rides.averageSpeed'), speedometer);
    const state = el('p', { class: 'ride-state', role: 'status' }, [t('rides.none')]);
    const startButton = button(t('rides.start'));
    startButton.prepend(icon(play, { slot: 'start' }));
    const pauseButton = button(t('rides.pause'), { fill: 'outline' });
    const stopButton = button(t('rides.stop'), { color: 'danger' });
    stopButton.prepend(icon(stop, { slot: 'start' }));
    const live = el('div', {}, [
        el('div', { class: 'grid-2 inner' }, [movingTime.element, rideDistance.element]),
        el('div', { class: 'grid-2 inner' }, [averageSpeed.element]),
    ]);
    const actions = el('div', { class: 'ride-actions' }, [pauseButton, stopButton]);
    const current = [state, live, actions, el('div', { class: 'mode-actions' }, [startButton])];

    /** @type {{ id: number, paused: boolean } | null} */
    let active = null;

    /** @param {{ id: number, paused: boolean } | null} now the ride being recorded, as the service says */
    const showCurrent = async (now) => {
        active = now;
        startButton.hidden = active !== null;
        live.hidden = active === null;
        actions.hidden = active === null;
        if (!active) {
            state.textContent = t('rides.none');
            return;
        }
        pauseButton.textContent = t(active.paused ? 'rides.resume' : 'rides.pause');
        pauseButton.prepend(icon(active.paused ? play : pause, { slot: 'start' }));
        const reader = await rides.reader(active.id);
        const ride = reader.summary();
        const stopped = !active.paused && reader.stoppedAt(Date.now());
        state.textContent = t(active.paused ? 'rides.paused' : stopped ? 'rides.autoPaused' : 'rides.recordingNow');
        movingTime.set(duration(ride.movingMs));
        rideDistance.set(
            ride.distanceFrom === null ? t('common.unknown') : distance(ride.distanceKm, units(), undefined, 2)
        );
        averageSpeed.set(ride.averageKmh === null ? t('common.unknown') : speed(ride.averageKmh, units()));
    };

    // The service starts and stops rides by itself (auto-ride): the tab follows it, and shows the history again when a
    // ride starts or ends, so that a ride stopped by auto-ride leaves the current ride for the history.
    /** @type {() => Promise<void>} */
    let watch = async () => undefined;
    const refresh = async () => {
        try {
            await watch();
        } catch (error) {
            await report(error);
        }
    };

    startButton.addEventListener('click', () =>
        whileBusy(startButton, async () => {
            try {
                await rides.start();
            } catch (error) {
                await report(error);
            }
            await refresh();
        })
    );
    pauseButton.addEventListener('click', () =>
        whileBusy(pauseButton, async () => {
            if (!active) return;
            await rides.setPaused(!active.paused).catch(report);
            await refresh();
        })
    );
    stopButton.addEventListener('click', async () => {
        const header = t('rides.stop');
        if (!(await confirmAction({ header, message: t('rides.stopConfirm'), confirm: header }))) return;
        await whileBusy(stopButton, async () => {
            await rides.stop().catch(report);
            await refresh();
        });
    });

    // The history.
    const historyRows = el('div');
    const exportAllButton = button(t('rides.exportAll'), { fill: 'outline' });
    exportAllButton.prepend(icon(shareOutline, { slot: 'start' }));
    const history = section(
        t('rides.history'),
        [historyRows, el('div', { class: 'mode-actions' }, [exportAllButton])],
        { iconName: time }
    );
    exportAllButton.addEventListener('click', () =>
        whileBusy(exportAllButton, async () => {
            const ids = await rides.list();
            const finished = ids.filter((id) => id !== active?.id);
            if (finished.length > 0) await rides.exportRides(finished).catch(report);
        })
    );

    /** @param {number} id */
    const openRide = async (id) => {
        const reader = await rides.reader(id);
        const ride = reader.summary();
        const samples = reader.bikeSamples();
        const routeFixes = reader.route();
        const speedChart = lineChart(t('rides.speedChart'), {
            unit: units() === 'mi' ? 'mph' : 'km/h',
            series: [{ name: t('rides.speed'), className: 'series-speed' }],
        });
        const toUnits = (/** @type {number} */ kmh) => (units() === 'mi' ? kmh / 1.609344 : kmh);
        speedChart.set([
            samples.length > 0
                ? samples.map((s) => [s.t, toUnits(s.speedKmh)])
                : routeFixes.map((f) => [f.t, toUnits((f.speed ?? 0) * 3.6)]),
        ]);
        const powerChart = lineChart(t('rides.powerChart'), {
            unit: 'W',
            series: [
                { name: t('rides.motor'), className: 'series-motor' },
                { name: t('rides.rider'), className: 'series-rider' },
            ],
        });
        powerChart.set([samples.map((s) => [s.t, s.motorWatts]), samples.map((s) => [s.t, s.riderWatts])]);
        const exportButton = button(t('rides.export'));
        exportButton.prepend(icon(shareOutline, { slot: 'start' }));
        exportButton.addEventListener('click', () =>
            whileBusy(exportButton, () => rides.exportRides([id]).catch(report))
        );
        const deleteRow = actionRow({
            iconName: trash,
            label: t('rides.delete'),
            danger: true,
            onClick: async () => {
                const header = t('rides.delete');
                if (
                    !(await confirmAction({ header, message: t('rides.deleteConfirm'), confirm: header, danger: true }))
                ) {
                    return;
                }
                await rides.remove(id).catch(report);
                await showHistory();
                await showToast(t('rides.deleted'));
            },
        });
        const mapContainer = el('div', { class: 'ride-map' });
        mapContainer.hidden = !showRoute || ride.route.length < 2;
        // With no route, the ride says why, rather than leave a gap that looks like a fault.
        const noRoute = el('p', { class: 'ride-state' }, [t('rides.noRoute')]);
        noRoute.hidden = ride.route.length >= 2;
        await openSheet(rideName(id), [
            mapContainer,
            noRoute,
            card([figures(ride, units())]),
            ...(samples.length > 0 || routeFixes.length > 0 ? [card([speedChart.element])] : []),
            ...(samples.length > 0 ? [card([powerChart.element])] : []),
            el('div', { class: 'mode-actions stack' }, [exportButton]),
            card([deleteRow]),
        ]);
        if (showRoute && ride.route.length >= 2) {
            // Without internet, the map stays hidden; the rest of the ride is on the phone.
            showRoute(mapContainer, ride.route).catch(() => {
                mapContainer.hidden = true;
            });
        }
    };

    const showHistory = async () => {
        try {
            const rows = [];
            for (const ride of await rides.history(active?.id ?? null)) {
                const { id } = ride;
                const detail = [
                    ride.distanceFrom === null ? null : distance(ride.distanceKm, units(), undefined, 2),
                    duration(ride.movingMs),
                ]
                    .filter(Boolean)
                    .join(' · ');
                rows.push(actionRow({ iconName: bicycle, label: rideName(id), detail, onClick: () => openRide(id) }));
            }
            historyRows.replaceChildren(
                ...(rows.length > 0 ? rows : [el('p', { class: 'ride-state' }, [t('rides.noHistory')])])
            );
            exportAllButton.hidden = rows.length === 0;
        } catch (error) {
            await report(error);
        }
    };

    const element = page(
        t('rides.title'),
        [section(t('rides.current'), current, { iconName: bicycle }), history],
        status
    );
    watch = watchRides(rides, { showCurrent, showHistory });
    refresh();
    setInterval(() => {
        if (!globalThis.document.hidden) watch().catch(() => undefined);
    }, LIVE_MS);
    globalThis.document.addEventListener('visibilitychange', () => {
        if (!globalThis.document.hidden) refresh();
    });
    return {
        element,
        // A ride does not depend on the bike's connection; the figures it shows come from the ride's own file.
        render() {},
    };
}
