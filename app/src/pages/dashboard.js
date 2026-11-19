// The bike tab: battery and speed first, then the controls used most (assist mode, lights, lock), then the ride's
// figures.
import { body, bulb, flash, lockClosed, map, navigate, speedometer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { distance, number, speed } from './format.js';
import { card, choice, el, gauge, page, section, send, stat, toggleTile } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../session.js').BikeState} BikeState */
/** @typedef {import('../preferences.js').Units} Units */

/**
 * @param {Session} session
 * @param {() => Units} units
 * @param {Node} status the connection status shown in the header
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function dashboardPage(session, units, status) {
    const battery = gauge(t('dashboard.battery'));
    const speedStat = stat(t('dashboard.speed'), speedometer);
    const motorStat = stat(t('dashboard.motorPower'), flash);
    const riderStat = stat(t('dashboard.riderPower'), body);

    const assistMode = choice({
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
        onChange: (locked) => send(() => session.setLocked(locked)),
    });

    const odometer = stat(t('dashboard.odometer'), map);
    const range = stat(t('dashboard.range'), navigate);

    /** @param {BikeState} state */
    const render = (state) => {
        battery.set(
            state.battery?.percent ?? null,
            state.range === null ? '' : t('dashboard.rangeCaption', { range: state.range })
        );
        if (state.metrics) {
            speedStat.set(speed(state.metrics.speedKmh, units()));
            motorStat.set(`${state.metrics.motorWatts} W`);
            riderStat.set(`${number(state.metrics.riderWatts, 0)} W`);
            odometer.set(distance(state.metrics.odometerKm, units()));
        }
        if (state.range !== null) range.set(String(state.range));
        assistMode.set(state.assistMode === null ? null : /** @type {'0' | '1' | '2'} */ (String(state.assistMode)));
        lights.set(state.lights);
        lock.set(state.locked);
    };

    const element = page(
        t('dashboard.title'),
        [
            card([
                el('div', { class: 'hero' }, [
                    battery.element,
                    el('div', { class: 'hero-figures' }, [speedStat.element, motorStat.element, riderStat.element]),
                ]),
            ]),
            el('section', { class: 'section' }, [
                el('h2', { class: 'section-title' }, [t('dashboard.assistMode')]),
                assistMode.element,
            ]),
            el('section', { class: 'section' }, [
                el('h2', { class: 'section-title' }, [t('dashboard.controls')]),
                el('div', { class: 'grid-2' }, [lights.element, lock.element]),
                el('p', { class: 'section-footer' }, [t('dashboard.lockHelp')]),
            ]),
            section(t('dashboard.ride'), [el('div', { class: 'grid-2 inner' }, [odometer.element, range.element])]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
