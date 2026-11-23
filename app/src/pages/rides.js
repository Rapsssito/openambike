// The rides tab, Android only: start, pause and stop a ride, which the app's native service records with the app
// closed, see it as it goes, and the history of rides, each with its figures, charts and route, exported as GPX one by
// one or all at once. A ride records whether the bike is connected or not: the bike's figures fill in while it is.
import {
    batteryHalf,
    bicycle,
    expand,
    flash,
    map,
    play,
    pause,
    person,
    shareOutline,
    speedometer,
    stop,
    time,
    trash,
    trendingUp,
} from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { LAYERS, layerRange, layerSeries, pointAt, routePoints } from '../rides/layers.js';
import { LAYER_COLOURS } from '../rides/route-map.js';
import { rideName, watchRides } from '../rides/rides.js';
import { describeError } from './errors.js';
import { distance, duration, number, speed } from './format.js';
import {
    actionRow,
    button,
    card,
    choice,
    confirmAction,
    el,
    icon,
    lineChart,
    openSheet,
    overlayButton,
    page,
    section,
    showToast,
    stat,
    whileBusy,
} from './ui.js';

/** @typedef {import('../rides/rides.js').Rides} Rides */
/** @typedef {import('../rides/ride.js').RideSummary} RideSummary */
/** @typedef {import('../rides/layers.js').Layer} Layer */
/** @typedef {import('../rides/layers.js').RoutePoint} RoutePoint */
/** @typedef {import('../rides/route-map.js').RouteView} RouteView */
/** @typedef {import('../preferences.js').Units} Units */

/** How often the ride being recorded, and whether one is, is read again while the app is on screen. */
const LIVE_MS = 2000;

/** Feet in a metre, for elevation in miles' units. */
const FEET_PER_METRE = 3.28084;

/** The icon of each layer, as the bike tab shows speed, the rider and the motor. */
const LAYER_ICONS = /** @type {const} */ ({ speed: speedometer, rider: person, motor: flash, elevation: trendingUp });

/** The colour of each layer's chart. */
const LAYER_SERIES = /** @type {const} */ ({
    speed: 'series-speed',
    rider: 'series-rider',
    motor: 'series-motor',
    elevation: 'series-speed',
});

/** The text of each layer. */
const LAYER_TEXTS = /** @type {const} */ ({
    speed: 'rides.layerSpeed',
    rider: 'rides.layerRider',
    motor: 'rides.layerMotor',
    elevation: 'rides.layerElevation',
});

/**
 * @param {unknown} error
 */
async function report(error) {
    const text = describeError(error);
    if (text) await showToast(text, 'error');
}

/**
 * @typedef {(container: HTMLElement, points: RoutePoint[], layer: Layer) => Promise<RouteView>} ShowRoute draws a
 *     ride's route on a map in the container, coloured by a layer, and again as it grows
 */

/**
 * A map of the route, drawn once it is in the page and the route has two points; hidden without internet.
 * @param {ShowRoute | undefined} showRoute
 * @param {string} size the map's class of height: '' for the usual, 'small' or 'tall'
 * @param {HTMLElement[]} [overlays] laid over its corners
 */
function routeMap(showRoute, size, overlays = []) {
    const container = el('div', { class: `ride-map ${size}`.trim() });
    // In the map's place until it has loaded: a map icon over a spinner.
    const loading = el('div', { class: 'map-loading', role: 'status', 'aria-label': t('rides.mapLoading') }, [
        icon(map, { class: 'map-loading-icon' }),
        el('ion-spinner', { name: 'crescent' }),
    ]);
    const element = el('div', { class: 'overlay-frame' }, [container, loading, ...overlays]);
    element.hidden = true;
    /** @type {RouteView | null} */
    let drawn = null;
    let drawing = false;
    let failed = false;
    /** @type {RoutePoint | null} */
    let cursor = null;
    return {
        element,
        /** @param {RoutePoint[]} points @param {Layer} layer */
        draw(points, layer) {
            element.hidden = !showRoute || points.length < 2 || failed;
            if (!showRoute || element.hidden || !element.isConnected) return;
            if (drawn) {
                drawn.update(points);
            } else if (!drawing) {
                drawing = true;
                // Without internet, the map stays hidden; the rest of the ride is on the phone.
                const fail = () => {
                    failed = true;
                    element.hidden = true;
                };
                showRoute(container, points, layer).then((view) => {
                    drawn = view;
                    if (cursor) view.setCursor(cursor);
                    view.ready.then(() => {
                        loading.hidden = true;
                    }, fail);
                }, fail);
            }
        },
        /** @param {Layer} layer */
        setLayer(layer) {
            drawn?.setLayer(layer);
        },
        /** @param {RoutePoint | null} point */
        setCursor(point) {
            cursor = point;
            drawn?.setCursor(point);
        },
    };
}

