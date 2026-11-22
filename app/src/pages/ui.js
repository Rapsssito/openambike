// The app's reusable interface elements. Screens compose these and add no styling of their own beyond layout; the
// look is defined once in theme.css.
import { alertController, modalController, toastController } from '@ionic/core/components';
import {
    alertCircle,
    arrowDown,
    checkmarkCircle,
    chevronForward,
    close,
    flash,
    informationCircleOutline,
} from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { describeError } from './errors.js';

/**
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.append(...children);
    return element;
}

/**
 * An Ionicons icon.
 * @param {string} icon an icon from `ionicons/icons`
 * @param {Record<string, string>} [attributes]
 * @returns {HTMLElement}
 */
export function icon(icon, attributes = {}) {
    const element = el('ion-icon', { 'aria-hidden': 'true', ...attributes });
    Object.assign(element, { icon });
    return element;
}

/**
 * A page with a large title that collapses into the toolbar when scrolled.
 * @param {string} title
 * @param {(Node | string)[]} content
 * @param {Node} [end] shown at the end of the toolbar, such as the connection status
 * @returns {HTMLElement}
 */
export function page(title, content, end) {
    // Ionic shows collapsing buttons in the large title, and moves them to the small toolbar when scrolled.
    const endSlot = () => (end ? [el('ion-buttons', { slot: 'end', collapse: 'true' }, [end.cloneNode(true)])] : []);
    const toolbar = el('ion-toolbar', {}, [el('ion-title', {}, [title]), ...endSlot()]);
    return el('div', { class: 'ion-page' }, [
        el('ion-header', { translucent: 'true' }, [toolbar]),
        el('ion-content', { fullscreen: 'true' }, [
            el('ion-header', { collapse: 'condense' }, [
                el('ion-toolbar', {}, [el('ion-title', { size: 'large' }, [title]), ...endSlot()]),
            ]),
            el('div', { class: 'page-body' }, content),
        ]),
    ]);
}

/**
 * A small badge with a dot and a word, such as the connection status; it pulses on each call to `pulse`. Pages show
 * copies of it, which `set` and `pulse` change together.
 * @param {string} text
 * @returns {{ element: HTMLElement, set: (text: string, warning: boolean) => void, pulse: () => void }}
 */
export function statusBadge(text) {
    const label = () => el('span', { class: 'status-text' }, [text]);
    const element = el('span', { class: 'status-badge', role: 'status' }, [el('span', { class: 'dot' }), label()]);
    return {
        element,
        set(next, warning) {
            text = next;
            for (const badge of [element, ...document.querySelectorAll('.status-badge')]) {
                badge.classList.toggle('warning', warning);
                const current = badge.querySelector('.status-text');
                if (current && current.textContent !== next) current.textContent = next;
            }
        },
        pulse() {
            for (const badge of document.querySelectorAll('.status-badge')) {
                badge.classList.remove('pulse');
                void (/** @type {HTMLElement} */ (badge).offsetWidth);
                badge.classList.add('pulse');
            }
        },
    };
}

/**
 * A raised surface that groups related content.
 * @param {(Node | string)[]} children
 * @param {string} [extraClass]
 * @returns {HTMLElement}
 */
export function card(children, extraClass = '') {
    return el('div', { class: `card ${extraClass}`.trim() }, children);
}

/**
 * A titled group: a small heading, with an icon, over a card.
 * @param {string} title
 * @param {(Node | string)[]} children
 * @param {{ iconName?: string, footer?: string }} [options] `footer` is a sentence under the card
 * @returns {HTMLElement}
 */
export function section(title, children, { iconName, footer } = {}) {
    return el('section', { class: 'section' }, [
        el('h2', { class: 'section-title' }, [...(iconName ? [icon(iconName)] : []), title]),
        card(children),
        ...(footer ? [el('p', { class: 'section-footer' }, [footer])] : []),
    ]);
}

let gaugeCount = 0;

/**
 * Which way energy flows through the battery: shown by the gauge with an icon beside the value and, while charging
 * only, a soft glint that sweeps along its filled arc from its start to the charge.
 * @typedef {'charging' | 'discharging' | 'idle'} Flow
 */

