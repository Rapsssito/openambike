// The thresholds auto-connect and auto-ride decide with, and what the rider may change of them: the defaults, the limits
// of each value, and what the rider set, kept on this device.
// Signal levels are in dBm, times in milliseconds. The service takes them with each configuration the app sends.

/** @typedef {'nearDbm' | 'farDbm' | 'signalMs' | 'movementMs'} ThresholdKey the thresholds the rider may set */
/** @typedef {Parameters<typeof import('./i18n/i18n.js').t>[0]} TextKey a key of the translation files */
/** @typedef {Record<ThresholdKey | 'awayMs' | 'parkedMs', number>} Thresholds all of them, those the rider may not set too */

/**
 * The defaults, the owner's measurements (docs/protocol.md, "Advertising").
 * @type {Readonly<Thresholds>}
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
    /** Connects once the median of the bike's advertising over `signalMs` is above this: the phone close to the bike. */
    nearDbm: -73,
    /**
     * Lets go once the median of the connection's signal over `signalMs` is below this, after it was above it: far
     * enough for the lock to go out well before the link drops; a closed door or a wall (-80 dBm) between phone and bike
     * also counts as away.
     */
    farDbm: -78,
    /**
     * The time the signal's median is taken over, to connect and to let go: short, so that the bike unlocks soon after
     * the rider reaches it, long enough that one deep dip, as the rider's body blocks the phone, does not decide.
     */
    signalMs: 5_000,
    /**
     * How long movement, or its lack, counts. Never locks while the bike reported movement in the last this long (ridden,
     * it reports about once a second); a ride starts once the bike has reported it is pedalled for this long (auto-ride);
     * and a gap between two reports of movement longer than this is a moment standing, which restarts that count.
     */
    movementMs: 5_000,
    /**
     * The bike out of reach this long means the rider left, not a moment out of reach: a connection that dropped by
     * itself, the signal strong before, is waited for this long (one that dropped as the signal said the rider was
     * walking away is not waited for), and a pause for standing near ends once the bike has not been heard above
     * `farDbm` for this long.
     */
    awayMs: 30_000,
    /**
     * Lets go, and pauses, once the bike has not moved for this long near the phone; after a ride is stopped by hand,
     * auto-ride waits as long before it may start another.
     */
    parkedMs: 15 * 60_000,
});

/**
 * What the rider may set, in the order the screen shows them: for each, the limits of its value and the step it moves
 * by (in its stored unit), how it is shown (`unit`, in dBm or in seconds, which it is stored in thousandths of), and
 * the texts that go with it: its name, what it does, and what the two ends of its slider are called. The waits after a
 * dropped connection (`awayMs`) and for standing still (`parkedMs`) stay as the code has them.
 * @type {readonly {
 *     key: ThresholdKey,
 *     min: number,
 *     max: number,
 *     step: number,
 *     unit: 'dBm' | 's',
 *     label: TextKey,
 *     info: TextKey,
 *     ends?: [TextKey, TextKey]
 * }[]}
 */
export const THRESHOLD_FIELDS = Object.freeze([
    {
        key: 'nearDbm',
        min: -93,
        max: -50,
        step: 1,
        unit: 'dBm',
        label: 'thresholds.nearDbm',
        info: 'thresholds.nearDbmInfo',
        ends: ['thresholds.farther', 'thresholds.closer'],
    },
    {
        key: 'farDbm',
        min: -95,
        max: -52,
        step: 1,
        unit: 'dBm',
        label: 'thresholds.farDbm',
        info: 'thresholds.farDbmInfo',
        ends: ['thresholds.farther', 'thresholds.closer'],
    },
    {
        key: 'signalMs',
        min: 2_000,
        max: 15_000,
        step: 1_000,
        unit: 's',
        label: 'thresholds.signalMs',
        info: 'thresholds.signalMsInfo',
    },
    {
        key: 'movementMs',
        min: 2_000,
        max: 15_000,
        step: 1_000,
        unit: 's',
        label: 'thresholds.movementMs',
        info: 'thresholds.movementMsInfo',
    },
]);

