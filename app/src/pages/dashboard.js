// The bike tab, in two views with one layout: a large figure with others beside it, the assist mode, and the lights
// and lock tiles. Parked, for before a ride: a ring with the charge, beside it the range and the odometer. Riding: the
// speed, beside it motor power, rider power and the charge as horizontal bars marked by icons. The lock can be pressed in
// both: locked while riding, the bike only stops assisting (docs/protocol.md, "Commands sent to the bike"). The view
// follows whether the bike is being ridden, and the rider can switch it by hand until the next change.
import { batteryHalf, bulb, flash, lockClosed, map, navigate, person } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { isCharging } from '../session.js';
import { distance, KM_PER_MILE, number } from './format.js';
import { rideDetector } from './ride-mode.js';
import { card, choice, el, gauge, meter, page, readout, send, stat, toggleTile } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../session.js').BikeState} BikeState */
/** @typedef {import('../preferences.js').Units} Units */
/** @typedef {'parked' | 'riding'} View */

/**
 * The power at which the motor's and the rider's bars are full: the rated power of a pedelec in the EU, which the
 * motor does not exceed for long (docs/safety.md, "Changes to legal limits"). Above it, a bar stays full.
 */
const FULL_POWER_W = 250;

/** How often the ride detector is told the time, so that a ride ends when the bike stops sending figures. */
const TICK_MS = 1000;

/**
 * @param {Session} session
 * @param {() => Units} units
 * @param {Node} status the connection status shown in the header
 * @param {{ onLockPressed?: (locked: boolean) => void }} [options] told once the bike took a lock or unlock pressed here
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function dashboardPage(session, units, status, { onLockPressed } = {}) {
    const ride = rideDetector();
    const viewChoice = choice({
        label: t('dashboard.view'),
        options: [
            { value: /** @type {View} */ ('parked'), label: t('dashboard.parked') },
            { value: /** @type {View} */ ('riding'), label: t('dashboard.riding') },
        ],
        onChange: async (value) => show(value),
    });
    viewChoice.element.classList.add('local');

    // Each view's large figure and the figures beside it, in the same place.
    const ring = gauge(t('dashboard.battery'));
    const range = stat(t('dashboard.range'), navigate);
    const odometer = stat(t('dashboard.odometer'), map);
    const speed = readout(t('dashboard.speed'));
    const motor = meter(t('dashboard.motorPower'), flash);
    const rider = meter(t('dashboard.riderPower'), person);
    const charge = meter(t('dashboard.battery'), batteryHalf);
    const parkedFigures = el('div', { class: 'hero-figures' }, [range.element, odometer.element]);
    const ridingFigures = el('div', { class: 'hero-figures' }, [motor.element, rider.element, charge.element]);
    // Both views in the same place, each split in half: the card keeps the height of the taller, so that choosing a
    // view changes only what the card holds.
    const parkedView = el('div', { class: 'hero-view' }, [ring.element, parkedFigures]);
    const ridingView = el('div', { class: 'hero-view' }, [speed.element, ridingFigures]);

    const assist = choice({
        label: t('dashboard.assistMode'),
        options: [
            { value: '0', label: t('dashboard.assistNone') },
            { value: '1', label: t('dashboard.mode', { n: 1 }) },
            { value: '2', label: t('dashboard.mode', { n: 2 }) },
        ],
        onChange: (value) => send(() => session.setAssistMode(Number(value))),
    });
    const lights = toggleTile({
        iconName: bulb,
        label: t('dashboard.lights'),
        on: t('dashboard.on'),
        off: t('dashboard.off'),
        onChange: (on) => send(() => session.setLights(on)),
    });
    const lock = toggleTile({
        iconName: lockClosed,
        label: t('dashboard.lock'),
        on: t('dashboard.locked'),
        off: t('dashboard.unlocked'),
        onChange: async (locked) => {
            const sent = await send(() => session.setLocked(locked));
            if (sent) onLockPressed?.(locked);
            return sent;
        },
    });

    /** @type {import('../ble/protocol.js').AsiMetrics | null} */
    let lastMetrics = null;

    /** @param {BikeState} state */
    const render = (state) => {
        const metrics = state.metrics;
        if (metrics && metrics !== lastMetrics) {
            lastMetrics = metrics;
            if (ride.observe(metrics, Date.now())) return show(ride.riding ? 'riding' : 'parked');
        }

        const percent = state.battery?.percent ?? null;
        const miles = units() === 'mi';
        ring.set(percent, '');
        charge.set(
            percent === null ? t('common.unknown') : `${percent} %`,
            percent === null ? null : percent / 100,
            percent !== null && percent <= 20
        );
        speed.set(
            metrics ? number(miles ? metrics.speedKmh / KM_PER_MILE : metrics.speedKmh, 1) : t('common.unknown'),
            miles ? 'mph' : 'km/h'
        );
        range.set(state.range === null ? t('common.unknown') : distance(state.range, units(), undefined, 0));
        if (metrics) {
            // Whole kilometres, so that the figure fits beside the ring.
            odometer.set(distance(metrics.odometerKm, units(), undefined, 0));
            motor.set(`${metrics.motorWatts} W`, metrics.motorWatts / FULL_POWER_W);
            rider.set(`${number(metrics.riderWatts, 0)} W`, metrics.riderWatts / FULL_POWER_W);
        }
        assist.set(state.assistMode === null ? null : /** @type {'0' | '1' | '2'} */ (String(state.assistMode)));
        // The bike leaves its lights as they are while it charges (docs/protocol.md, "Lights").
        lights.set(state.lights, isCharging(state.battery) ? t('dashboard.notWhileCharging') : null);
        lock.set(state.locked);
    };

    /** @param {View} next */
    function show(next) {
        viewChoice.set(next);
        for (const [view, name] of /** @type {const} */ ([
            [parkedView, 'parked'],
            [ridingView, 'riding'],
        ])) {
            // Out of sight but still holding its space, and out of reach of screen readers and the keyboard.
            view.classList.toggle('inactive', next !== name);
            view.toggleAttribute('inert', next !== name);
            view.setAttribute('aria-hidden', String(next !== name));
        }
        render(session.state);
    }

    const element = page(
        t('dashboard.title'),
        [
            card([viewChoice.element, el('div', { class: 'hero' }, [parkedView, ridingView])]),
            el('section', { class: 'section' }, [
                el('h2', { class: 'section-title' }, [t('dashboard.assistMode')]),
                assist.element,
            ]),
            el('section', { class: 'section' }, [
                el('h2', { class: 'section-title' }, [t('dashboard.controls')]),
                el('div', { class: 'grid-2' }, [lights.element, lock.element]),
            ]),
        ],
        status
    );
    const timer = setInterval(() => {
        if (!element.isConnected && element.dataset.shown) return clearInterval(timer);
        if (element.isConnected) element.dataset.shown = 'true';
        if (ride.tick(Date.now())) show(ride.riding ? 'riding' : 'parked');
    }, TICK_MS);
    show('parked');
    return { element, render };
}
