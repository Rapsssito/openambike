// The settings tab: the bike's information and settings, the app's, the automatic options, maintenance, the owner key,
// disconnecting, and the app's own information with the licences of what it ships. With no bike connected, opened from
// the connect screen, it shows only what needs no bike: units, the automatic options, the key, and "About".
import {
    barcode,
    bicycle,
    cellular,
    construct,
    documentText,
    hardwareChip,
    informationCircle,
    key,
    locate,
    logOut,
    logoGithub,
    moon,
    options,
    refresh,
    swapHorizontal,
    trash,
} from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { automaticSection } from './automatic.js';
import { keyRow } from './key-row.js';
import {
    actionRow,
    choice,
    confirmAction,
    disclosure,
    el,
    externalLink,
    icon,
    openSheet,
    page,
    section,
    send,
    showToast,
    switchRow,
    valueRow,
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
 * @param {object} options
 * @param {Session | null} options.session the connected bike, or null with none connected
 * @param {KeyStore} options.keyStore
 * @param {() => Units} options.units
 * @param {(units: Units) => void} options.setUnits
 * @param {() => void} [options.onDisconnect] with a bike connected
 * @param {() => void} [options.onSleep] called once the bike was sent to sleep, which ends the connection
 * @param {() => void} options.onForget called once the key was removed from this device, which ends any connection
 * @param {Node} [options.status] the connection status shown in the header
 * @param {import('../auto-connect.js').AutoConnect | null} [options.autoConnect] on Android only
 * @param {() => string | null} [options.bikeAddress] with no bike connected, the bike auto-connect would connect to
 * @param {boolean} [options.hasKey] with no bike connected, whether a key is saved on this device
 * @returns {{ element: HTMLElement, content: HTMLElement[], render: (state: BikeState) => void, stop: () => void }}
 *     `content` is the page without its header, for a sheet; `stop` ends what the page watches
 */
export function settingsPage({
    session,
    keyStore,
    units,
    setUnits,
    onDisconnect = () => undefined,
    onSleep = () => undefined,
    onForget,
    status,
    autoConnect = null,
    bikeAddress = () => null,
    hasKey = true,
}) {
    // Information.
    const firmware = valueRow(t('more.firmware'), hardwareChip);
    const motorFirmware = valueRow(t('more.motorFirmware'), construct);
    const batterySerialNumber = valueRow(t('more.batterySerialNumber'), barcode);

    // Settings.
    const gnss = switchRow({
        label: t('more.gnss'),
        iconName: locate,
        onChange: (on) => send(() => /** @type {Session} */ (session).setGnss(on)),
    });
    const gsm = switchRow({
        label: t('more.gsm'),
        iconName: cellular,
        onChange: (on) => send(() => /** @type {Session} */ (session).setGsm(on)),
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

    // The automatic options, with auto-connect's activity folded under them, where the connection's signal shows to
    // check its thresholds against (docs/roadmap.md). Disconnecting pauses auto-connect, and says so while it runs.
    const automatic = automaticSection({
        autoConnect,
        keyStore,
        address: () => (session ? session.bike.deviceId : bikeAddress()),
        onShow: (enabled) => {
            const disconnectLabel = disconnectRow.querySelector('.row-label');
            if (disconnectLabel) disconnectLabel.textContent = t(enabled ? 'more.disconnectPause' : 'more.disconnect');
        },
    });

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

    const unitsRow = el('div', { class: 'row units-row' }, [
        icon(swapHorizontal, { class: 'row-icon' }),
        el('span', { class: 'row-label' }, [t('more.units')]),
        unitsChoice.element,
    ]);
    const forgetRow = actionRow({
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
    });
    const content = [
        ...(session
            ? [
                  section(
                      t('more.information'),
                      [firmware.element, motorFirmware.element, batterySerialNumber.element],
                      { iconName: informationCircle }
                  ),
              ]
            : []),
        ...(session ? [section(t('more.bikeSettings'), [gnss.element, gsm.element], { iconName: bicycle })] : []),
        section(t('more.settings'), [unitsRow], { iconName: options }),
        automatic.element,
        ...(session
            ? [
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
              ]
            : []),
        ...(session || hasKey
            ? [
                  section(t('more.key'), [keyRow(keyStore), forgetRow, ...(session ? [disconnectRow] : [])], {
                      iconName: key,
                      footer: t('more.keyHelp'),
                  }),
              ]
            : []),
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
    ];
    const element = page(t('more.title'), content, status);
    if (session) render(session.state);
    const stop = () => automatic.stop();
    return { element, content, render, stop };
}