/** The length of the glint, in the units of the gauge's drawing. */
const GLINT = 28;

/**
 * A ring that fills with a percentage, with a large value in its middle and a line under it.
 * @param {string} label read by screen readers with the value
 * @returns {{ element: HTMLElement, set: (percent: number | null, caption: string, flow?: Flow, flowLabel?: string) => void }}
 */
export function gauge(label) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const id = ++gaugeCount;
    /**
     * @param {string} cls
     * @param {string} [extra] more attributes
     */
    const arc = (cls, extra = '') =>
        `<circle class="${cls}" cx="60" cy="60" r="${radius}" transform="rotate(-90 60 60)" ${extra} />`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    const dashes = `stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"`;
    // The glint is blurred, so that it has no hard ends, and masked to the filled arc, so that it never leaves it.
    svg.innerHTML = [
        `<filter id="gauge-blur-${id}"><feGaussianBlur stdDeviation="2.5" /></filter>`,
        `<mask id="gauge-mask-${id}">${arc('gauge-mask', dashes)}</mask>`,
        `<circle class="gauge-track" cx="60" cy="60" r="${radius}" />`,
        arc('gauge-fill', dashes),
        `<g mask="url(#gauge-mask-${id})">`,
        arc('gauge-flow', `stroke-dasharray="${GLINT} ${circumference}" filter="url(#gauge-blur-${id})"`),
        '</g>',
    ].join('');
    const filled = /** @type {SVGCircleElement[]} */ ([...svg.querySelectorAll('.gauge-fill, .gauge-mask')]);
    const glint = /** @type {SVGCircleElement} */ (svg.querySelector('.gauge-flow'));
    const value = el('div', { class: 'gauge-value' }, [t('common.unknown')]);
    const flowIcon = icon(flash, { class: 'gauge-flow-icon' });
    const caption = el('div', { class: 'gauge-caption' });
    const element = el('div', { class: 'gauge', role: 'img', 'aria-label': label }, [
        svg,
        el('div', { class: 'gauge-text' }, [el('div', { class: 'gauge-line' }, [flowIcon, value]), caption]),
    ]);
    return {
        element,
        set(percent, text, flow = 'idle', flowLabel = '') {
            const known = percent !== null;
            value.textContent = known ? `${percent} %` : t('common.unknown');
            caption.textContent = text;
            const clamped = known ? Math.max(0, Math.min(100, percent)) : 0;
            const length = (circumference * clamped) / 100;
            for (const circle of filled) circle.setAttribute('stroke-dashoffset', String(circumference - length));
            // The glint sweeps from just before the arc's start to just past the charge (theme.css, "Gauge flow").
            glint.style.setProperty('--glint-from', `${GLINT}px`);
            glint.style.setProperty('--glint-to', `${-length}px`);
            element.classList.toggle('low', known && clamped <= 20);
            element.classList.toggle('charging', flow === 'charging');
            element.classList.toggle('discharging', flow === 'discharging');
            Object.assign(flowIcon, { icon: flow === 'discharging' ? arrowDown : flash });
            const said = [value.textContent, flowLabel, text].filter(Boolean).join(', ');
            element.setAttribute('aria-label', `${label}: ${said}`);
        },
    };
}

/**
 * A large figure with its unit under it, such as the speed while riding.
 * @param {string} label read by screen readers with the value
 * @returns {{ element: HTMLElement, set: (value: string, unit: string) => void }}
 */
export function readout(label) {
    const value = el('div', { class: 'readout-value' }, [t('common.unknown')]);
    const unit = el('div', { class: 'readout-unit' });
    const element = el('div', { class: 'readout', role: 'img', 'aria-label': label }, [value, unit]);
    return {
        element,
        set(text, unitText) {
            if (value.textContent !== text) value.textContent = text;
            if (unit.textContent !== unitText) unit.textContent = unitText;
            element.setAttribute('aria-label', `${label}: ${text} ${unitText}`);
        },
    };
}

