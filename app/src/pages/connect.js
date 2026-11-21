// The first screen. With the owner key saved and, on Android, the bike known from before, it connects at once, as the
// official app does. Otherwise it asks for the key once, then finds the bike: on Android in the app's own list, in a
// browser through the browser's chooser. The connection is shown step by step, and what goes wrong as a message.
import {
    bicycle,
    checkmarkCircle,
    closeCircle,
    documentTextOutline,
    ellipseOutline,
    eye,
    eyeOff,
    helpCircleOutline,
    keyOutline,
    search,
} from 'ionicons/icons';

import { AuthenticationError, bikeById, chooseBike, SCAN_TIMEOUT_MS, scanForBikes } from '../ble/bike.js';
import { isOwnerKey } from '../ble/protocol.js';
import { ownerKeysInBugReport } from '../bug-report/owner-key.js';
import { t } from '../i18n/i18n.js';
import { loadBikeId, saveBikeId } from '../preferences.js';
import { describeError } from './errors.js';
import { openSignalTest } from './signal.js';
import {
    actionRow,
    button,
    card,
    chooseOne,
    confirmAction,
    el,
    externalLink,
    icon,
    inputValue,
    page,
    pickFile,
    section,
    setInputValue,
    showToast,
} from './ui.js';

/** The guide to getting the owner key, at the repository's published address. */
export const OWNER_KEY_GUIDE_URL = 'https://github.com/Rapsssito/openambike/blob/main/docs/owner-key.md';

/** @typedef {import('../ble/bike.js').BleClientLike} BleClientLike */
/** @typedef {import('../ble/bike.js').Bike} Bike */
/** @typedef {import('../ble/bike.js').FoundBike} FoundBike */
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
 * The bikes a scan finds, as rows to tap, with a line that says whether the scan goes on.
 * @param {(bike: FoundBike) => void} onChoose
 */
function bikeList(onChoose) {
    const status = el('div', { class: 'step active' }, [
        el('span', { class: 'step-mark' }, [el('ion-spinner', { name: 'crescent' })]),
        el('span', {}, [t('home.searching')]),
    ]);
    const rows = el('div');
    const element = section(t('home.nearby'), [rows, status], { iconName: search });
    /** @type {Map<string, HTMLElement>} */
    const seen = new Map();
    return {
        element,
        clear() {
            seen.clear();
            rows.replaceChildren();
        },
        /** @param {FoundBike} bike */
        add(bike) {
            if (seen.has(bike.deviceId)) return;
            const row = actionRow({ iconName: bicycle, label: bike.name, onClick: () => onChoose(bike) });
            seen.set(bike.deviceId, row);
            rows.append(row);
        },
        /** @param {boolean} searching */
        setSearching(searching) {
            status.hidden = !searching && seen.size > 0;
            status.className = searching ? 'step active' : 'step';
            status.replaceChildren(
                el('span', { class: 'step-mark' }, [
                    searching ? el('ion-spinner', { name: 'crescent' }) : icon(closeCircle),
                ]),
                el('span', {}, [searching ? t('home.searching') : t('home.noneFound')])
            );
        },
    };
}

/**
 * @param {object} options
 * @param {BleClientLike} options.client
 * @param {boolean} options.native
 * @param {boolean} options.bluetoothAvailable
 * @param {KeyStore} options.keyStore
 * @param {string} [options.message] shown instead of the default, such as why the last connection ended
 * @param {boolean} [options.autoConnect] whether to connect at once with a saved key and a known bike
 * @param {(bike: Bike, key: string) => Promise<void>} options.onConnected called with the authenticated bike
 * @returns {HTMLElement}
 */
