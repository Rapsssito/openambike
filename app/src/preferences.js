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

const BIKE_ITEM = 'openambike.bike';

/**
 * The bike this device connected to last, to reach it again with no scan (Android only). Its identifier is the
 * bike's Bluetooth address, which stays on this device like the owner key.
 * @returns {string | null}
 */
export function loadBikeId() {
    try {
        return globalThis.localStorage?.getItem(BIKE_ITEM) ?? null;
    } catch {
        return null;
    }
}

/** @param {string | null} deviceId null forgets the bike */
export function saveBikeId(deviceId) {
    try {
        if (deviceId === null) globalThis.localStorage?.removeItem(BIKE_ITEM);
        else globalThis.localStorage?.setItem(BIKE_ITEM, deviceId);
    } catch {
        // The app then looks for the bike again at the next start.
    }
}

const RATED_WH_ITEM = 'openambike.ratedWh';

/** @returns {number | null} the battery's rated capacity the rider typed, in Wh, or null for the default */
export function loadRatedWh() {
    try {
        const value = Number(globalThis.localStorage?.getItem(RATED_WH_ITEM) ?? Number.NaN);
        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

/** @param {number | null} wh null goes back to the default */
export function saveRatedWh(wh) {
    try {
        if (wh === null) globalThis.localStorage?.removeItem(RATED_WH_ITEM);
        else globalThis.localStorage?.setItem(RATED_WH_ITEM, String(wh));
    } catch {
        // The default applies again at the next start.
    }
}
