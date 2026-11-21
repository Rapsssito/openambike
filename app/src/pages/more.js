// The more tab: the bike's information, its settings, maintenance, the owner key, disconnecting, and the app's own
// information with the licences of what it ships.
import {
    barcode,
    bicycle,
    bluetooth,
    cellular,
    cloudDownload,
    cloudUpload,
    construct,
    copy,
    documentText,
    hardwareChip,
    informationCircle,
    key,
    locate,
    lockClosed,
    lockOpen,
    logOut,
    logoGithub,
    moon,
    options,
    radio,
    refresh,
    swapHorizontal,
    trash,
    warning,
} from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { exportOwnerKey, importOwnerKey, MIN_PASSPHRASE_LENGTH } from '../storage/key-export.js';
import { describeError } from './errors.js';
import {
    actionRow,
    button,
    choice,
    confirmAction,
    disclosure,
    el,
    externalLink,
    icon,
    inputValue,
    openSheet,
    page,
    section,
    send,
    setInputValue,
    showToast,
    switchRow,
    valueRow,
    whileBusy,
    whilePending,
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

/** Where the app's source code is published, as its licence asks. */
const SOURCE_URL = 'https://github.com/Rapsssito/openambike';

/**
 * A value row with a value that does not change.
 * @param {string} label
 * @param {string} iconName
 * @param {string} text
 */
function valueRowWith(label, iconName, text) {
    const row = valueRow(label, iconName);
    row.set(text);
    return row.element;
}

/** Opens the licences of the app and of everything it ships, each text folded under its name; loaded only then. */
async function showLicences() {
    const { default: licences } = await import('virtual:licences');
    return openSheet(t('more.licences'), [
        el('p', { class: 'lead' }, [t('more.licencesIntro')]),
        el(
            'div',
            { class: 'card' },
            licences.map(({ name, version, licence, text }) =>
                disclosure(version ? `${name} ${version}` : name, licence, text)
            )
        ),
    ]);
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
 * @param {() => void} options.onSleep called once the bike was sent to sleep, which ends the connection
 * @param {() => void} options.onForget called once the key was removed from this device, which ends the connection
 * @param {Node} options.status the connection status shown in the header
 * @param {import('../auto-connect.js').AutoConnect | null} [options.autoConnect] on Android only
 * @returns {{ element: HTMLElement, render: (state: BikeState) => void }}
 */
export function morePage({
    session,
    keyStore,
    units,
    setUnits,
    onDisconnect,
    onSleep,
    onForget,
    status,
    autoConnect = null,
}) {
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
            unitsChoice.set(value);
        },
    });
    unitsChoice.set(units());
    unitsChoice.element.classList.add('local');

    const disconnectRow = actionRow({ iconName: logOut, label: t('more.disconnect'), onClick: onDisconnect });

    // Auto-connect, auto-lock, auto-unlock and auto-ride, settings of the phone that its service keeps (Android only).
    // Auto-lock and auto-ride are offered only with auto-connect, and auto-unlock only with auto-lock, so that a bike
    // unlocked on arrival is locked again on leaving. The web app shows them greyed out, and says they need the app.
    /** @type {import('../auto-connect.js').Automatic} */
    let automatic = { autoLock: false, autoUnlock: false, autoRide: false };
    const unavailable = autoConnect ? undefined : t('more.needsApp');
    /** @param {boolean} enabled */
    const showAutoConnect = (enabled) => {
        // Disconnecting pauses auto-connect, and says so while it is on.
        const disconnectLabel = disconnectRow.querySelector('.row-label');
        if (disconnectLabel) disconnectLabel.textContent = t(enabled ? 'more.disconnectPause' : 'more.disconnect');
        autoConnectRow.set(enabled);
        autoLockRow.set(automatic.autoLock);
        autoUnlockRow.set(automatic.autoUnlock);
        autoRideRow.set(automatic.autoRide);
        autoLockRow.element.hidden = !enabled;
        autoUnlockRow.element.hidden = !enabled || !automatic.autoLock;
        autoRideRow.element.hidden = !enabled;
        signal.element.hidden = !enabled;
        checkRideLocation();
    };
    // While auto-ride is on without location "all the time", a warning with "Allow": rides it starts with the app
    // closed would have no route, as after a restored backup or Android taking back the permissions of an app unused.
    const rideLocationRow = actionRow({
        iconName: warning,
        label: t('more.autoRideAllow'),
        detail: t('more.autoRideLocationOff'),
        onClick: async () => {
            if (autoConnect) await autoConnect.askBackgroundLocation().catch(() => false);
            await checkRideLocation();
        },
    });
    rideLocationRow.hidden = true;
    const checkRideLocation = async () => {
        const wanted = Boolean(autoConnect) && !autoRideRow.element.hidden && automatic.autoRide;
        rideLocationRow.hidden = !wanted || (await autoConnect?.hasBackgroundLocation().catch(() => true)) !== false;
    };
    // Back from Android's settings, where "all the time" is allowed, or after the permission was taken back.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkRideLocation();
    });
    /**
     * Turns auto-connect on, with the automatic asked, or off; shows what the phone then has.
     * @param {boolean} enabled
     * @param {import('../auto-connect.js').Automatic} asked
     */
    const applyAutoConnect = async (enabled, asked) => {
        if (!autoConnect) return;
        const next = { ...asked, autoUnlock: asked.autoLock && asked.autoUnlock };
        try {
            const ownerKey = enabled ? await keyStore.load() : null;
            if (enabled && ownerKey) {
                await autoConnect.enable({ address: session.bike.deviceId, key: ownerKey, ...next });
                automatic = next;
            } else {
                await autoConnect.disable();
                automatic = { autoLock: false, autoUnlock: false, autoRide: false };
            }
            showAutoConnect(enabled && ownerKey !== null);
        } catch (error) {
            const text = describeError(error);
            if (text) await showToast(text, 'error');
        }
    };
    const autoConnectRow = switchRow({
        label: t('more.autoConnect'),
        iconName: bluetooth,
        info: t('more.autoConnectInfo'),
        local: true,
        unavailable,
        onChange: (on) => applyAutoConnect(on, automatic),
    });
    const autoLockRow = switchRow({
        label: t('more.autoLock'),
        iconName: lockClosed,
        info: t('more.autoLockInfo'),
        local: true,
        unavailable,
        onChange: (on) => applyAutoConnect(true, { ...automatic, autoLock: on }),
    });
    const autoUnlockRow = switchRow({
        label: t('more.autoUnlock'),
        iconName: lockOpen,
        info: t('more.autoUnlockInfo'),
        local: true,
        unavailable,
        onChange: async (on) => {
            // Turning it on is confirmed first, with what it does (docs/safety.md, "What the project never does").
            const header = t('more.autoUnlock');
            if (
                on &&
                !(await confirmAction({ header, message: t('more.autoUnlockConfirm'), confirm: t('more.turnOn') }))
            ) {
                return;
            }
            await applyAutoConnect(true, { ...automatic, autoUnlock: on });
        },
    });
    const autoRideRow = switchRow({
        label: t('more.autoRide'),
        iconName: bicycle,
        info: t('more.autoRideInfo'),
        local: true,
        unavailable,
        onChange: async (on) => {
            // Location "all the time" gives the rides it starts with the app closed their route; refused, the warning
            // under it stays, with "Allow".
            if (on && autoConnect) await autoConnect.askBackgroundLocation().catch(() => false);
            await applyAutoConnect(true, { ...automatic, autoRide: on });
        },
    });
    // The connection's signal strength, to check auto-connect's thresholds against it (docs/roadmap.md).
    const signal = valueRow(t('more.signal'), radio);
    const autoConnectSection = section(
        t('more.automatic'),
        [
            autoConnectRow.element,
            autoLockRow.element,
            autoUnlockRow.element,
            autoRideRow.element,
            rideLocationRow,
            signal.element,
        ],
        {
            iconName: bluetooth,
        }
    );
    if (autoConnect) {
        autoConnect
            .status()
            .then(({ enabled, autoLock, autoUnlock, autoRide }) => {
                automatic = { autoLock, autoUnlock, autoRide };
                showAutoConnect(enabled);
            })
            .catch(() => showAutoConnect(false));
        setInterval(() => {
            if (signal.element.hidden || !session.state.connected) return;
            autoConnect
                .readRssi(session.bike.deviceId)
                .then((value) => signal.set(t('signal.dbm', { value: String(value) })))
                .catch(() => undefined);
        }, 2000);
    } else {
        // In the web app, every option shows, off and greyed out.
        for (const row of [autoConnectRow, autoLockRow, autoUnlockRow, autoRideRow]) row.set(false);
        signal.element.hidden = true;
    }

    // Maintenance: each action is confirmed first, with what it does.
    /**
     * @param {string} iconName
     * @param {string} label
     * @param {string} explanation
     * @param {() => Promise<void>} action
     * @param {() => void} [after] called once the bike has the command
     */
    const maintenanceRow = (iconName, label, explanation, action, after) => {
        const row = actionRow({
            iconName,
            label,
            onClick: async () => {
                if (!(await confirmAction({ header: label, message: explanation, confirm: label }))) return;
                if (!(await whilePending(row, () => send(action)))) return;
                if (after) after();
                else await showToast(t('more.sent'));
            },
        });
        row.classList.add('bike-action');
        return row;
    };

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
            autoConnectSection,
            section(
                t('more.maintenance'),
                [
                    maintenanceRow(refresh, t('more.restart'), t('more.restartConfirm'), session.restart),
                    maintenanceRow(moon, t('more.sleep'), t('more.sleepConfirm'), session.sleep, onSleep),
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
                                onForget();
                            }
                        },
                    }),
                    disconnectRow,
                ],
                { iconName: key }
            ),
            section(
                t('more.about'),
                [
                    valueRowWith(t('more.version'), informationCircle, __APP_VERSION__ || t('common.unknown')),
                    valueRowWith(t('more.licence'), documentText, 'AGPL-3.0'),
                    el('div', { class: 'row' }, [
                        icon(logoGithub, { class: 'row-icon' }),
                        externalLink(t('more.source'), SOURCE_URL),
                    ]),
                    actionRow({ iconName: documentText, label: t('more.licences'), onClick: showLicences }),
                ],
                { iconName: informationCircle }
            ),
            el('p', { class: 'disclaimer' }, [t('app.disclaimer')]),
        ],
        status
    );
    render(session.state);
    return { element, render };
}