/**
 * A value with its label, for grids of figures.
 * @param {string} label
 * @param {string} [iconName] an icon from `ionicons/icons`
 * @returns {{ element: HTMLElement, set: (value: string) => void }}
 */
export function stat(label, iconName) {
    const value = el('div', { class: 'stat-value' }, [t('common.unknown')]);
    const mark = iconName ? [icon(iconName)] : [];
    const element = el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, [...mark, label]), value]);
    return {
        element,
        set(text) {
            if (value.textContent !== text) value.textContent = text;
        },
    };
}

/**
 * A value with an icon on one line, over a horizontal bar as wide as the meter that fills with how much of a scale
 * the value is. The label is read by screen readers, not shown. A low meter shows its bar in the warning colour.
 * @param {string} label
 * @param {string} iconName an icon from `ionicons/icons`
 * @returns {{ element: HTMLElement, set: (value: string, fraction: number | null, low?: boolean) => void }}
 */
export function meter(label, iconName) {
    const value = el('span', { class: 'meter-value' }, [t('common.unknown')]);
    const fill = el('span', { class: 'meter-fill' });
    const element = el('div', { class: 'meter', role: 'group', 'aria-label': label }, [
        el('div', { class: 'meter-head' }, [icon(iconName, { class: 'meter-icon' }), value]),
        el('div', { class: 'meter-track', 'aria-hidden': 'true' }, [fill]),
    ]);
    return {
        element,
        set(text, fraction, low = false) {
            if (value.textContent !== text) value.textContent = text;
            const clamped = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
            fill.style.width = `${Math.round(clamped * 1000) / 10}%`;
            element.classList.toggle('low', low);
        },
    };
}

// Controls that change the bike never show a value before the bike has it. Pressed, a control keeps showing what the
// bike last said, cannot be pressed again, and shows a spinner, until its `onChange` settles; the new value appears
// only when the screen calls `set` with the bike's state.

/** A spinner shown while a control waits for the bike, hidden otherwise (theme.css, "Waiting for the bike"). */
function pendingSpinner() {
    return el('ion-spinner', { name: 'crescent', class: 'pending-spinner', 'aria-hidden': 'true' });
}

/**
 * @param {HTMLElement} element
 * @param {boolean} busy
 */
function markBusy(element, busy) {
    if (busy) element.setAttribute('aria-busy', 'true');
    else element.removeAttribute('aria-busy');
}

/**
 * A large on/off tile: an icon, a label and the state in words, pressed with one tap.
 * @param {{ iconName: string, label: string, on: string, off: string, onChange: (on: boolean) => Promise<unknown> }} options
 *     `onChange` asks for the change and settles once the bike has it or did not take it
 * @returns {{ element: HTMLElement, set: (on: boolean | null, blocked?: string | null) => void }} `blocked` says why
 *     the tile cannot be pressed now, shown instead of the state
 */
export function toggleTile({ iconName, label, on, off, onChange }) {
    const stateText = el('span', { class: 'tile-state' }, [t('common.unknown')]);
    const element = el('button', { type: 'button', class: 'tile', 'aria-pressed': 'false', disabled: '' }, [
        icon(iconName, { class: 'tile-icon' }),
        el('span', { class: 'tile-label' }, [label]),
        stateText,
        pendingSpinner(),
    ]);
    /** @type {boolean | null} */
    let current = null;
    /** @type {string | null} */
    let reason = null;
    let pending = false;
    /**
     * @param {boolean | null} value
     * @param {string | null} [blocked]
     */
    const show = (value, blocked = reason) => {
        current = value;
        reason = blocked;
        element.toggleAttribute('disabled', value === null || blocked !== null || pending);
        markBusy(element, pending);
        element.setAttribute('aria-pressed', String(value === true));
        element.classList.toggle('on', value === true);
        element.classList.toggle('blocked', blocked !== null);
        stateText.textContent = blocked ?? (value === null ? t('common.unknown') : value ? on : off);
    };
    element.addEventListener('click', async () => {
        if (current === null || reason !== null || pending) return;
        pending = true;
        show(current);
        try {
            await onChange(!current);
        } finally {
            pending = false;
            show(current);
        }
    });
    return { element, set: show };
}

