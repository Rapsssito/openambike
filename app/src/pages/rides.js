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
 * @typedef {(container: HTMLElement, route: [number, number][]) => Promise<{ update: (route: [number, number][]) => void }>}
 *     ShowRoute draws a ride's route on a map in the container, and again as it grows
 */

/**
 * A ride as its sheet shows it: its route on a map, why there is none, its figures and its charts. `show` fills them from
 * the ride's file, and again as it grows; the map is drawn once the parts are in the page.
 * @param {() => Units} units
 * @param {ShowRoute} [showRoute] without it, no map is shown
 */
function rideView(units, showRoute) {
    const mapContainer = el('div', { class: 'ride-map' });
    mapContainer.hidden = true;
    // With no route, the ride says why, rather than leave a gap that looks like a fault.
    const noRoute = el('p', { class: 'ride-state' }, [t('rides.noRoute')]);
    const figuresCard = card([]);
    const speedChart = lineChart(t('rides.speedChart'), {
        unit: units() === 'mi' ? 'mph' : 'km/h',
        series: [{ name: t('rides.speed'), className: 'series-speed' }],
    });
    const powerChart = lineChart(t('rides.powerChart'), {
        unit: 'W',
        series: [
            { name: t('rides.motor'), className: 'series-motor' },
            { name: t('rides.rider'), className: 'series-rider' },
        ],
    });
    const speedCard = card([speedChart.element]);
    const powerCard = card([powerChart.element]);
    /** @type {Promise<unknown> | null} */
    let drawing = null;
    /** @type {{ update: (route: [number, number][]) => void } | null} */
    let drawn = null;
    let mapFailed = false;
    const toUnits = (/** @type {number} */ kmh) => (units() === 'mi' ? kmh / 1.609344 : kmh);

    return {
        content: [mapContainer, noRoute, figuresCard, speedCard, powerCard],

        /** @param {import('../rides/ride.js').RideReader} reader */
        show(reader) {
            const ride = reader.summary();
            const samples = reader.bikeSamples();
            const routeFixes = reader.route();
            figuresCard.replaceChildren(figures(ride, units()));
            speedChart.set([
                samples.length > 0
                    ? samples.map((s) => [s.t, toUnits(s.speedKmh)])
                    : routeFixes.map((f) => [f.t, toUnits((f.speed ?? 0) * 3.6)]),
            ]);
            powerChart.set([samples.map((s) => [s.t, s.motorWatts]), samples.map((s) => [s.t, s.riderWatts])]);
            speedCard.hidden = samples.length === 0 && routeFixes.length === 0;
            powerCard.hidden = samples.length === 0;
            const hasRoute = ride.route.length >= 2;
            noRoute.hidden = hasRoute;
            mapContainer.hidden = !showRoute || !hasRoute || mapFailed;
            if (!showRoute || !hasRoute || mapFailed || !mapContainer.isConnected) return;
            if (drawn) {
                drawn.update(ride.route);
            } else if (!drawing) {
                // Without internet, the map stays hidden; the rest of the ride is on the phone.
                drawing = showRoute(mapContainer, ride.route).then(
                    (map) => {
                        drawn = map;
                    },
                    () => {
                        mapFailed = true;
                        mapContainer.hidden = true;
                    }
                );
            }
        },
    };
}

/**
 * @param {object} options
 * @param {Rides} options.rides
 * @param {() => Units} options.units
 * @param {Node} options.status the connection status shown in the header
 * @param {ShowRoute} [options.showRoute] draws a ride's route on a map in the container; without it, no map is shown
 * @returns {{ element: HTMLElement, render: () => void }}
 */