/** Letting go is weaker than connecting by at least this: otherwise it would connect and let go in turn. */
export const MIN_SIGNAL_GAP_DBM = 2;

const ITEM = 'openambike.thresholds';

/** @param {ThresholdKey} key */
function field(key) {
    return /** @type {NonNullable<typeof THRESHOLD_FIELDS[number]>} */ (
        THRESHOLD_FIELDS.find((candidate) => candidate.key === key)
    );
}

/**
 * A value brought within its limits and onto its step.
 * @param {ThresholdKey} key
 * @param {number} value
 */
function fit(key, value) {
    const { min, max, step } = field(key);
    const stepped = min + Math.round((value - min) / step) * step;
    return Math.min(max, Math.max(min, stepped));
}

/**
 * Makes the signal levels keep their gap, moving the one that was not just changed.
 * @param {Thresholds} values
 * @param {'nearDbm' | 'farDbm'} moved the one the rider just moved, which stays where it is
 * @returns {Thresholds}
 */
function keepGap(values, moved) {
    const { nearDbm, farDbm } = values;
    if (nearDbm - farDbm >= MIN_SIGNAL_GAP_DBM) return values;
    return moved === 'nearDbm'
        ? { ...values, farDbm: fit('farDbm', nearDbm - MIN_SIGNAL_GAP_DBM) }
        : { ...values, nearDbm: fit('nearDbm', farDbm + MIN_SIGNAL_GAP_DBM) };
}

/**
 * What was saved, made safe to use: a value that is missing or no number is the default, and every value is within its
 * limits and on its step, the signal levels apart by the gap. Only what the rider may set is taken from it.
 * @param {unknown} saved
 * @returns {Thresholds}
 */
export function normalizeThresholds(saved) {
    const source = saved !== null && typeof saved === 'object' ? /** @type {Record<string, unknown>} */ (saved) : {};
    const values = /** @type {Thresholds} */ ({ ...DEFAULT_THRESHOLDS });
    for (const { key } of THRESHOLD_FIELDS) {
        const value = source[key];
        values[key] = typeof value === 'number' && Number.isFinite(value) ? fit(key, value) : DEFAULT_THRESHOLDS[key];
    }
    return keepGap(values, 'nearDbm');
}

/**
 * The thresholds with one value changed, and the other signal level moved if they came too close.
 * @param {Thresholds} values
 * @param {ThresholdKey} key
 * @param {number} value
 * @returns {Thresholds}
 */
export function changeThreshold(values, key, value) {
    const changed = { ...values, [key]: fit(key, value) };
    return key === 'nearDbm' || key === 'farDbm' ? keepGap(changed, key) : changed;
}

/** @param {Thresholds} values */
export function isDefault(values) {
    return THRESHOLD_FIELDS.every(({ key }) => values[key] === DEFAULT_THRESHOLDS[key]);
}

/** @returns {Thresholds} what the rider set on this device, the defaults where nothing is */
export function currentThresholds() {
    try {
        return normalizeThresholds(JSON.parse(globalThis.localStorage?.getItem(ITEM) ?? 'null'));
    } catch {
        return { ...DEFAULT_THRESHOLDS };
    }
}

/**
 * Keeps what differs from the defaults, so that a default the app changes later applies to whoever never changed it.
 * @param {Thresholds} values
 */
export function saveThresholds(values) {
    try {
        const different = Object.fromEntries(
            THRESHOLD_FIELDS.filter(({ key }) => values[key] !== DEFAULT_THRESHOLDS[key]).map(({ key }) => [
                key,
                values[key],
            ])
        );
        if (Object.keys(different).length === 0) globalThis.localStorage?.removeItem(ITEM);
        else globalThis.localStorage?.setItem(ITEM, JSON.stringify(different));
    } catch {
        // They are lost at the next start, the defaults applying again; nothing else depends on them.
    }
}
