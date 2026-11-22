// The encrypted export and import of the owner key, shown in Settings, with or without a bike connected, so that the key
// can be kept as a backup or moved to another device without the bike nearby.
import { cloudDownload, cloudUpload, copy } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { exportOwnerKey, importOwnerKey, MIN_PASSPHRASE_LENGTH } from '../storage/key-export.js';
import { button, el, icon, inputValue, section, setInputValue, showToast, whileBusy } from './ui.js';

/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/**
 * A text field in a form row.
 * @param {string} tag `ion-input` or `ion-textarea`
 * @param {Record<string, string>} attributes
 */
function field(tag, attributes) {
    const input = el(tag, { 'label-placement': 'stacked', ...attributes });
    return { input, element: el('div', { class: 'form-row' }, [input]) };
}

/**
 * Exports the key saved on this device, encrypted with a passphrase typed twice.
 * @param {KeyStore} keyStore
 * @returns {HTMLElement}
 */
export function keyExportSection(keyStore) {
    const passphrase = field('ion-input', {
        type: 'password',
        label: t('more.passphrase'),
        autocomplete: 'new-password',
    });
    const passphraseAgain = field('ion-input', {
        type: 'password',
        label: t('more.passphraseAgain'),
        autocomplete: 'new-password',
    });
    const exportButton = button(t('more.export'));
    const output = el('ion-textarea', { readonly: 'true', 'auto-grow': 'true', class: 'export-text' });
    const copyButton = button(t('more.copy'), { fill: 'outline' });
    copyButton.prepend(icon(copy, { slot: 'start' }));
    const result = el('div', { class: 'stack' }, [
        el('p', { class: 'lead' }, [t('more.exportReady')]),
        output,
        copyButton,
    ]);
    result.hidden = true;
    exportButton.addEventListener('click', async () => {
        const typed = inputValue(passphrase.input);
        if (typed.length < MIN_PASSPHRASE_LENGTH) return showToast(t('more.passphraseShort'), 'error');
        if (typed !== inputValue(passphraseAgain.input)) return showToast(t('more.passphraseMismatch'), 'error');
        const ownerKey = await keyStore.load();
        if (!ownerKey) return;
        await whileBusy(exportButton, async () => {
            setInputValue(output, await exportOwnerKey(ownerKey, typed));
        });
        result.hidden = false;
        setInputValue(passphrase.input, '');
        setInputValue(passphraseAgain.input, '');
    });
    copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(inputValue(output));
        await showToast(t('more.copied'));
    });
    return section(
        t('more.export'),
        [
            passphrase.element,
            passphraseAgain.element,
            el('div', { class: 'mode-actions stack' }, [exportButton, result]),
        ],
        { iconName: cloudUpload, footer: t('more.exportHelp') }
    );
}

/**
 * Imports an exported key, which replaces the one saved on this device.
 * @param {KeyStore} keyStore
 * @param {(key: string) => void} [onImported] called with the key once it is saved
 * @returns {HTMLElement}
 */
export function keyImportSection(keyStore, onImported) {
    const text = field('ion-textarea', { label: t('more.importText'), 'auto-grow': 'true', spellcheck: 'false' });
    const passphrase = field('ion-input', { type: 'password', label: t('more.passphrase') });
    const importButton = button(t('more.import'), { fill: 'outline' });
    importButton.addEventListener('click', async () => {
        try {
            /** @type {string} */
            let imported = '';
            await whileBusy(importButton, async () => {
                imported = await importOwnerKey(inputValue(text.input), inputValue(passphrase.input));
                await keyStore.save(imported);
            });
            setInputValue(text.input, '');
            await showToast(t('more.imported'));
            if (onImported) onImported(imported);
        } catch {
            await showToast(t('more.importFailed'), 'error');
        } finally {
            setInputValue(passphrase.input, '');
        }
    });
    return section(
        t('more.import'),
        [text.element, passphrase.element, el('div', { class: 'mode-actions' }, [importButton])],
        { iconName: cloudDownload, footer: t('more.importHelp') }
    );
}
