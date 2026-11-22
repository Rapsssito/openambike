// Where the link to the bike stands, as a card: over the tabs that need the bike, blurred while it is not connected,
// and in the sheet that the connection status in every header opens. It says what happens, step by step, or what went
// wrong, and offers what the rider can do: connect, try again, search for bikes, choose one, or disconnect.
import { bicycle, closeCircle } from 'ionicons/icons';

import { t } from '../i18n/i18n.js';
import { describeError } from './errors.js';
import { steps } from './steps.js';
import { actionRow, button, card, el, icon } from './ui.js';

/** @typedef {import('../bike-link.js').BikeLink} BikeLink */
/** @typedef {import('../bike-link.js').LinkStatus} LinkStatus */

/** The steps of a connection, in the rider's words. */
const STEPS = /** @type {const} */ (['home.connecting', 'home.authenticating', 'home.reading']);
const STEP_LABELS = /** @type {const} */ (['home.stepConnect', 'home.stepKey', 'home.stepRead']);

/**
 * What the link is doing, in a sentence.
 * @param {LinkStatus} status
 * @returns {string}
 */
export function linkText(status) {
    switch (status.phase) {
        case 'connected':
            return t('common.connected');
        case 'connecting':
            return t(STEPS[status.step ?? 0]);
        case 'reconnecting':
            return t('link.reconnecting');
        case 'searching':
            return t(status.done ? 'home.nearby' : 'home.searching');
        case 'refused':
            return t('error.refused');
        case 'failed':
            if (status.error === undefined) return t('home.noneFound');
            return describeError(status.error) ?? t('link.disconnected');
        default:
            return status.message ?? t('link.disconnected');
    }
}

/**
 * @param {object} options
 * @param {BikeLink} options.link
 * @param {boolean} options.native on Android, where the bikes nearby can be searched for
 * @param {() => void} options.onOtherKey after a refused key: the rider chose to use another key
 * @param {() => void} [options.onDisconnect] in the sheet only: the rider chose to disconnect
 * @param {() => Promise<string>} [options.disconnectLabel] the label of "Disconnect", which says whether auto-lock and
 *     auto-ride pause
 * @returns {{ element: HTMLElement, stop: () => void }} `stop` ends its watch of the link
 */
export function linkCard({ link, native, onOtherKey, onDisconnect, disconnectLabel }) {
    const spinner = el('ion-spinner', { name: 'crescent' });
    const mark = el('span', { class: 'step-mark' });
    const text = el('p', { class: 'link-text', role: 'status' });
    const progress = steps(STEP_LABELS.map((key) => t(key)));
    const found = el('div');
    const statusRow = el('div', { class: 'link-status' }, [mark, text]);
    const actions = el('div', { class: 'stack' });

    const connectButton = button(t('home.connect'));
    connectButton.addEventListener('click', () => link.connect());
    const searchButton = button(t('home.searchAgain'), { fill: 'clear' });
    searchButton.addEventListener('click', () => link.search());
    const otherKeyButton = button(t('home.otherKey'), { fill: 'clear', color: 'medium' });
    otherKeyButton.addEventListener('click', () => onOtherKey());
    const disconnectButton = button(t('more.disconnect'), { fill: 'outline', color: 'medium' });
    if (onDisconnect) disconnectButton.addEventListener('click', () => onDisconnect());
    if (disconnectLabel) {
        disconnectLabel()
            .then((label) => (disconnectButton.textContent = label))
            .catch(() => undefined);
    }

    /** @param {LinkStatus} status */
    const render = (status) => {
        const { phase } = status;
        const working = phase === 'connecting' || phase === 'reconnecting' || (phase === 'searching' && !status.done);
        // The steps of a connection, with ticks, from its first attempt until it fails or it is done.
        const stepping = phase === 'connecting' || (phase === 'failed' && status.step !== undefined);
        if (stepping) progress.show(status.step ?? 0, phase === 'failed');
        progress.element.hidden = !stepping;
        text.hidden = phase === 'connecting';
        text.textContent = linkText(status);
        text.classList.toggle('failed', phase === 'failed' || phase === 'refused');
        const marked = phase !== 'connecting' && (working || phase === 'failed' || phase === 'refused');
        mark.replaceChildren(...(!marked ? [] : working ? [spinner] : [icon(closeCircle)]));
        mark.hidden = !marked || (phase === 'failed' && stepping);
        statusRow.hidden = text.hidden;
        found.replaceChildren(
            ...(phase === 'searching'
                ? (status.found ?? []).map((bike) =>
                      actionRow({ iconName: bicycle, label: bike.name, onClick: () => link.choose(bike) })
                  )
                : [])
        );
        const again = phase === 'failed' || phase === 'refused';
        connectButton.textContent = again ? t('home.tryAgain') : t('home.connect');
        actions.replaceChildren(
            ...(phase === 'idle' || again ? [connectButton] : []),
            ...(native && (phase === 'idle' || phase === 'failed' || (phase === 'searching' && status.done))
                ? [searchButton]
                : []),
            ...(phase === 'refused' ? [otherKeyButton] : []),
            ...(onDisconnect && (phase === 'connected' || working) ? [disconnectButton] : [])
        );
    };
    const element = card(
        [el('div', { class: 'link-card-body' }, [progress.element, statusRow, found, actions])],
        'link-card'
    );
    render(link.status);
    const stop = link.onStatus(render);
    return { element, stop };
}