/**
 * A choice of one among a few options, as a row of large buttons.
 * @template {string} T
 * @param {{ label: string, options: { value: T, label: string }[], onChange: (value: T) => Promise<unknown> }} options
 *     `onChange` asks for the change and settles once it is made or refused; a choice made on the device alone shows
 *     it by calling `set` at once
 * @returns {{ element: HTMLElement, set: (value: T | null) => void }}
 */
export function choice({ label, options, onChange }) {
    /** @type {T | null} */
    let current = null;
    let pending = false;
    const buttons = options.map(({ value, label: text }) => {
        const button = el(
            'button',
            { type: 'button', class: 'choice-option', role: 'radio', 'aria-checked': 'false' },
            [text, pendingSpinner()]
        );
        button.addEventListener('click', async () => {
            if (current === value || pending) return;
            pending = true;
            markBusy(button, true);
            for (const other of buttons) other.button.toggleAttribute('disabled', true);
            try {
                await onChange(value);
            } finally {
                pending = false;
                markBusy(button, false);
                for (const other of buttons) other.button.removeAttribute('disabled');
            }
        });
        return { value, button };
    });
    const element = el(
        'div',
        { class: 'choice', role: 'radiogroup', 'aria-label': label },
        buttons.map((b) => b.button)
    );
    /** @param {T | null} value */
    const show = (value) => {
        current = value;
        for (const { value: option, button } of buttons) {
            button.setAttribute('aria-checked', String(option === value));
            button.classList.toggle('selected', option === value);
        }
    };
    return { element, set: show };
}

/**
 * A row with an icon, a label and a value that can change.
 * @param {string} label
 * @param {string} [iconName] an icon from `ionicons/icons`
 * @returns {{ element: HTMLElement, set: (text: string) => void }}
 */
export function valueRow(label, iconName) {
    const value = el('span', { class: 'row-value' }, [t('common.unknown')]);
    return {
        element: el('div', { class: 'row' }, [
            ...(iconName ? [icon(iconName, { class: 'row-icon' })] : []),
            el('span', { class: 'row-label' }, [label]),
            value,
        ]),
        set(text) {
            if (value.textContent !== text) value.textContent = text;
        },
    };
}

/**
 * A row with an icon and a switch.
 * @param {{ label: string, iconName?: string, onChange: (on: boolean) => Promise<unknown>, info?: string, local?: boolean, unavailable?: string }} options
 *     `onChange` asks for the change and settles once the bike, or the phone for a local setting, has it or did not
 *     take it; `info`, a sentence or two on what the switch does, shown from an (i) beside it; `local`, a setting of
 *     the phone, which stays usable while the bike reconnects; `unavailable`, why the switch cannot be used here: it
 *     is greyed out, and pressing the row says why
 * @returns {{ element: HTMLElement, set: (on: boolean | null) => void }}
 */