export function connectPage({
    client,
    native,
    bluetoothAvailable,
    keyStore,
    message: initial,
    autoConnect = true,
    onConnected,
}) {
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
    const keyCard = card([el('div', { class: 'key-field' }, [keyInput])]);

    const message = el('p', { class: 'status-message', role: 'status' }, [
        initial ?? (bluetoothAvailable ? t('home.tagline') : t('home.bluetoothMissing')),
    ]);
    /**
     * @param {string} text
     * @param {boolean} [failed] whether it says why the last attempt failed: it then stays until the next one
     */
    const say = (text, failed = false) => {
        message.textContent = text;
        message.classList.toggle('failed', failed);
    };

    const connectButton = button(t('home.connect'));
    connectButton.classList.add('connect-button');
    if (!bluetoothAvailable) connectButton.setAttribute('disabled', '');
    const otherKeyButton = button(t('home.otherKey'), { fill: 'clear', color: 'medium' });
    const searchButton = button(t('home.searchAgain'), { fill: 'clear' });
    const progress = steps([t('home.stepConnect'), t('home.stepKey'), t('home.stepRead')]);
    const bikes = bikeList((found) => {
        stopScan();
        run(() => bikeById(client, found.deviceId));
    });

    // Help with the key, away from the connection: reading it from a bug report needs only the browser's own
    // decompression, so it is offered wherever that exists; the bug report itself comes from an Android phone.
    const readReport = actionRow({
        iconName: documentTextOutline,
        label: t('home.readReport'),
        onClick: readFromReport,
    });
    readReport.hidden = typeof DecompressionStream === 'undefined';
    const help = section(
        t('home.help'),
        [
            readReport,
            el('div', { class: 'row' }, [
                icon(helpCircleOutline, { class: 'row-icon' }),
                externalLink(t('home.keyGuide'), OWNER_KEY_GUIDE_URL),
            ]),
        ],
        { iconName: keyOutline }
    );

    /** @type {string | null} */
    let storedKey = null;
    let busy = false;
    /** @type {(() => Promise<void>) | null} */
    let stopScanning = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let scanTimer = null;

    /**
     * Shows what the screen offers now.
     * @param {{ failed?: boolean, refused?: boolean }} [after] how the last attempt ended
     */
    const layout = ({ failed = false, refused = false } = {}) => {
        keyCard.hidden = storedKey !== null;
        help.hidden = storedKey !== null;
        connectButton.hidden = busy;
        connectButton.textContent = failed ? t('home.tryAgain') : t('home.connect');
        otherKeyButton.hidden = busy || !refused || storedKey === null;
        searchButton.hidden = busy || !failed || refused || !native || loadBikeId() === null;
    };
    progress.element.hidden = true;
    bikes.element.hidden = true;

    const stopScan = () => {
        if (scanTimer !== null) clearTimeout(scanTimer);
        scanTimer = null;
        const stop = stopScanning;
        stopScanning = null;
        if (stop) stop().catch(() => undefined);
    };

    /** The key typed, or the saved one; null, with the field marked, if it is not a key. */
    const key = () => {
        const value = storedKey ?? inputValue(keyInput).trim();
        if (isOwnerKey(value)) {
            keyInput.classList.remove('ion-invalid');
            return value;
        }
        keyInput.classList.add('ion-invalid', 'ion-touched');
        return null;
    };

    /** Looks for bikes nearby in the app's own list (Android). */
    async function scan() {
        stopScan();
        progress.element.hidden = true;
        bikes.clear();
        bikes.element.hidden = false;
        bikes.setSearching(true);
        busy = true;
        layout();
        say(t('home.tagline'));
        try {
            stopScanning = await scanForBikes(client, (found) => bikes.add(found));
            scanTimer = setTimeout(() => {
                stopScan();
                bikes.setSearching(false);
                busy = false;
                layout({ failed: true });
            }, SCAN_TIMEOUT_MS);
        } catch (error) {
            bikes.element.hidden = true;
            busy = false;
            layout({ failed: true });
            const text = describeError(error);
            if (text) say(text, true);
        }
    }

    /**
     * Connects to the bike `getBike` gives, checks the key, saves it, and reads the bike.
     * @param {() => Promise<Bike>} getBike
     */
    async function run(getBike) {
        const ownerKey = key();
        if (ownerKey === null) return;
        busy = true;
        bikes.element.hidden = true;
        layout();
        let step = 0;
        /** @type {Bike | null} */
        let bike = null;
        // The steps show at once, before the permission and the link are ready, so that the screen is never blank.
        progress.element.hidden = false;
        progress.show(step);
        say(t('home.connecting'));
        try {
            bike = await getBike();
            await bike.connect();
            progress.show(++step);
            say(t('home.authenticating'));
            await bike.authenticate(ownerKey);
            if (storedKey === null) {
                const savedOk = await keyStore.save(ownerKey).then(
                    () => true,
                    () => false
                );
                if (savedOk) storedKey = ownerKey;
                setInputValue(keyInput, '');
                if (!savedOk) await showToast(t('home.keyNotSaved'), 'error');
            }
            if (native) saveBikeId(bike.deviceId);
            progress.show(++step);
            say(t('home.reading'));
            await onConnected(bike, ownerKey);
        } catch (error) {
            if (bike) await bike.disconnect().catch(() => undefined);
            busy = false;
            const text = describeError(error);
            const refused = error instanceof AuthenticationError;
            if (text === null) {
                // The user closed the chooser: nothing failed.
                progress.element.hidden = true;
                say(t('home.tagline'));
                layout();
                return;
            }
            progress.show(step, true);
            say(text, true);
            layout({ failed: true, refused });
        }
    }

    /** Connects to the bike known from before, or finds one. */
    const connect = () => {
        if (key() === null) return;
        const known = loadBikeId();
        if (!native) return run(() => chooseBike(client, { native }));
        if (known) return run(() => bikeById(client, known));
        return scan();
    };

    connectButton.addEventListener('click', () => connect());
    searchButton.addEventListener('click', () => {
        saveBikeId(null);
        scan();
    });
    otherKeyButton.addEventListener('click', async () => {
        const header = t('home.otherKey');
        if (!(await confirmAction({ header, message: t('home.otherKeyConfirm'), confirm: header, danger: true }))) {
            return;
        }
        await keyStore.remove().catch(() => undefined);
        storedKey = null;
        progress.element.hidden = true;
        layout();
    });

    async function readFromReport() {
        const file = await pickFile('.zip,application/zip,application/x-zip-compressed,.log');
        if (!file) return;
        say(t('home.reportReading'));
        /** @type {import('../bug-report/owner-key.js').BugReportKeys} */
        let found;
        try {
            found = await ownerKeysInBugReport(file);
        } catch {
            say(t('home.tagline'));
            return showToast(t('home.reportUnreadable'), 'error');
        }
        say(t('home.tagline'));
        if (found.logs === 0) return showToast(t('home.reportNoLog'), 'error');
        if (!found.authFound) return showToast(t('home.reportNoConnection'), 'error');
        if (found.keys.length === 0) return showToast(t('home.reportNoKey'), 'error');
        const chosen =
            found.keys.length === 1
                ? found.keys[0]
                : await chooseOne({
                      header: t('home.reportChooseTitle'),
                      message: t('home.reportChoose'),
                      confirm: t('home.reportUse'),
                      options: found.keys.map((value, index) => ({
                          value,
                          label: t('home.reportKeyOption', { n: String(index + 1), end: value.slice(-4) }),
                      })),
                  });
        if (chosen === null) return;
        setInputValue(keyInput, chosen);
        keyInput.classList.remove('ion-invalid');
        await showToast(t('home.reportFound'));
    }

    layout();
    keyStore
        .load()
        .catch(() => null)
        .then((saved) => {
            storedKey = saved;
            layout();
            if (storedKey !== null && autoConnect && bluetoothAvailable && native && loadBikeId() !== null) {
                connect();
            }
        });

    // The app's own icon, public/icon.svg, as on the launcher; decorative, since the name follows.
    const brandMark = el('img', { class: 'brand-mark', src: '/icon.svg', alt: '' });
    // Tapped five times within 3 seconds on Android, while nothing connects, it opens the signal test.
    /** @type {number[]} */
    let taps = [];
    brandMark.addEventListener('click', () => {
        const now = Date.now();
        taps = [...taps.filter((at) => now - at < 3000), now];
        if (taps.length < 5 || !native || busy) return;
        taps = [];
        openSignalTest(client);
    });
    const brand = el('div', { class: 'brand' }, [brandMark, el('h1', { class: 'brand-name' }, [t('app.name')])]);
    const element = page(t('app.name'), [
        brand,
        message,
        el('div', { class: 'stack' }, [
            keyCard,
            connectButton,
            progress.element,
            bikes.element,
            searchButton,
            otherKeyButton,
        ]),
        help,
        el('p', { class: 'disclaimer' }, [t('app.disclaimer')]),
    ]);
    element.classList.add('connect-page');
    return element;
}
