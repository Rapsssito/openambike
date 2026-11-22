// The bike's own settings, information and maintenance, under the first tab's controls: GPS and mobile network, the
// firmware of the bike and of its motor controller, and restart, sleep and torque sensor calibration, each confirmed
// first. All of it needs the bike, so it sits with the tabs that are blurred while it is not connected.
import { bicycle, cellular, construct, hardwareChip, informationCircle, locate, moon, refresh } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { actionRow, confirmAction, section, send, showToast, switchRow, valueRow, whilePending } from './ui.js';

/** @typedef {import('../bike-link.js').BikeView} BikeView */
/** @typedef {import('../session.js').BikeState} BikeState */

/**
 * A field of the IoT state, as text, if it is there.
 * @param {Record<string, unknown> | null} state
 * @param {string} group
 * @param {string} field
 * @returns {string | null}
 */
export function iotField(state, group, field) {
    const value = /** @type {Record<string, unknown> | undefined} */ (state?.[group])?.[field];
    return value === undefined || value === null || value === '' ? null : String(value);
}

/**
 * @param {BikeView} bike
 * @param {{ onSleep?: () => void }} [options] `onSleep`, called once the bike was sent to sleep, which ends the link
 * @returns {{ content: HTMLElement[], render: (state: BikeState) => void }}
 */
export function bikeDetails(bike, { onSleep } = {}) {
    const gnss = switchRow({ label: t('more.gnss'), iconName: locate, onChange: (on) => send(() => bike.setGnss(on)) });
    const gsm = switchRow({ label: t('more.gsm'), iconName: cellular, onChange: (on) => send(() => bike.setGsm(on)) });
    const firmware = valueRow(t('more.firmware'), hardwareChip);
    const motorFirmware = valueRow(t('more.motorFirmware'), construct);

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
        gnss.set(state.gnss);
        gsm.set(state.gsm);
    };

    const content = [
        section(t('more.bikeSettings'), [gnss.element, gsm.element], { iconName: bicycle }),
        section(
            t('more.maintenance'),
            [
                maintenanceRow(refresh, t('more.restart'), t('more.restartConfirm'), () => bike.restart()),
                maintenanceRow(moon, t('more.sleep'), t('more.sleepConfirm'), () => bike.sleep(), onSleep),
                maintenanceRow(construct, t('more.calibrate'), t('more.calibrateConfirm'), () =>
                    bike.calibrateTorqueSensor()
                ),
            ],
            { iconName: construct }
        ),
        section(t('more.information'), [firmware.element, motorFirmware.element], { iconName: informationCircle }),
    ];
    return { content, render };
}
