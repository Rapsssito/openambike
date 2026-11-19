// The battery tab: the charge first, then what flows in or out, the packs' temperatures, and the rest.
import { analytics, batteryCharging, flash, hardwareChip, pulse, thermometer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { number } from './format.js';
import { card, el, gauge, page, section, stat, valueRow } from './ui.js';

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
    const pack1 = stat(t('battery.pack', { n: 1 }), thermometer);
    const pack2 = stat(t('battery.pack', { n: 2 }), thermometer);
    const absoluteSoc = valueRow(t('battery.absoluteSoc'), analytics);
    const firmware = valueRow(t('battery.firmware'), hardwareChip);

    /** @param {BikeState} state */
    const render = (state) => {
        const battery = state.battery;
        if (battery) {
            const amps = battery.milliamps / 1000;
            const flow =
                battery.milliamps < 0
                    ? t('battery.charging')
                    : battery.milliamps > 0
                      ? t('battery.discharging')
                      : t('battery.idle');
            charge.set(battery.percent, flow);
            voltage.set(`${number(battery.volts, 2)} V`);
            current.set(`${number(Math.abs(amps), 2)} A`);
            power.set(`${number(Math.abs(amps * battery.volts), 0)} W`);
            absoluteSoc.set(battery.absoluteSoc === null ? t('common.unknown') : number(battery.absoluteSoc, 0));
        }
        if (state.packTemperaturesC) {
            pack1.set(`${number(state.packTemperaturesC[0], 1)} °C`);
            pack2.set(`${number(state.packTemperaturesC[1], 1)} °C`);
        }
        if (state.batteryFirmwareStatus !== null) firmware.set(state.batteryFirmwareStatus);
    };

    const element = page(
        t('battery.title'),
        [
            card([
                el('div', { class: 'hero' }, [
                    charge.element,
                    el('div', { class: 'hero-figures' }, [voltage.element, current.element, power.element]),
                ]),
            ]),
            section(t('battery.temperatures'), [el('div', { class: 'grid-2 inner' }, [pack1.element, pack2.element])], {
                iconName: thermometer,
            }),
            section(t('battery.details'), [absoluteSoc.element, firmware.element], {
                footer: t('battery.absoluteSocNote'),
            }),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