export function switchRow({ label, iconName, onChange, info, local = false, unavailable }) {
    // With an (i), the name is a label of its own with the (i) right after it, and the switch stands alone at the end:
    // inside the switch's own label, tapping the (i) would flip the switch.
    const toggle = el(
        'ion-toggle',
        {
            justify: 'space-between',
            disabled: 'true',
            class: [local ? 'local' : '', info ? 'alone' : ''].join(' ').trim(),
            ...(info ? { 'aria-label': label } : {}),
        },
        info ? [] : [label]
    );
    /** @type {HTMLElement[]} */
    let name = [];
    if (info) {
        const infoButton = el(
            'ion-button',
            { fill: 'clear', shape: 'round', class: 'info-button', 'aria-label': t('common.info') },
            [icon(informationCircleOutline, { slot: 'icon-only' })]
        );
        infoButton.addEventListener('click', () => explain({ header: label, message: info }));
        name = [el('span', { class: 'row-label with-info' }, [label, infoButton])];
    }
    const element = el('div', { class: 'row' }, [
        ...(iconName ? [icon(iconName, { class: 'row-icon' })] : []),
        ...name,
        toggle,
        pendingSpinner(),
    ]);
    /** @type {boolean | null} */
    let current = null;
    let pending = false;
    const show = () => {
        Object.assign(toggle, {
            checked: current === true,
            disabled: Boolean(unavailable) || current === null || pending,
        });
        markBusy(element, pending);
    };
    if (unavailable) {
        element.classList.add('unavailable');
        // A disabled switch takes no taps: they reach the row, which says why, but on the (i), which explains.
        element.addEventListener('click', (event) => {
            if (event.target instanceof Element && event.target.closest('.info-button')) return;
            explain({ header: label, message: unavailable });
        });
    }
    toggle.addEventListener('ionChange', async (event) => {
        const on = /** @type {CustomEvent<{ checked: boolean }>} */ (event).detail.checked;
        // The switch moves itself when tapped: it goes back to the bike's value at once, which only the bike changes.
        // Ionic emits ionChange only for the user's taps, not for this.
        const ask = !pending && current !== null && on !== current;
        if (ask) pending = true;
        show();
        if (!ask) return;
        try {
            await onChange(on);
        } finally {
            pending = false;
            show();
        }
    });
    return {
        element,
        /** @param {boolean | null} on */
        set(on) {
            if (on === null) return;
            current = on;
            show();
        },
    };
}

/**
 * A row that does something when pressed, with an icon and a chevron.
 * @param {{ iconName: string, label: string, onClick: () => void, danger?: boolean, detail?: string }} options
 *     `detail`, a second line under the label
 * @returns {HTMLElement}
 */
export function actionRow({ iconName, label, onClick, danger = false, detail }) {
    const element = el('button', { type: 'button', class: `row action${danger ? ' danger' : ''}` }, [
        icon(iconName, { class: 'row-icon' }),
        el('span', { class: 'row-label' }, [label, ...(detail ? [el('span', { class: 'row-detail' }, [detail])] : [])]),
        icon(chevronForward, { class: 'row-chevron' }),
        pendingSpinner(),
    ]);
    element.addEventListener('click', onClick);
    return element;
}

/**
 * Shows a row or a control as waiting while an action runs: it cannot be pressed, and a spinner replaces its chevron.
 * @template T
 * @param {HTMLElement} target an element with a spinner of its own, such as an action row
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
export async function whilePending(target, action) {
    markBusy(target, true);
    target.toggleAttribute('disabled', true);
    try {
        return await action();
    } finally {
        markBusy(target, false);
        target.removeAttribute('disabled');
    }
}

/**
 * A row that opens to show a long text, such as a licence.
 * @param {string} title
 * @param {string} detail shown under the title, such as the licence's name
 * @param {string} text
 * @returns {HTMLElement}
 */
export function disclosure(title, detail, text) {
    return el('details', { class: 'row disclosure' }, [
        el('summary', {}, [
            el('span', { class: 'row-label' }, [title, el('span', { class: 'row-detail' }, [detail])]),
            icon(chevronForward, { class: 'row-chevron' }),
        ]),
        el('pre', { class: 'disclosure-text' }, [text]),
    ]);
}

/**
 * A row that opens to show more, closed at first, such as details few riders need.
 * @param {{ iconName: string, label: string, detail?: string, content: Node[], onToggle?: (open: boolean) => void }}
 *     options
 * @returns {HTMLDetailsElement}
 */
export function fold({ iconName, label, detail, content, onToggle }) {
    const element = /** @type {HTMLDetailsElement} */ (
        el('details', { class: 'row disclosure' }, [
            el('summary', {}, [
                icon(iconName, { class: 'row-icon' }),
                el('span', { class: 'row-label' }, [
                    label,
                    ...(detail ? [el('span', { class: 'row-detail' }, [detail])] : []),
                ]),
                icon(chevronForward, { class: 'row-chevron' }),
            ]),
            el('div', { class: 'fold-body' }, content),
        ])
    );
    if (onToggle) element.addEventListener('toggle', () => onToggle(element.open));
    return element;
}

