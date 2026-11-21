// Numbers as the interface shows them, in the current language's format and the user's units.

/** @typedef {import('../preferences.js').Units} Units */

/** Kilometres in a mile. */
export const KM_PER_MILE = 1.609344;

/**
 * @param {number} value
 * @param {number} decimals
 * @param {string} [locale]
 * @returns {string}
 */
export function number(value, decimals, locale = globalThis.document?.documentElement.lang || undefined) {
    return value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * @param {number} kmh
 * @param {Units} units
 * @param {string} [locale]
 * @returns {string}
 */
export function speed(kmh, units, locale) {
    return units === 'mi' ? `${number(kmh / KM_PER_MILE, 1, locale)} mph` : `${number(kmh, 1, locale)} km/h`;
}

/**
 * @param {number} km
 * @param {Units} units
 * @param {string} [locale]
 * @param {number} [decimals]
 * @returns {string}
 */
export function distance(km, units, locale, decimals = 1) {
    return units === 'mi' ? `${number(km / KM_PER_MILE, decimals, locale)} mi` : `${number(km, decimals, locale)} km`;
}

/**
 * A duration as hours, minutes and seconds: `1:05:09`, or `5:09` under an hour.
 * @param {number} ms
 * @returns {string}
 */
export function duration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
