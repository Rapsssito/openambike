// The owner key saved on this device, shown in Settings like a Wi-Fi password: hidden until the eye is pressed, and
// copied with a button, so that the rider can keep it somewhere safe or paste it in another device's connect screen.
import { copyOutline, eye, eyeOff, key } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { el, icon, showToast } from './ui.js';

/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/** What shows while the key is hidden: as many dots as the key has characters. */
const HIDDEN = '•'.repeat(28);

/**
 * @param {KeyStore} keyStore
 * @returns {HTMLElement}
 */
export function keyRow(keyStore) {
    const value = el('span', { class: 'row-value key-value' }, [HIDDEN]);
    /** @param {string} iconName @param {string} label @param {() => Promise<void>} onClick */
    const iconButton = (iconName, label, onClick) => {
        const image = icon(iconName, { slot: 'icon-only' });
        const element = el('ion-button', { fill: 'clear', shape: 'round', 'aria-label': label }, [image]);
        element.addEventListener('click', onClick);
        return { element, image };
    };
    let visible = false;
    const reveal = iconButton(eye, t('home.showKey'), async () => {
        const ownerKey = visible ? null : await keyStore.load();
        visible = ownerKey !== null;
        value.textContent = ownerKey ?? HIDDEN;
        Object.assign(reveal.image, { icon: visible ? eyeOff : eye });
        reveal.element.setAttribute('aria-label', t(visible ? 'home.hideKey' : 'home.showKey'));
    });
    const copy = iconButton(copyOutline, t('more.copy'), async () => {
        const ownerKey = await keyStore.load();
        if (ownerKey === null) return;
        await navigator.clipboard.writeText(ownerKey);
        await showToast(t('more.copied'));
    });
    return el('div', { class: 'row key-row' }, [icon(key, { class: 'row-icon' }), value, reveal.element, copy.element]);
}
