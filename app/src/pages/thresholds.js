// The sheet where the rider sets what auto-connect and auto-ride decide with, edited as the assist levels are: one
// card of sliders, each with its value above it, its (i), the saved value beside it struck through once moved, a badge that says
// whether what the sliders show is saved, and "Undo" and "Save" under it. Saving keeps the values on this device and
// gives them to the service.
import { arrowUndo, bicycle, link, lockClosed, refresh, save as saveIcon, timer } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import {
    changeThreshold,
    currentThresholds,
    DEFAULT_THRESHOLDS,
    isDefault,
    saveThresholds,
    THRESHOLD_FIELDS,
} from '../thresholds.js';
import { button, card, el, icon, openSheet, slider } from './ui.js';

/** @typedef {import('../thresholds.js').ThresholdKey} ThresholdKey */
/** @typedef {import('../thresholds.js').Thresholds} Thresholds */

/** Each value's icon; its name, explanation, unit and limits are with the value, in `THRESHOLD_FIELDS`. */
/** @type {Record<ThresholdKey, string>} */
const ICONS = { nearDbm: link, farDbm: lockClosed, signalMs: timer, movementMs: bicycle };

/** What the row of Settings says of them: whether the rider changed any. */
export function thresholdsDetail() {
    return t(isDefault(currentThresholds()) ? 'thresholds.default' : 'thresholds.changed');
}

/**
 * Opens the sheet.
 * @param {(values: Thresholds) => Promise<void>} onSave gives the service what was saved
 */
export async function openThresholds(onSave) {
    /** What is saved, to tell whether the sliders changed it. */
    let saved = currentThresholds();
    let values = saved;
    let saving = false;
    const badge = el('span', { class: 'mode-badge', role: 'status' });

    const sliders = THRESHOLD_FIELDS.map(({ key, min, max, step, unit: unitName, label, info, ends }) => {
        // A time is stored in milliseconds and shown in seconds.
        const unit = unitName === 's' ? 1_000 : 1;
        const control = slider({
            label: t(label),
            iconName: ICONS[key],
            min: min / unit,
            max: max / unit,
            step: step / unit,
            format: (value) => `${value} ${unitName}`,
            limits: ends && [t(ends[0]), t(ends[1])],
            info: t(info),
            onInput: () => {
                values = changeThreshold(values, key, control.read() * unit);
                showState();
            },
        });
        return { key, unit, control };
    });
    const save = button(t('assist.save'));
    save.prepend(icon(saveIcon, { slot: 'start' }));
    const undo = button(t('assist.undo'), { fill: 'outline' });
    undo.prepend(icon(arrowUndo, { slot: 'start' }));
    // Back to the defaults is one more change to save or undo, as moving a slider is.
    const defaults = button(t('thresholds.reset'), { fill: 'clear' });
    defaults.prepend(icon(refresh, { slot: 'start' }));

    const changed = () => THRESHOLD_FIELDS.some(({ key }) => values[key] !== saved[key]);
    /** Shows how the sliders stand against what is saved: the badge, the buttons, the saved values beside those moved. */
    function showState() {
        // Moving a signal level may have moved the other.
        for (const { key, unit, control } of sliders) {
            control.set(values[key] / unit);
            control.showBike(saved[key] / unit);
        }
        const dirty = changed();
        badge.textContent = t(saving ? 'assist.saving' : dirty ? 'assist.unsaved' : 'assist.inSync');
        badge.classList.toggle('dirty', dirty || saving);
        save.toggleAttribute('disabled', !dirty || saving);
        undo.toggleAttribute('disabled', !dirty || saving);
        defaults.toggleAttribute('disabled', isDefault(values) || saving);
    }
    showState();

    save.addEventListener('click', async () => {
        saving = true;
        showState();
        try {
            saveThresholds(values);
            saved = values;
            await onSave(values);
        } finally {
            saving = false;
            showState();
        }
    });
    undo.addEventListener('click', () => {
        values = saved;
        showState();
    });
    defaults.addEventListener('click', () => {
        values = { ...DEFAULT_THRESHOLDS };
        showState();
    });

    await openSheet(t('thresholds.title'), [
        el('div', { class: 'stack' }, [
            card(
                [el('div', { class: 'mode-head' }, [badge]), ...sliders.map(({ control }) => control.element)],
                'mode-card'
            ),
        ]),
        el('div', { class: 'assist-buttons' }, [undo, save]),
        defaults,
    ]);
}
