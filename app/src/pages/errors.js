// What went wrong, in the user's words: the errors of Bluetooth and of the bike become a short sentence from the
// translation files, or nothing when the user cancelled.
import { AuthenticationError } from '../ble/bike.js';
import { t } from '../i18n/i18n.js';
import { InterruptedError, NotConfirmedError } from '../session.js';

/**
 * Kinds of error, each found by its name or its message, which differ between Android and the browsers.
 * @type {[RegExp, import('../i18n/i18n.js').TextKey][]}
 */
const KINDS = [
    [/bluetooth.*(not enabled|disabled|off)|adapter.*(off|disabled)/i, 'error.bluetoothOff'],
    [/permission|not allowed|denied|SecurityError/i, 'error.permission'],
    [/time(d)? ?out/i, 'error.timeout'],
    [/not found|no device|unknown device/i, 'error.notFound'],
    [/disconnect|gatt|NetworkError|not connected/i, 'error.lost'],
];

/**
 * @param {unknown} error
 * @returns {string | null} a sentence to show, or null when the user cancelled and nothing should be shown
 */
export function describeError(error) {
    if (error instanceof AuthenticationError) return t('error.refused');
    if (error instanceof NotConfirmedError) return t('error.notConfirmed');
    if (error instanceof InterruptedError) return t('error.lost');
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message) || name === 'AbortError') return null;
    const text = `${name} ${message}`;
    const kind = KINDS.find(([pattern]) => pattern.test(text));
    return kind ? t(kind[1]) : t('error.generic', { error: message });
}
