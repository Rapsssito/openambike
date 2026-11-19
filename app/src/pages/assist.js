// The assist tab: assist speed and assist amount of each mode, each written only within the bike's limits and only
// when the rider saves it.
import { flash, speedometer } from 'ionicons/icons';

import { ASSIST_LIMITS } from '../ble/protocol.js';
import { t } from '../i18n/i18n.js';
import { KM_PER_MILE, number } from './format.js';
import { button, card, el, icon, page, send, showToast, whileBusy } from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../session.js').BikeState} BikeState */
/** @typedef {import('../preferences.js').Units} Units */

/**
 * A labelled slider with its value large above it and its limits under it.
 * @param {{ label: string, iconName: string, min: number, max: number, format: (value: number) => string, onInput: () => void }} options
 */
function slider({ label, iconName, min, max, format, onInput }) {
    const value = el('span', { class: 'slider-value' });
    const range = el('ion-range', { min: String(min), max: String(max), step: '1', 'aria-label': label });
    const read = () => Number(/** @type {{ value?: unknown }} */ (range).value);
    const show = () => {
        value.textContent = format(read());
    };
    range.addEventListener('ionInput', () => {
        show();
        onInput();
    });
    const element = el('div', { class: 'slider' }, [
        el('div', { class: 'slider-head' }, [
            el('span', { class: 'slider-label' }, [icon(iconName), ' ', label]),
            value,
        ]),
        range,
        el('div', { class: 'slider-limits' }, [el('span', {}, [format(min)]), el('span', {}, [format(max)])]),
    ]);
    return {
        element,
        read,
        /** @param {number} next */
        set(next) {
            Object.assign(range, { value: next });
            show();
        },
        show,
    };
}

/**
 * @param {Session} session
 * @param {() => Units} units
 * @param {Node} status the connection status shown in the header
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function assistPage(session, units, status) {
    const { minSpeedKmh, maxSpeedKmh, minPercent, maxPercent } = ASSIST_LIMITS;

    /** @param {number} kmh */
    const formatSpeed = (kmh) =>
        units() === 'mi' ? `${kmh} km/h · ${number(kmh / KM_PER_MILE, 1)} mph` : `${kmh} km/h`;

    /** @param {1 | 2} mode */
    function modeEditor(mode) {
        const badge = el('span', { class: 'mode-badge' });
        const speedSlider = slider({
            label: t('assist.speed'),
            iconName: speedometer,
            min: minSpeedKmh,
            max: maxSpeedKmh,
            format: formatSpeed,
            onInput: () => showChanged(),
        });
        const amountSlider = slider({
            label: t('assist.amount'),
            iconName: flash,
            min: minPercent,
            max: maxPercent,
            format: (percent) => `${percent} %`,
            onInput: () => showChanged(),
        });
        const save = button(t('assist.save', { n: mode }));
        /** The values on the bike, to tell whether the sliders changed them. */
        let onBike = { speedKmh: -1, amountPercent: -1 };

        const changed = () => speedSlider.read() !== onBike.speedKmh || amountSlider.read() !== onBike.amountPercent;
        const showChanged = () => {
            const dirty = changed();
            save.toggleAttribute('disabled', !dirty);
            badge.textContent = dirty ? t('assist.unsaved') : t('assist.onBike');
            badge.classList.toggle('dirty', dirty);
        };

        save.addEventListener('click', async () => {
            const setting = { speedKmh: speedSlider.read(), amountPercent: amountSlider.read() };
            const sent = await whileBusy(save, () => send(() => session.changeAssistMode(mode, setting)));
            if (sent) await showToast(t('assist.saved', { n: mode }));
            showChanged();
        });

        const element = card(
            [
                el('div', { class: 'mode-head' }, [
                    el('span', { class: 'mode-name' }, [t('assist.mode', { n: mode })]),
                    badge,
                ]),
                speedSlider.element,
                amountSlider.element,
                el('div', { class: 'mode-actions' }, [save]),
            ],
            'mode-card'
        );

        /** @param {import('../ble/protocol.js').AssistLevel} level */
        const render = (level) => {
            const next = { speedKmh: Math.round(level.speedKmh), amountPercent: level.powerPercent };
            const wasDirty = onBike.speedKmh !== -1 && changed();
            onBike = next;
            if (!wasDirty) {
                speedSlider.set(next.speedKmh);
                amountSlider.set(next.amountPercent);
            }
            speedSlider.show();
            showChanged();
        };
        return { element, render };
    }

    const mode1 = modeEditor(1);
    const mode2 = modeEditor(2);

    /** @param {BikeState} state */
    const render = (state) => {
        if (!state.assistLevels) return;
        mode1.render(state.assistLevels.mode1);
        mode2.render(state.assistLevels.mode2);
    };

    const element = page(
        t('assist.title'),
        [
            el('p', { class: 'lead' }, [t('assist.intro')]),
            el('div', { class: 'stack' }, [mode1.element, mode2.element]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
