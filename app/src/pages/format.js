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
 * @returns {string}
 */
export function distance(km, units, locale) {
    return units === 'mi' ? `${number(km / KM_PER_MILE, 1, locale)} mi` : `${number(km, 1, locale)} km`;
}
