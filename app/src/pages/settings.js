// The settings tab: the app's settings, the automatic options with auto-connect's activity, the owner key, and the
// app's own information with the licences of what it ships. Nothing in it needs the bike connected: what does is on
// the Bike and Battery tabs.
import { documentText, informationCircle, key, logoGithub, options, swapHorizontal, trash } from 'ionicons/icons';

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
    valueRow,
} from './ui.js';

/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */
/** @typedef {import('../preferences.js').Units} Units */

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
 * @param {KeyStore} options.keyStore
 * @param {() => Units} options.units
 * @param {(units: Units) => void} options.setUnits
 * @param {() => void} options.onForget called once the key was removed from this device
 * @param {Node} [options.status] the connection status shown in the header
 * @param {import('../auto-connect.js').AutoConnect | null} [options.autoConnect] on Android only
 * @param {() => string | null} [options.bikeAddress] the bike auto-connect connects to
 * @returns {{ element: HTMLElement, render: () => void, stop: () => void }} `stop` ends what the page watches
 */
export function settingsPage({
    keyStore,
    units,
    setUnits,
    onForget,
    status,
    autoConnect = null,
    bikeAddress = () => null,
}) {
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

    // The automatic options, with auto-connect's activity folded under them, where the connection's signal shows to
    // check its thresholds against (docs/roadmap.md).
    const automatic = automaticSection({ autoConnect, keyStore, address: bikeAddress });

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
        section(t('more.settings'), [unitsRow], { iconName: options }),
        automatic.element,
        section(t('more.key'), [keyRow(keyStore), forgetRow], { iconName: key, footer: t('more.keyHelp') }),
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
    const stop = () => automatic.stop();
    return { element, render: () => undefined, stop };
}