/**
 * Opens a full-height sheet over the screen, with a title and a close button.
 * @param {string} title
 * @param {(Node | string)[]} content
 * @param {() => void} [onClose] called once the sheet is closed
 * @returns {Promise<{ dismiss: () => Promise<boolean> }>} the sheet, once shown
 */
export async function openSheet(title, content, onClose) {
    const closeButton = el('ion-button', { 'aria-label': t('common.close') }, [icon(close, { slot: 'icon-only' })]);
    const sheet = el('div', { class: 'ion-page' }, [
        el('ion-header', {}, [
            el('ion-toolbar', {}, [el('ion-title', {}, [title]), el('ion-buttons', { slot: 'end' }, [closeButton])]),
        ]),
        el('ion-content', {}, [el('div', { class: 'page-body sheet-body' }, content)]),
    ]);
    // The sheet's component is loaded the first time a sheet opens, to keep it out of the app's start.
    const { defineCustomElement } = await import('@ionic/core/components/ion-modal.js');
    defineCustomElement();
    const modal = await modalController.create({ component: sheet });
    closeButton.addEventListener('click', () => modal.dismiss());
    if (onClose) modal.onDidDismiss().then(onClose, onClose);
    await modal.present();
    return modal;
}

/**
 * The main button of a screen or a card.
 * @param {string} label
 * @param {{ fill?: 'solid' | 'outline' | 'clear', color?: string }} [options]
 * @returns {HTMLElement}
 */
export function button(label, { fill = 'solid', color = 'primary' } = {}) {
    return el('ion-button', { expand: 'block', fill, color }, [label]);
}

/**
 * A link to a page outside the app, opened in the system's browser.
 * @param {string} label
 * @param {string} href
 * @returns {HTMLElement}
 */
export function externalLink(label, href) {
    return el('a', { class: 'external-link', href, target: '_blank', rel: 'noopener noreferrer' }, [label]);
}

/**
 * Asks the user to choose a file on the device. Nothing leaves the device: the file is only read by the app.
 * @param {string} accept file types, as the `accept` attribute of a file input takes them
 * @returns {Promise<File | null>} null if the user cancelled
 */
export function pickFile(accept) {
    return new Promise((resolve) => {
        const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept }));
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

/**
 * Asks the user to choose one option among a few.
 * @template {string} T
 * @param {{ header: string, message: string, options: { value: T, label: string }[], confirm: string, selected?: T }} options
 *     `selected` is checked first; otherwise the first option is
 * @returns {Promise<T | null>} null if the user cancelled
 */
