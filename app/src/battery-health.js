// The battery's health: the energy it holds when full, estimated from the energy left and the charge, against its
// rated capacity, 336 Wh unless the rider changes it (docs/protocol.md, "Absolute state of charge" and "Battery
// capacity by model").

/**
 * The rated capacity health is measured against unless the rider changes it: every model of docs/protocol.md,
 * "Battery capacity by model", is rated for it.
 */
export const DEFAULT_RATED_WH = 336;

/** The rated capacities the rider may type, in Wh. */
export const RATED_WH_LIMITS = { min: 100, max: 2000 };

/** Below this charge, one percent is too large a share of the energy left for the estimate to mean much. */
export const MIN_CHARGE_PERCENT = 30;

/**
 * @param {number} wh a rated capacity the rider typed
 * @returns {boolean} whether it is a whole number of Wh within the limits
 */
export function isRatedWh(wh) {
    return Number.isInteger(wh) && wh >= RATED_WH_LIMITS.min && wh <= RATED_WH_LIMITS.max;
}

/**
 * The energy the battery holds when full, in Wh: the energy left divided by the charge. Null when the charge is too
 * low for the estimate, or the frame had no absolute state of charge.
 * @param {import('./ble/protocol.js').Battery | null} battery
 * @returns {number | null}
 */
export function fullCapacityWh(battery) {
    if (!battery || battery.absoluteSoc === null || battery.percent < MIN_CHARGE_PERCENT) return null;
    return battery.absoluteSoc / 1000 / (battery.percent / 100);
}

/**
 * The battery's health, in percent of its rated capacity, at most 100.
 * @param {import('./ble/protocol.js').Battery | null} battery
 * @param {number} ratedWh
 * @returns {number | null}
 */
export function healthPercent(battery, ratedWh) {
    const full = fullCapacityWh(battery);
    return full === null ? null : Math.min(100, (full / ratedWh) * 100);
}
