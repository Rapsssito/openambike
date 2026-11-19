// The more tab: the bike's information, its settings, maintenance, the owner key, and disconnecting.
import {
    barcode,
    cellular,
    cloudDownload,
    cloudUpload,
    construct,
    copy,
    hardwareChip,
    informationCircle,
    key,
    locate,
    logOut,
    moon,
    options,
    refresh,
    swapHorizontal,
    trash,
} from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { exportOwnerKey, importOwnerKey, MIN_PASSPHRASE_LENGTH } from '../storage/key-export.js';
import {
    actionRow,
    button,
    choice,
    confirmAction,
    el,
    icon,
    inputValue,
    page,
    section,
    send,
    setInputValue,
    showToast,
    switchRow,
    valueRow,
    whileBusy,
} from './ui.js';

/** @typedef {import('../session.js').Session} Session */
/** @typedef {import('../session.js').BikeState} BikeState */
/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */
/** @typedef {import('../preferences.js').Units} Units */

/**
 * A field of the IoT state, as text, if it is there.
 * @param {Record<string, unknown> | null} state
 * @param {string} group
 * @param {string} field
 * @returns {string | null}
 */
function iotField(state, group, field) {
    const value = /** @type {Record<string, unknown> | undefined} */ (state?.[group])?.[field];
    return value === undefined || value === null || value === '' ? null : String(value);
}

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
 * @param {object} options
 * @param {Session} options.session
 * @param {KeyStore} options.keyStore
 * @param {() => Units} options.units
 * @param {(units: Units) => void} options.setUnits
 * @param {() => void} options.onDisconnect
 * @param {Node} options.status the connection status shown in the header
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function morePage({ session, keyStore, units, setUnits, onDisconnect, status }) {
    // Information.
    const firmware = valueRow(t('more.firmware'), hardwareChip);
    const motorFirmware = valueRow(t('more.motorFirmware'), construct);
    const batterySerialNumber = valueRow(t('more.batterySerialNumber'), barcode);

    // Settings.
    const gnss = switchRow({
        label: t('more.gnss'),
        iconName: locate,
        onChange: (on) => send(() => session.setGnss(on)),
    });
    const gsm = switchRow({
        label: t('more.gsm'),
        iconName: cellular,
        onChange: (on) => send(() => session.setGsm(on)),
    });
    const unitsChoice = choice({
        label: t('more.units'),
        options: [
            { value: /** @type {Units} */ ('km'), label: t('more.kilometres') },
            { value: /** @type {Units} */ ('mi'), label: t('more.miles') },
        ],
        onChange: async (value) => {
            setUnits(value);
            return true;
        },
    });
    unitsChoice.set(units());

    // Maintenance: each action is confirmed first, with what it does.
    /**
     * @param {string} iconName
     * @param {string} label
     * @param {string} explanation
     * @param {() => Promise<void>} action
     */
    const maintenanceRow = (iconName, label, explanation, action) =>
        actionRow({
            iconName,
            label,
            onClick: async () => {
                if (!(await confirmAction({ header: label, message: explanation, confirm: label }))) return;
                if (await send(action)) await showToast(t('more.sent'));
            },
        });

    // Owner key: export, import and forget.
    const exportPassphrase = field('ion-input', {
        type: 'password',
        label: t('more.passphrase'),
        autocomplete: 'new-password',
    });
    const exportPassphraseAgain = field('ion-input', {
        type: 'password',
        label: t('more.passphraseAgain'),
        autocomplete: 'new-password',
    });
    const exportButton = button(t('more.export'));
    const exportOutput = el('ion-textarea', { readonly: 'true', 'auto-grow': 'true', class: 'export-text' });
    const copyButton = button(t('more.copy'), { fill: 'outline' });
    copyButton.prepend(icon(copy, { slot: 'start' }));
    const exportResult = el('div', { class: 'stack' }, [
        el('p', { class: 'lead' }, [t('more.exportReady')]),
        exportOutput,
        copyButton,
    ]);
    exportResult.hidden = true;
    exportButton.addEventListener('click', async () => {
        const passphrase = inputValue(exportPassphrase.input);
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) return showToast(t('more.passphraseShort'), 'error');
        if (passphrase !== inputValue(exportPassphraseAgain.input)) {
            return showToast(t('more.passphraseMismatch'), 'error');
        }
        const ownerKey = await keyStore.load();
        if (!ownerKey) return;
        await whileBusy(exportButton, async () => {
            setInputValue(exportOutput, await exportOwnerKey(ownerKey, passphrase));
        });
        exportResult.hidden = false;
        setInputValue(exportPassphrase.input, '');
        setInputValue(exportPassphraseAgain.input, '');
    });
    copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(inputValue(exportOutput));
        await showToast(t('more.copied'));
    });

    const importText = field('ion-textarea', { label: t('more.importText'), 'auto-grow': 'true', spellcheck: 'false' });
    const importPassphrase = field('ion-input', { type: 'password', label: t('more.passphrase') });
    const importButton = button(t('more.import'), { fill: 'outline' });
    importButton.addEventListener('click', async () => {
        try {
            await whileBusy(importButton, async () => {
                const ownerKey = await importOwnerKey(inputValue(importText.input), inputValue(importPassphrase.input));
                await keyStore.save(ownerKey);
            });
            setInputValue(importText.input, '');
            await showToast(t('more.imported'));
        } catch {
            await showToast(t('more.importFailed'), 'error');
        } finally {
            setInputValue(importPassphrase.input, '');
        }
    });

    /** @param {BikeState} state */
    const render = (state) => {
        if (state.firmware) firmware.set(state.firmware.version);
        const asiVersion = iotField(state.iotState, 'version', 'asi_version');
        if (asiVersion) motorFirmware.set(asiVersion);
        const batterySerial = iotField(state.iotState, 'battery', 'serial_number');
        if (batterySerial) batterySerialNumber.set(batterySerial);
        gnss.set(state.gnss);
        gsm.set(state.gsm);
    };

    const element = page(
        t('more.title'),
        [
            section(t('more.information'), [firmware.element, motorFirmware.element, batterySerialNumber.element], {
                iconName: informationCircle,
            }),
            section(
                t('more.settings'),
                [
                    gnss.element,
                    gsm.element,
                    el('div', { class: 'row units-row' }, [
                        icon(swapHorizontal, { class: 'row-icon' }),
                        el('span', { class: 'row-label' }, [t('more.units')]),
                        unitsChoice.element,
                    ]),
                ],
                { iconName: options }
            ),
            section(
                t('more.maintenance'),
                [
                    maintenanceRow(refresh, t('more.restart'), t('more.restartConfirm'), session.restart),
                    maintenanceRow(moon, t('more.sleep'), t('more.sleepConfirm'), session.sleep),
                    maintenanceRow(
                        construct,
                        t('more.calibrate'),
                        t('more.calibrateConfirm'),
                        session.calibrateTorqueSensor
                    ),
                ],
                { iconName: construct }
            ),
            section(
                t('more.export'),
                [
                    exportPassphrase.element,
                    exportPassphraseAgain.element,
                    el('div', { class: 'mode-actions stack' }, [exportButton, exportResult]),
                ],
                { iconName: cloudUpload, footer: t('more.exportHelp') }
            ),
            section(
                t('more.import'),
                [importText.element, importPassphrase.element, el('div', { class: 'mode-actions' }, [importButton])],
                { iconName: cloudDownload, footer: t('more.importHelp') }
            ),
            section(
                t('more.key'),
                [
                    actionRow({
                        iconName: trash,
                        label: t('more.forget'),
                        danger: true,
                        onClick: async () => {
                            const header = t('more.forget');
                            const message = t('more.forgetConfirm');
                            if (await confirmAction({ header, message, confirm: header, danger: true })) {
                                await keyStore.remove();
                                await showToast(t('more.forgotten'));
                            }
                        },
                    }),
                    actionRow({ iconName: logOut, label: t('more.disconnect'), onClick: onDisconnect }),
                ],
                { iconName: key }
            ),
            el('p', { class: 'disclaimer' }, [t('app.disclaimer')]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
