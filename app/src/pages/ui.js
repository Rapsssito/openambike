// The app's reusable interface elements. Screens compose these and add no styling of their own beyond layout; the
// look is defined once in theme.css.
import { alertController, toastController } from '@ionic/core/components';
import { alertCircle, checkmarkCircle, chevronForward } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';

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
 * A small badge with a dot and a word, such as the connection status; it pulses on each call to `pulse`.
 * @param {string} text
 * @returns {{ element: HTMLElement, pulse: () => void }}
 */
export function statusBadge(text) {
    const element = el('span', { class: 'status-badge', role: 'status' }, [el('span', { class: 'dot' }), text]);
    return {
        element,
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

/**
 * A ring that fills with a percentage, with a large value in its middle and a line under it.
 * @param {string} label read by screen readers with the value
 * @returns {{ element: HTMLElement, set: (percent: number | null, caption: string) => void }}
 */
export function gauge(label) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
        `<circle class="gauge-track" cx="60" cy="60" r="${radius}" />` +
        `<circle class="gauge-fill" cx="60" cy="60" r="${radius}" stroke-dasharray="${circumference}" ` +
        `stroke-dashoffset="${circumference}" transform="rotate(-90 60 60)" />`;
    const fill = /** @type {SVGCircleElement} */ (svg.querySelector('.gauge-fill'));
    const value = el('div', { class: 'gauge-value' }, [t('common.unknown')]);
    const caption = el('div', { class: 'gauge-caption' });
    const element = el('div', { class: 'gauge', role: 'img', 'aria-label': label }, [
        svg,
        el('div', { class: 'gauge-text' }, [value, caption]),
    ]);
    return {
        element,
        set(percent, text) {
            const known = percent !== null;
            value.textContent = known ? `${percent} %` : t('common.unknown');
            caption.textContent = text;
            const clamped = known ? Math.max(0, Math.min(100, percent)) : 0;
            fill.setAttribute('stroke-dashoffset', String(circumference * (1 - clamped / 100)));
            element.classList.toggle('low', known && clamped <= 20);
            element.setAttribute('aria-label', `${label}: ${value.textContent}, ${text}`);
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
    const element = el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label' }, [...(iconName ? [icon(iconName)] : []), label]),
        value,
    ]);
    return {
        element,
        set(text) {
            if (value.textContent !== text) value.textContent = text;
        },
    };
}

/**
 * A large on/off tile: an icon, a label and the state in words, pressed with one tap.
 * @param {{ iconName: string, label: string, on: string, off: string, onChange: (on: boolean) => Promise<boolean> }} options
 *     `onChange` returns whether the change was sent; if not, the tile goes back
 * @returns {{ element: HTMLElement, set: (on: boolean | null) => void }}
 */
export function toggleTile({ iconName, label, on, off, onChange }) {
    const stateText = el('span', { class: 'tile-state' }, [t('common.unknown')]);
    const element = el('button', { type: 'button', class: 'tile', 'aria-pressed': 'false', disabled: '' }, [
        icon(iconName, { class: 'tile-icon' }),
        el('span', { class: 'tile-label' }, [label]),
        stateText,
    ]);
    /** @type {boolean | null} */
    let current = null;
    /** @param {boolean | null} value */
    const show = (value) => {
        current = value;
        element.toggleAttribute('disabled', value === null);
        element.setAttribute('aria-pressed', String(value === true));
        element.classList.toggle('on', value === true);
        stateText.textContent = value === null ? t('common.unknown') : value ? on : off;
    };
    element.addEventListener('click', async () => {
        if (current === null) return;
        const previous = current;
        show(!previous);
        element.classList.add('busy');
        if (!(await onChange(!previous))) show(previous);
        element.classList.remove('busy');
    });
    return { element, set: show };
}

/**
 * A choice of one among a few options, as a row of large buttons.
 * @template {string} T
 * @param {{ label: string, options: { value: T, label: string }[], onChange: (value: T) => Promise<boolean> }} options
 *     `onChange` returns whether the change was sent; if not, the choice goes back
 * @returns {{ element: HTMLElement, set: (value: T | null) => void }}
 */
export function choice({ label, options, onChange }) {
    /** @type {T | null} */
    let current = null;
    const buttons = options.map(({ value, label: text }) => {
        const button = el(
            'button',
            { type: 'button', class: 'choice-option', role: 'radio', 'aria-checked': 'false' },
            [text]
        );
        button.addEventListener('click', async () => {
            if (current === value) return;
            const previous = current;
            show(value);
            if (!(await onChange(value))) show(previous);
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
 * @param {{ label: string, iconName?: string, onChange: (on: boolean) => Promise<boolean> }} options
 * @returns {{ element: HTMLElement, set: (on: boolean | null) => void }}
 */
export function switchRow({ label, iconName, onChange }) {
    const toggle = el('ion-toggle', { justify: 'space-between', disabled: 'true' }, [label]);
    /** @param {boolean | null} on */
    const set = (on) => {
        if (on === null) return;
        toggle.removeAttribute('disabled');
        Object.assign(toggle, { checked: on });
    };
    toggle.addEventListener('ionChange', async (event) => {
        const on = /** @type {CustomEvent<{ checked: boolean }>} */ (event).detail.checked;
        if (!(await onChange(on))) set(!on);
    });
    return {
        element: el('div', { class: 'row' }, [...(iconName ? [icon(iconName, { class: 'row-icon' })] : []), toggle]),
        set,
    };
}

/**
 * A row that does something when pressed, with an icon and a chevron.
 * @param {{ iconName: string, label: string, onClick: () => void, danger?: boolean }} options
 * @returns {HTMLElement}
 */
export function actionRow({ iconName, label, onClick, danger = false }) {
    const element = el('button', { type: 'button', class: `row action${danger ? ' danger' : ''}` }, [
        icon(iconName, { class: 'row-icon' }),
        el('span', { class: 'row-label' }, [label]),
        icon(chevronForward, { class: 'row-chevron' }),
    ]);
    element.addEventListener('click', onClick);
    return element;
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
 * Sends a command, and tells the user if the bike did not take it.
 * @param {() => Promise<unknown>} command
 * @returns {Promise<boolean>} whether it was sent
 */
export async function send(command) {
    try {
        await command();
        return true;
    } catch (error) {
        await showToast(
            t('common.commandFailed', { error: error instanceof Error ? error.message : String(error) }),
            'error'
        );
        return false;
    }
}
