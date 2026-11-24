// The assist tab: assist speed and assist amount of the two modes, written together, only within the bike's limits and
// only when the rider saves them, with an undo and a save button under them. Each mode's badge says how its sliders
// stand against the bike, the only source of what is saved: "Saved" once the bike returns what was written; a slider
// moved shows the bike's value beside its own, struck through.
import { arrowUndo, flash, save as saveIcon, speedometer } from 'ionicons/icons';

import { ASSIST_LIMITS } from '../ble/protocol.js';
import { t } from '../i18n/i18n.js';
import { KM_PER_MILE, number } from './format.js';
import { button, card, el, icon, page, send, showToast, slider } from './ui.js';

/** @typedef {import('../bike-link.js').BikeView} BikeView */
/** @typedef {import('../session.js').BikeState} BikeState */
/** @typedef {import('../preferences.js').Units} Units */

/**
 * @param {BikeView} session
 * @param {() => Units} units
 * @param {Node} status the connection status shown in the header
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function assistPage(session, units, status) {
    const { minSpeedKmh, maxSpeedKmh, minPercent, maxPercent } = ASSIST_LIMITS;

    /** @param {number} kmh */
    const formatSpeed = (kmh) =>
        units() === 'mi' ? `${kmh} km/h · ${number(kmh / KM_PER_MILE, 1)} mph` : `${kmh} km/h`;

    /** @typedef {import('../ble/protocol.js').AssistSetting} AssistSetting */

    /** @param {1 | 2} mode */
    function modeEditor(mode) {
        const badge = el('span', { class: 'mode-badge', role: 'status' });
        const speedSlider = slider({
            label: t('assist.speed'),
            iconName: speedometer,
            min: minSpeedKmh,
            max: maxSpeedKmh,
            format: formatSpeed,
            onInput: () => showState(),
        });
        const amountSlider = slider({
            label: t('assist.amount'),
            iconName: flash,
            min: minPercent,
            max: maxPercent,
            format: (percent) => `${percent} %`,
            onInput: () => showState(),
        });
        const element = card(
            [
                el('div', { class: 'mode-head' }, [
                    el('span', { class: 'mode-name' }, [t('assist.mode', { n: mode })]),
                    badge,
                ]),
                speedSlider.element,
                amountSlider.element,
            ],
            'mode-card'
        );
        return {
            element,
            /** @returns {AssistSetting} */
            read: () => ({ speedKmh: speedSlider.read(), amountPercent: amountSlider.read() }),
            /** @param {AssistSetting} setting */
            set(setting) {
                speedSlider.set(setting.speedKmh);
                amountSlider.set(setting.amountPercent);
            },
            /**
             * Shows how the mode stands against the bike: its badge, and the bike's values beside the sliders moved.
             * @param {AssistSetting | null} bike
             * @param {boolean} saving
             */
            showState(bike, saving) {
                const dirty =
                    bike !== null &&
                    (speedSlider.read() !== bike.speedKmh || amountSlider.read() !== bike.amountPercent);
                badge.textContent = t(saving ? 'assist.saving' : dirty ? 'assist.unsaved' : 'assist.inSync');
                badge.classList.toggle('dirty', dirty || saving);
                speedSlider.showBike(bike?.speedKmh ?? null);
                amountSlider.showBike(bike?.amountPercent ?? null);
            },
            /** Shows the speed again in the units of now. */
            show: () => speedSlider.show(),
        };
    }

    const editors = [modeEditor(1), modeEditor(2)];
    const save = button(t('assist.save'));
    save.prepend(icon(saveIcon, { slot: 'start' }));
    const undo = button(t('assist.undo'), { fill: 'outline' });
    undo.prepend(icon(arrowUndo, { slot: 'start' }));
    /** The two modes on the bike, to tell whether the sliders changed them; null until read. */
    /** @type {[AssistSetting, AssistSetting] | null} */
    let onBike = null;
    let saving = false;

    /** @param {AssistSetting} a @param {AssistSetting} b */
    const same = (a, b) => a.speedKmh === b.speedKmh && a.amountPercent === b.amountPercent;
    const changed = () => {
        const bike = onBike;
        return bike !== null && editors.some((editor, i) => !same(editor.read(), bike[i]));
    };
    function showState() {
        const dirty = changed();
        save.toggleAttribute('disabled', !dirty || saving);
        undo.toggleAttribute('disabled', !dirty || saving);
        editors.forEach((editor, i) => editor.showState(onBike?.[i] ?? null, saving));
    }

    save.addEventListener('click', async () => {
        const [mode1, mode2] = editors.map((editor) => editor.read());
        saving = true;
        showState();
        try {
            const sent = await send(() => session.changeAssistLevels(mode1, mode2));
            // No message when the bike took them: the badge says "Saved", and only once the bike returned them.
            const took = onBike !== null && same(onBike[0], mode1) && same(onBike[1], mode2);
            if (sent && !took) await showToast(t('assist.notTaken'), 'error');
        } finally {
            saving = false;
            showState();
        }
    });
    undo.addEventListener('click', () => {
        const bike = onBike;
        if (!bike) return;
        editors.forEach((editor, i) => editor.set(bike[i]));
        showState();
    });

    /** @param {BikeState} state */
    const render = (state) => {
        if (!state.assistLevels) return;
        const { mode1, mode2 } = state.assistLevels;
        /** @param {import('../ble/protocol.js').AssistLevel} level @returns {AssistSetting} */
        const setting = (level) => ({ speedKmh: Math.round(level.speedKmh), amountPercent: level.powerPercent });
        /** @type {[AssistSetting, AssistSetting]} */
        const next = [setting(mode1), setting(mode2)];
        // Sliders the rider moved, or is saving, stay where they are; otherwise they follow the bike.
        const keep = saving || changed();
        onBike = next;
        editors.forEach((editor, i) => {
            if (!keep) editor.set(next[i]);
            editor.show();
        });
        showState();
    };

    const element = page(
        t('assist.title'),
        [
            el(
                'div',
                { class: 'stack' },
                editors.map((editor) => editor.element)
            ),
            el('div', { class: 'assist-buttons' }, [undo, save]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
