// The battery tab: the charge first, with whether energy flows in or out shown by the gauge itself, then what flows,
// the battery's health (pack temperatures, charge cycles, energy and capacity against the rated capacity), and the
// rest.
import {
    batteryCharging,
    batteryFull,
    create,
    flash,
    hardwareChip,
    heart,
    pulse,
    refreshCircle,
    thermometer,
} from 'ionicons/icons';

import {
    DEFAULT_RATED_WH,
    fullCapacityWh,
    healthPercent,
    isRatedWh,
    MIN_CHARGE_PERCENT,
    RATED_WH_LIMITS,
} from '../battery-health.js';
import { t } from '../i18n/i18n.js';
import { loadRatedWh, saveRatedWh } from '../preferences.js';
import { isCharging } from '../session.js';
import { number } from './format.js';
import { actionRow, askNumber, card, el, gauge, page, section, showToast, stat, valueRow } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../session.js').BikeState} BikeState */

/**
 * @param {Session} session
 * @param {Node} status the connection status shown in the header
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function batteryPage(session, status) {
    const charge = gauge(t('battery.charge'));
    const voltage = stat(t('battery.voltage'), pulse);
    const current = stat(t('battery.current'), batteryCharging);
    const power = stat(t('battery.power'), flash);
    const pack1 = valueRow(t('battery.pack', { n: 1 }), thermometer);
    const pack2 = valueRow(t('battery.pack', { n: 2 }), thermometer);
    const cycles = stat(t('battery.cycles'), refreshCircle);
    const energy = valueRow(t('battery.energy'), batteryFull);
    const capacity = valueRow(t('battery.capacity'), batteryFull);
    const health = stat(t('battery.healthValue'), heart);
    const firmware = valueRow(t('battery.firmware'), hardwareChip);

    // Every known model is rated for 336 Wh; the rider can type another rating, such as a replacement battery's.
    let ratedWh = loadRatedWh() ?? DEFAULT_RATED_WH;
    const ratedLabel = () => t('battery.rated', { wh: number(ratedWh, 0) });
    const ratedRow = actionRow({
        iconName: create,
        label: ratedLabel(),
        onClick: async () => {
            const answer = await askNumber({
                header: t('battery.ratedTitle'),
                message: t('battery.ratedMessage', { wh: DEFAULT_RATED_WH }),
                value: ratedWh,
                unit: 'Wh',
                confirm: t('battery.ratedSave'),
                reset: t('battery.ratedReset', { wh: DEFAULT_RATED_WH }),
            });
            if (answer === null) return;
            if (answer !== 'reset' && !isRatedWh(answer)) {
                return showToast(t('battery.ratedInvalid', RATED_WH_LIMITS), 'error');
            }
            ratedWh = answer === 'reset' ? DEFAULT_RATED_WH : answer;
            saveRatedWh(answer === 'reset' ? null : answer);
            const label = ratedRow.querySelector('.row-label');
            if (label) label.textContent = ratedLabel();
            render(session.state);
        },
    });

    /** @param {BikeState} state */
    const render = (state) => {
        const battery = state.battery;
        if (battery) {
            const amps = battery.milliamps / 1000;
            const flow = isCharging(battery) ? 'charging' : battery.milliamps > 0 ? 'discharging' : 'idle';
            const flowLabel = {
                charging: t('battery.charging'),
                discharging: t('battery.discharging'),
                idle: t('battery.idle'),
            }[flow];
            charge.set(battery.percent, '', flow, flowLabel);
            voltage.set(`${number(battery.volts, 2)} V`);
            current.set(`${number(Math.abs(amps), 2)} A`);
            power.set(`${number(Math.abs(amps * battery.volts), 0)} W`);
            energy.set(
                battery.absoluteSoc === null ? t('common.unknown') : `${number(battery.absoluteSoc / 1000, 0)} Wh`
            );
        }
        const full = fullCapacityWh(battery);
        const ratio = healthPercent(battery, ratedWh);
        capacity.set(full === null ? t('common.unknown') : `${number(full, 0)} Wh`);
        health.set(ratio === null ? t('common.unknown') : `${number(ratio, 0)} %`);
        if (state.packTemperaturesC) {
            pack1.set(`${number(state.packTemperaturesC[0], 1)} °C`);
            pack2.set(`${number(state.packTemperaturesC[1], 1)} °C`);
        }
        if (state.batteryCycles !== null) cycles.set(number(state.batteryCycles, 0));
        if (state.batteryFirmwareStatus !== null) firmware.set(state.batteryFirmwareStatus);
    };

    const element = page(
        t('battery.title'),
        [
            card([
                el('div', { class: 'hero' }, [
                    el('div', { class: 'hero-view' }, [
                        charge.element,
                        el('div', { class: 'hero-figures' }, [voltage.element, current.element, power.element]),
                    ]),
                ]),
            ]),
            section(
                t('battery.health'),
                [
                    el('div', { class: 'grid-2 inner' }, [health.element, cycles.element]),
                    pack1.element,
                    pack2.element,
                    energy.element,
                    capacity.element,
                    ratedRow,
                ],
                { iconName: heart, footer: t('battery.healthNote', { min: MIN_CHARGE_PERCENT }) }
            ),
            section(t('battery.details'), [firmware.element]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
