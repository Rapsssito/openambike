// The user's preferences on this device. They are conveniences: when the browser's storage is unavailable, the
// defaults apply.

/** @typedef {'km' | 'mi'} Units */

const UNITS_ITEM = 'openambike.units';

/** @returns {Units} */
export function loadUnits() {
    try {
        return globalThis.localStorage?.getItem(UNITS_ITEM) === 'mi' ? 'mi' : 'km';
    } catch {
        return 'km';
    }
}

/** @param {Units} units */
export function saveUnits(units) {
    try {
        globalThis.localStorage?.setItem(UNITS_ITEM, units);
    } catch {
        // The preference is lost at the next start; nothing else depends on it.
    }
}
