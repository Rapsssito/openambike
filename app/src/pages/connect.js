// The first screen: the owner key, typed once per device, and the connection, shown step by step.
import {
    bicycle,
    checkmarkCircle,
    closeCircle,
    ellipseOutline,
    eye,
    eyeOff,
    keyOutline,
    shieldCheckmark,
} from 'ionicons/icons';

import { AuthenticationError, chooseBike } from '../ble/bike.js';
import { isOwnerKey } from '../ble/protocol.js';
import { t } from '../i18n/i18n.js';
import { button, card, el, icon, inputValue, page, setInputValue } from './ui.js';

/** @typedef {import('../ble/bike.js').BleClientLike} BleClientLike */
/** @typedef {import('../ble/bike.js').Bike} Bike */
/** @typedef {import('../storage/key-store.js').KeyStore} KeyStore */

/**
 * The steps of a connection, each waiting, running, done or failed.
 * @param {string[]} labels
 */
function steps(labels) {
    const items = labels.map((label) => {
        const mark = el('span', { class: 'step-mark' });
        return { mark, element: el('div', { class: 'step' }, [mark, el('span', {}, [label])]) };
    });
    const element = card([
        el(
            'div',
            { class: 'steps' },
            items.map((i) => i.element)
        ),
    ]);
    /**
     * @param {number} active the step running; steps before it are done
     * @param {boolean} [failed] whether the active step failed
     */
    const show = (active, failed = false) => {
        items.forEach(({ mark, element: step }, index) => {
            const state = index < active ? 'done' : index === active ? (failed ? 'failed' : 'active') : 'waiting';
            step.className = `step ${state}`;
            mark.replaceChildren(
                state === 'active'
                    ? el('ion-spinner', { name: 'crescent' })
                    : icon(state === 'done' ? checkmarkCircle : state === 'failed' ? closeCircle : ellipseOutline)
            );
        });
    };
    return { element, show };
}

/**
 * @param {object} options
 * @param {BleClientLike} options.client
 * @param {boolean} options.native
 * @param {boolean} options.bluetoothAvailable
 * @param {KeyStore} options.keyStore
 * @param {string} [options.message] shown instead of the default, such as why the last connection ended
 * @param {(bike: Bike) => Promise<void>} options.onConnected called with the authenticated bike
 * @returns {HTMLElement}
 */
export function connectPage({ client, native, bluetoothAvailable, keyStore, message: initial, onConnected }) {
    const keyInput = el('ion-input', {
        type: 'password',
        label: t('home.keyLabel'),
        'label-placement': 'stacked',
        'helper-text': t('home.keyHelp'),
        'error-text': t('home.keyInvalid'),
        autocomplete: 'off',
        spellcheck: 'false',
        maxlength: '28',
    });
    const revealIcon = icon(eye, { slot: 'icon-only' });
    const revealButton = el('ion-button', { slot: 'end', fill: 'clear', shape: 'round' }, [revealIcon]);
    /** @param {boolean} visible */
    const setKeyVisible = (visible) => {
        keyInput.setAttribute('type', visible ? 'text' : 'password');
        Object.assign(revealIcon, { icon: visible ? eyeOff : eye });
        revealButton.setAttribute('aria-label', t(visible ? 'home.hideKey' : 'home.showKey'));
    };
    setKeyVisible(false);
    revealButton.addEventListener('click', () => setKeyVisible(keyInput.getAttribute('type') === 'password'));
    keyInput.append(icon(keyOutline, { slot: 'start', class: 'field-icon' }), revealButton);

    const message = el('p', { class: 'status-message', role: 'status' }, [
        initial ?? (bluetoothAvailable ? t('home.tagline') : t('home.bluetoothMissing')),
    ]);
    if (!bluetoothAvailable) message.classList.add('error');
    const keyCard = card([el('div', { class: 'key-field' }, [keyInput])]);
    const forgetButton = el('ion-button', { fill: 'clear', size: 'small', slot: 'end' }, [t('home.forgetKey')]);
    const savedCard = card([
        el('div', { class: 'key-saved' }, [
            icon(shieldCheckmark),
            el('span', { class: 'row-label' }, [t('home.keySaved')]),
        ]),
        el('div', { class: 'forget' }, [forgetButton]),
    ]);
    const connectButton = button(t('home.connect'));
    connectButton.classList.add('connect-button');
    if (!bluetoothAvailable) connectButton.setAttribute('disabled', '');
    const progress = steps([t('home.stepConnect'), t('home.stepKey'), t('home.stepRead')]);
    progress.element.hidden = true;

    /** @type {string | null} */
    let storedKey = null;
    const showKey = () => {
        keyCard.hidden = storedKey !== null;
        savedCard.hidden = storedKey === null;
    };
    showKey();
    keyStore
        .load()
        .then((key) => {
            storedKey = key;
            showKey();
        })
        .catch(() => undefined);

    forgetButton.addEventListener('click', async () => {
        await keyStore.remove();
        storedKey = null;
        showKey();
    });

    /**
     * @param {string} text
     * @param {boolean} [error]
     */
    const say = (text, error = false) => {
        message.textContent = text;
        message.classList.toggle('error', error);
    };

    connectButton.addEventListener('click', async () => {
        const key = storedKey ?? inputValue(keyInput).trim();
        if (!isOwnerKey(key)) {
            keyInput.classList.add('ion-invalid', 'ion-touched');
            return;
        }
        keyInput.classList.remove('ion-invalid');
        connectButton.setAttribute('disabled', '');
        let step = 0;
        /** @type {Bike | null} */
        let bike = null;
        try {
            bike = await chooseBike(client, { native });
            progress.element.hidden = false;
            progress.show(step);
            say(t('home.connecting'));
            await bike.connect();
            progress.show(++step);
            say(t('home.authenticating'));
            await bike.authenticate(key);
            if (storedKey === null) {
                const savedOk = await keyStore.save(key).then(
                    () => true,
                    () => false
                );
                if (savedOk) storedKey = key;
                setInputValue(keyInput, '');
                showKey();
                if (!savedOk) say(t('home.keyNotSaved'), true);
            }
            progress.show(++step);
            say(t('home.reading'));
            await onConnected(bike);
        } catch (error) {
            if (bike) await bike.disconnect().catch(() => undefined);
            progress.show(step, true);
            say(
                error instanceof AuthenticationError
                    ? t('home.refused')
                    : t('home.failed', { error: error instanceof Error ? error.message : String(error) }),
                true
            );
            connectButton.removeAttribute('disabled');
        }
    });

    const brand = el('div', { class: 'brand' }, [
        el('div', { class: 'brand-mark' }, [icon(bicycle)]),
        el('h1', { class: 'brand-name' }, [t('app.name')]),
    ]);
    const element = page(t('app.name'), [
        brand,
        message,
        el('div', { class: 'stack' }, [keyCard, savedCard, connectButton, progress.element]),
        el('p', { class: 'disclaimer' }, [t('app.disclaimer')]),
    ]);
    element.classList.add('connect-page');
    return element;
}