export function ridesPage({ rides, units, status, showRoute }) {
    /** @type {{ id: number, paused: boolean } | null} */
    let active = null;
    /** The sheet of the ride being recorded, while it is open, and what fills it again. */
    /** @type {{ id: number, close: () => void } | null} */
    let currentSheet = null;

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

    /** Every pair of "Pause" or "Resume" and "Stop ride" shown: under the current ride, and in its sheet. */
    /** @type {Set<() => void>} */
    const controls = new Set();
    const showControls = () => {
        for (const sync of controls) sync();
    };

    /** "Pause" or "Resume" and "Stop ride", for the ride being recorded. */
    const rideControls = () => {
        const pauseButton = button(t('rides.pause'), { fill: 'outline' });
        const stopButton = button(t('rides.stop'), { color: 'danger' });
        stopButton.prepend(icon(stop, { slot: 'start' }));
        const sync = () => {
            pauseButton.textContent = t(active?.paused ? 'rides.resume' : 'rides.pause');
            pauseButton.prepend(icon(active?.paused ? play : pause, { slot: 'start' }));
        };
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
        sync();
        controls.add(sync);
        return {
            element: el('div', { class: 'ride-actions' }, [pauseButton, stopButton]),
            sync,
            forget: () => controls.delete(sync),
        };
    };

    /** Opens the ride being recorded over the whole screen, as a ride of the history opens, kept up to date. */
    const openCurrent = async () => {
        if (!active || currentSheet) return;
        const { id } = active;
        const view = rideView(units, showRoute);
        const buttons = rideControls();
        const show = async () => view.show(await rides.reader(id));
        await show();
        const timer = setInterval(() => {
            if (!globalThis.document.hidden) show().catch(() => undefined);
        }, LIVE_MS);
        /** @type {{ id: number, modal: { dismiss: () => unknown } | null, close: () => void }} */
        const sheet = {
            id,
            modal: null,
            close: () => {
                sheet.modal?.dismiss();
            },
        };
        currentSheet = sheet;
        sheet.modal = await openSheet(t('rides.current'), [...view.content, buttons.element], () => {
            clearInterval(timer);
            buttons.forget();
            if (currentSheet === sheet) currentSheet = null;
        });
        // The map is drawn once the sheet is in the page; the ride may have ended meanwhile.
        if (active?.id !== id) {
            sheet.close();
            return;
        }
        await show();
    };

    // The ride being recorded, as one row that opens it, or "Start ride".
    const currentRow = el('div');
    const startButton = button(t('rides.start'));
    startButton.prepend(icon(play, { slot: 'start' }));
    const currentControls = rideControls();
    const current = [currentRow, currentControls.element, el('div', { class: 'mode-actions' }, [startButton])];

    /** @param {{ id: number, paused: boolean } | null} now the ride being recorded, as the service says */
    const showCurrent = async (now) => {
        active = now;
        startButton.hidden = active !== null;
        currentControls.element.hidden = active === null;
        // The sheet of a ride that ended closes: the history now shows it.
        if (currentSheet && currentSheet.id !== active?.id) currentSheet.close();
        if (!active) {
            currentRow.replaceChildren(el('p', { class: 'ride-state', role: 'status' }, [t('rides.none')]));
            return;
        }
        showControls();
        const reader = await rides.reader(active.id);
        const ride = reader.summary();
        const stopped = !active.paused && reader.stoppedAt(Date.now());
        const detail = [
            duration(ride.movingMs),
            ride.distanceFrom === null ? null : distance(ride.distanceKm, units(), undefined, 2),
        ]
            .filter(Boolean)
            .join(' · ');
        currentRow.replaceChildren(
            actionRow({
                iconName: bicycle,
                label: t(active.paused ? 'rides.paused' : stopped ? 'rides.autoPaused' : 'rides.recordingNow'),
                detail,
                onClick: () => openCurrent(),
            })
        );
    };

    startButton.addEventListener('click', () =>
        whileBusy(startButton, async () => {
            try {
                await rides.start();
            } catch (error) {
                await report(error);
            }
            await refresh();
            await openCurrent();
        })
    );

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
        const view = rideView(units, showRoute);
        view.show(reader);
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
        await openSheet(rideName(id), [
            ...view.content,
            el('div', { class: 'mode-actions stack' }, [exportButton]),
            card([deleteRow]),
        ]);
        view.show(reader);
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