/**
 * A ride as its sheet shows it: its route on a map coloured by a layer, or why there is no route and its charts
 * instead; and its figures. The map opens over the whole screen with the chart of its layer.
 * `show` fills them from the ride's file, and again as it grows; the maps are drawn once they are in the page.
 * @param {() => Units} units
 * @param {ShowRoute} [showRoute] without it, no map is shown
 */
function rideView(units, showRoute) {
    /** @type {Layer} */
    let layer = LAYERS[0];
    /** @type {RoutePoint[]} */
    let points = [];
    /** @type {import('../rides/ride.js').BikeSample[]} */
    let samples = [];
    /** @type {import('../rides/ride.js').Fix[]} */
    let fixes = [];
    let startedAt = 0;
    /** What else shows the ride, as the map over the whole screen, while it is open. */
    /** @type {Set<() => void>} */
    const others = new Set();
    /** The choices of layer and the maps shown, kept alike. */
    /** @type {Set<{ set: (layer: Layer) => void, title: HTMLElement }>} */
    const choices = new Set();
    /** @type {Set<ReturnType<typeof routeMap>>} */
    const maps = new Set();

    const metric = () => units() !== 'mi';
    const speedUnit = () => (metric() ? 'km/h' : 'mph');
    /** A layer's unit, and its values in the rider's units. */
    /** @param {Layer} shown */
    const unitOf = (shown) => {
        if (shown === 'speed') return { unit: speedUnit(), scale: metric() ? 1 : 1 / 1.609344 };
        if (shown === 'elevation') return { unit: metric() ? 'm' : 'ft', scale: metric() ? 1 : FEET_PER_METRE };
        return { unit: 'W', scale: 1 };
    };
    /** A moment as the time since the start and the time of day. */
    /** @param {number} at @returns {[string, string]} */
    const timeText = (at) => [
        duration(at - startedAt),
        new Date(at).toLocaleTimeString(globalThis.document?.documentElement.lang || undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
    ];
    /** The name of the layer, with "no data" if the ride has no values for it. */
    const titleText = () => `${t(LAYER_TEXTS[layer])}${layerRange(points, layer) ? '' : ` · ${t('rides.noLayer')}`}`;
    /** The label of each map that has one: the name of the layer. */
    const showTitles = () => {
        for (const shown of choices) shown.title.textContent = titleText();
    };
    /** @param {Layer} next */
    const chooseLayer = (next) => {
        layer = next;
        for (const other of choices) other.set(next);
        for (const shown of maps) shown.setLayer(next);
        showTitles();
        for (const update of others) update();
    };

    /**
     * A choice of layer, by icons, kept alike with the others, and the chosen layer's name, as a label for the map.
     */
    const layerChoice = () => {
        const title = el('span', { class: 'map-label' }, ['']);
        const control = choice({
            label: t('rides.colourBy'),
            options: LAYERS.map((value) => ({ value, label: t(LAYER_TEXTS[value]), iconName: LAYER_ICONS[value] })),
            onChange: async (value) => chooseLayer(value),
        });
        const shown = {
            element: control.element,
            title,
            /** @param {Layer} value */
            set(value) {
                control.set(value);
            },
        };
        shown.set(layer);
        choices.add(shown);
        showTitles();
        return shown;
    };

    // The map over the whole screen, with the chart of its layer under it: touching the chart marks on the map where
    // the rider was then.
    const openMap = async () => {
        const control = layerChoice();
        const shownMap = routeMap(showRoute, 'tall', [control.title]);
        maps.add(shownMap);
        const chartCard = card([]);
        /** @type {Layer | null} */
        let charted = null;
        /** @type {ReturnType<typeof lineChart> | null} */
        let chart = null;
        const update = () => {
            shownMap.draw(points, layer);
            showTitles();
            if (charted !== layer || !chart) {
                charted = layer;
                const { unit } = unitOf(layer);
                chart = lineChart(t(LAYER_TEXTS[layer]), {
                    unit,
                    series: [{ name: t(LAYER_TEXTS[layer]), className: LAYER_SERIES[layer] }],
                    colours: LAYER_COLOURS,
                    timeText,
                    onPick: (at) => shownMap.setCursor(pointAt(points, at)),
                });
                chartCard.replaceChildren(chart.element);
            }
            const { scale: factor } = unitOf(layer);
            chart.set([layerSeries(samples, fixes, layer).map(([at, value]) => [at, value * factor])]);
        };
        others.add(update);
        await openSheet(t('rides.map'), [control.element, shownMap.element, chartCard], () => {
            others.delete(update);
            choices.delete(control);
            maps.delete(shownMap);
        });
        update();
    };

    // The route.
    const mainChoice = layerChoice();
    const mainMap = routeMap(showRoute, '', [
        mainChoice.title,
        overlayButton(expand, t('rides.fullMap'), () => openMap()),
    ]);
    maps.add(mainMap);
    const mapParts = el('div', {}, [mainChoice.element, mainMap.element]);
    // With no route, the ride says why, rather than leave a gap that looks like a fault, and shows its charts instead.
    const noRoute = el('p', { class: 'ride-state' }, [t('rides.noRoute')]);
    const speedChart = lineChart(t('rides.speedChart'), {
        unit: speedUnit(),
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

    // The figures, in pairs: the time, the distance and the battery, the speed, the power.
    const tiles = {
        moving: stat(t('rides.movingTime'), time),
        total: stat(t('rides.totalTime'), time),
        distance: stat(t('rides.distance'), map),
        energy: stat(t('rides.energy'), batteryHalf),
        average: stat(t('rides.averageSpeed'), speedometer),
        top: stat(t('rides.maxSpeed'), speedometer),
        rider: stat(t('rides.riderPower'), person),
        motor: stat(t('rides.motorPower'), flash),
    };
    const figuresCard = card([
        el(
            'div',
            { class: 'grid-2 inner' },
            Object.values(tiles).map((tile) => tile.element)
        ),
    ]);

    return {
        content: [mapParts, noRoute, speedCard, powerCard, figuresCard],

        /** @param {import('../rides/ride.js').RideReader} reader */
        show(reader) {
            const ride = reader.summary();
            samples = reader.bikeSamples();
            fixes = reader.route();
            startedAt = ride.startedAt;
            points = routePoints(fixes, samples);

            const unknown = t('common.unknown');
            const watts = (/** @type {number | null} */ value) => (value === null ? unknown : `${number(value, 0)} W`);
            tiles.moving.set(duration(ride.movingMs));
            tiles.total.set(duration(ride.totalMs));
            tiles.distance.set(ride.distanceFrom === null ? unknown : distance(ride.distanceKm, units(), undefined, 2));
            tiles.energy.set(ride.energyWh === null ? unknown : `${number(ride.energyWh, 1)} Wh`);
            tiles.average.set(ride.averageKmh === null ? unknown : speed(ride.averageKmh, units()));
            tiles.top.set(ride.maxKmh === null ? unknown : speed(ride.maxKmh, units()));
            tiles.rider.set(watts(ride.averageRiderWatts));
            tiles.motor.set(watts(ride.averageMotorWatts));

            const hasRoute = Boolean(showRoute) && ride.route.length >= 2;
            noRoute.hidden = ride.route.length >= 2;
            mapParts.hidden = !hasRoute;
            const { scale: toUnits } = unitOf('speed');
            speedChart.set([layerSeries(samples, fixes, 'speed').map(([at, value]) => [at, value * toUnits])]);
            powerChart.set([layerSeries(samples, fixes, 'motor'), layerSeries(samples, fixes, 'rider')]);
            speedCard.hidden = hasRoute || (samples.length === 0 && fixes.length === 0);
            powerCard.hidden = hasRoute || samples.length === 0;
            mainMap.draw(points, layer);
            showTitles();
            for (const update of others) update();
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