export async function chooseOne({ header, message, options, confirm, selected }) {
    const checked = options.some((o) => o.value === selected) ? selected : options[0]?.value;
    const alert = await alertController.create({
        header,
        message,
        inputs: options.map(({ value, label }) => ({ type: 'radio', label, value, checked: value === checked })),
        buttons: [
            { text: t('common.cancel'), role: 'cancel' },
            { text: confirm, role: 'confirm' },
        ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    return role === 'confirm' ? /** @type {{ values: T }} */ (data).values : null;
}

/**
 * A line chart of one or more series over time, drawn in SVG, with the highest value and the unit beside it.
 * @param {string} label what it shows, for screen readers
 * @param {{ unit: string, series: { name: string, className: string }[] }} options each series drawn in the colour
 *     of its class
 * @returns {{ element: HTMLElement, set: (values: [number, number][][]) => void }} `set` takes, for each series,
 *     its points as [time, value]
 */
export function lineChart(label, { unit, series }) {
    const width = 320;
    const height = 120;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.classList.add('chart-plot');
    const lines = series.map(({ className }) => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute('class', `chart-line ${className}`);
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(line);
        return line;
    });
    const top = el('span', { class: 'chart-top' }, ['']);
    const legend = el(
        'div',
        { class: 'chart-legend' },
        series.map(({ name, className }) => el('span', { class: `chart-key ${className}` }, [name]))
    );
    const element = el('div', { class: 'chart' }, [el('div', { class: 'chart-head' }, [top, legend]), svg]);
    return {
        element,
        set(values) {
            const all = values.flat();
            const first = Math.min(...all.map(([time]) => time));
            const last = Math.max(...all.map(([time]) => time));
            const highest = Math.max(1, ...all.map(([, value]) => value));
            top.textContent = all.length > 0 ? `${Math.round(highest)} ${unit}` : '';
            lines.forEach((line, index) => {
                const points = (values[index] ?? []).map(([time, value]) => {
                    const x = last > first ? ((time - first) / (last - first)) * width : 0;
                    const y = height - (value / highest) * (height - 4) - 2;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                });
                line.setAttribute('points', points.join(' '));
            });
        },
    };
}

/**
 * Explains something in a dialog with one button that closes it.
 * @param {{ header: string, message: string }} options
 */
export async function explain({ header, message }) {
    const alert = await alertController.create({
        header,
        message,
        buttons: [{ text: t('common.ok'), role: 'cancel' }],
    });
    await alert.present();
    await alert.onDidDismiss();
}

/**
 * Asks the user for a number, with a button that goes back to a default.
 * @param {{ header: string, message: string, value: number, unit: string, confirm: string, reset: string }} options
 * @returns {Promise<number | 'reset' | null>} the number typed, 'reset', or null if the user cancelled
 */
export async function askNumber({ header, message, value, unit, confirm, reset }) {
    const alert = await alertController.create({
        header,
        message,
        inputs: [{ name: 'value', type: 'number', value, min: 0, attributes: { inputmode: 'numeric' }, label: unit }],
        buttons: [
            { text: reset, role: 'reset' },
            { text: t('common.cancel'), role: 'cancel' },
            { text: confirm, role: 'confirm' },
        ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role === 'reset') return 'reset';
    if (role !== 'confirm') return null;
    return Number(/** @type {{ values: { value: string } }} */ (data).values.value);
}

/**
 * The value of an Ionic input or textarea.
 * @param {HTMLElement} input
 * @returns {string}
 */
export function inputValue(input) {
    return String(/** @type {{ value?: unknown }} */ (input).value ?? '');
}

/**
 * @param {HTMLElement} input
 * @param {string} value
 */
export function setInputValue(input, value) {
    Object.assign(input, { value });
}

/**
 * Asks the user to confirm an action.
 * @param {{ header: string, message: string, confirm: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function confirmAction({ header, message, confirm, danger = false }) {
    const alert = await alertController.create({
        header,
        message,
        buttons: [
            { text: t('common.cancel'), role: 'cancel' },
            { text: confirm, role: danger ? 'destructive' : 'confirm' },
        ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm' || role === 'destructive';
}

/**
 * A short message at the top of the screen: a success with a tick, or a failure with a warning sign.
 * @param {string} message
 * @param {'success' | 'error'} [kind]
 */
export async function showToast(message, kind = 'success') {
    const toast = await toastController.create({
        message,
        duration: kind === 'error' ? 4000 : 2000,
        position: 'top',
        icon: kind === 'error' ? alertCircle : checkmarkCircle,
        cssClass: `toast-${kind}`,
    });
    await toast.present();
}

/**
 * Shows a button as busy, with a spinner, while an action runs.
 * @template T
 * @param {HTMLElement} target an ion-button
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
export async function whileBusy(target, action) {
    const label = [...target.childNodes];
    target.setAttribute('disabled', 'true');
    target.replaceChildren(el('ion-spinner', { name: 'crescent', class: 'button-spinner' }), ...label);
    try {
        return await action();
    } finally {
        target.replaceChildren(...label);
        target.removeAttribute('disabled');
    }
}

/**
 * Sends a command, and tells the user if the bike did not take it or did not confirm it.
 * @param {() => Promise<unknown>} command
 * @returns {Promise<boolean>} whether the bike took it
 */
export async function send(command) {
    try {
        await command();
        return true;
    } catch (error) {
        const reason = describeError(error);
        if (reason !== null) await showToast(t('common.commandFailed', { error: reason }), 'error');
        return false;
    }
}
