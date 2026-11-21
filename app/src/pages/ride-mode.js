// Whether the bike is being ridden, from its speed and the rider's power: the bike tab shows the ride's figures while
// it is, and what matters before a ride while it is not. The bike sends its ASI metrics while it moves and none while
// it stands (docs/protocol.md, "Odometer"), so a long silence also means it stopped.

/** Above this speed, or with any rider power, the bike is moving. */
export const MOVING_SPEED_KMH = 3;
/** Moving this long makes a ride. */
export const RIDE_START_MS = 3000;
/** Still this long, or with no figures this long, ends the ride. */
export const RIDE_END_MS = 60000;
/** Figures further apart than this do not count as moving without a break. */
const MAX_GAP_MS = 2000;

/** @typedef {import('../ble/protocol.js').AsiMetrics} AsiMetrics */

export function rideDetector() {
    let riding = false;
    /** @type {number | null} since when the bike has moved without a break, while not yet riding */
    let movingSince = null;
    /** @type {number | null} */
    let lastMoving = null;
    /** @type {number | null} */
    let lastSample = null;

    return {
        /** @returns {boolean} */
        get riding() {
            return riding;
        },

        /**
         * @param {AsiMetrics} metrics
         * @param {number} now in milliseconds
         * @returns {boolean} whether riding changed
         */
        observe(metrics, now) {
            const moving = metrics.speedKmh > MOVING_SPEED_KMH || metrics.riderWatts > 0;
            const gap = lastSample === null ? Infinity : now - lastSample;
            lastSample = now;
            if (!moving) {
                movingSince = null;
                return this.tick(now);
            }
            lastMoving = now;
            if (riding) return false;
            if (movingSince === null || gap > MAX_GAP_MS) movingSince = now;
            if (now - movingSince < RIDE_START_MS) return false;
            riding = true;
            movingSince = null;
            return true;
        },

        /**
         * Called every second, so that a ride ends even when the bike stops sending figures.
         * @param {number} now in milliseconds
         * @returns {boolean} whether riding changed
         */
        tick(now) {
            if (!riding || lastMoving === null || now - lastMoving < RIDE_END_MS) return false;
            riding = false;
            return true;
        },
    };
}
