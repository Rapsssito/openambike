// A ride, read from the file the app's native service writes while it records (android/app/src/main/java/org/
// openambike/app/link/RideRecorder.java): one JSON object per line, with the phone's GPS fixes and the bike's
// notifications as they came. The bike's bytes are decoded here, by protocol.js; the service knows nothing of them.
import { CHARACTERISTIC, decodeAsiMetrics, decodeBattery } from '../ble/protocol.js';

/** With no speed for this long, the ride counts as stopped: its moving time leaves it out (auto-pause). */
export const AUTO_PAUSE_MS = 10_000;

/**
 * The version of the way a ride is summed up: a summary kept with another is made again from the ride's file. It goes
 * up whenever `summary` changes what it says.
 */
export const SUMMARY_VERSION = 1;

/** A GPS fix less accurate than this, in metres, is left out of the route. */
export const MAX_FIX_ACCURACY_M = 30;

/** Below this speed, in metres per second, a GPS fix does not say the bike moves. */
const GPS_MOVING_MPS = 1;

/** The Earth's mean radius, in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * @typedef {object} Fix
 * @property {number} t when it was written, in milliseconds since 1970
 * @property {number} lat
 * @property {number} lon
 * @property {number | null} alt metres
 * @property {number | null} acc metres
 * @property {number | null} speed metres per second
 */

/**
 * @typedef {object} BikeSample
 * @property {number} t
 * @property {number} odometerKm
 * @property {number} speedKmh
 * @property {number} motorWatts
 * @property {number} riderWatts
 */

/**
 * @typedef {object} RideSummary
 * @property {number} id when the ride started, in milliseconds since 1970, which also names it
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {boolean} ended whether the ride was stopped, rather than still recording
 * @property {boolean} paused whether the rider paused it, as it stands now
 * @property {number} totalMs from start to end
 * @property {number} movingMs leaving out the rider's pauses and the stops
 * @property {number} distanceKm from the bike's odometer while it was connected, otherwise from GPS
 * @property {'bike' | 'gps' | null} distanceFrom
 * @property {number | null} averageKmh distance over moving time
 * @property {number | null} maxKmh
 * @property {number | null} averageMotorWatts while moving
 * @property {number | null} averageRiderWatts while moving
 * @property {number | null} energyWh the battery energy used, from its absolute state of charge
 * @property {[number, number][]} route [longitude, latitude] of each fix kept
 */

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} metres along the Earth's surface
 */
export function haversineM(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
function bytesOf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

/**
 * Reads a ride's file as it grows: `push` takes each new piece of whole lines, `summary` says what the ride is so far.
 * @param {number} id
 */
export function createRideReader(id) {
    /** @type {Fix[]} */
    const fixes = [];
    /** @type {BikeSample[]} */
    const bike = [];
    /** @type {{ t: number, mWh: number }[]} */
    const energy = [];
    /** The rider's pauses, each from when it started to when it ended, or null while it lasts. */
    /** @type {[number, number | null][]} */
    const pauses = [];
    let startedAt = id;
    let lastAt = id;
    let ended = false;
    /** Where a ride auto-ride stopped ends: its last movement; what came after is left out. */
    /** @type {number | null} */
    let endAt = null;

    /** @param {Record<string, any>} line */
    function take(line) {
        if (typeof line.t !== 'number') return;
        lastAt = Math.max(lastAt, line.t);
        switch (line.type) {
            case 'start':
                startedAt = line.t;
                break;
            case 'fix':
                fixes.push({
                    t: line.t,
                    lat: line.lat,
                    lon: line.lon,
                    alt: line.alt ?? null,
                    acc: line.acc ?? null,
                    speed: line.speed ?? null,
                });
                break;
            case 'frame':
                takeFrame(line.t, String(line.c).toLowerCase(), bytesOf(String(line.v)));
                break;
            case 'pause':
                if (pauses.at(-1)?.[1] !== null) pauses.push([line.t, null]);
                break;
            case 'resume': {
                const last = pauses.at(-1);
                if (last && last[1] === null) last[1] = line.t;
                break;
            }
            case 'stop':
                ended = true;
                if (typeof line.end === 'number') endAt = line.end;
                break;
            default:
                // A line of a later format, or about GPS being on or off: nothing to take.
                break;
        }
    }

    /**
     * @param {number} t
     * @param {string} characteristic
     * @param {Uint8Array} bytes
     */
    function takeFrame(t, characteristic, bytes) {
        try {
            if (characteristic === CHARACTERISTIC.asiMetrics.uuid.toLowerCase()) {
                bike.push({ t, ...decodeAsiMetrics(bytes) });
            } else if (characteristic === CHARACTERISTIC.battery.uuid.toLowerCase()) {
                const { absoluteSoc } = decodeBattery(bytes);
                if (absoluteSoc !== null) energy.push({ t, mWh: absoluteSoc });
            }
        } catch {
            // A frame too short to decode is left out.
        }
    }

    /** @param {number} t */
    const pausedAt = (t) => pauses.some(([from, to]) => t >= from && (to === null || t < to));
    /** @param {number} t */
    const kept = (t) => !pausedAt(t) && (endAt === null || t <= endAt);

    return {
        /** @param {string} text whole lines of the file */
        push(text) {
            for (const raw of text.split('\n')) {
                if (raw.trim() === '') continue;
                try {
                    take(JSON.parse(raw));
                } catch {
                    // A line cut by a phone that stopped mid-write is left out.
                }
            }
        },

        /** The fixes kept for the route: accurate enough, outside the rider's pauses. */
        route() {
            return fixes.filter((fix) => (fix.acc === null || fix.acc <= MAX_FIX_ACCURACY_M) && kept(fix.t));
        },

        /** The bike's figures over time, outside the rider's pauses. */
        bikeSamples() {
            return bike.filter((sample) => kept(sample.t));
        },

        /** @returns {RideSummary} */
        summary() {
            const route = this.route();
            const samples = this.bikeSamples();

            // What says the bike moves: speed or the rider's power from the bike, or speed from GPS.
            const moving = [
                ...samples.filter((s) => s.speedKmh > 0 || s.riderWatts > 0).map((s) => s.t),
                ...route.filter((f) => (f.speed ?? 0) >= GPS_MOVING_MPS).map((f) => f.t),
            ].sort((a, b) => a - b);
            let movingMs = 0;
            for (let i = 1; i < moving.length; i++) {
                const gap = moving[i] - moving[i - 1];
                if (gap <= AUTO_PAUSE_MS) movingMs += gap;
            }

            let gpsM = 0;
            for (let i = 1; i < route.length; i++) {
                const a = route[i - 1];
                const b = route[i];
                if (b.t - a.t > AUTO_PAUSE_MS * 3) continue;
                const metres = haversineM(a.lat, a.lon, b.lat, b.lon);
                // Standing still, GPS drifts: a step counts if the fix says it moved, or it is beyond the fixes' error.
                const drift = Math.max(a.acc ?? 0, b.acc ?? 0);
                if ((b.speed ?? 0) >= GPS_MOVING_MPS || metres > drift) gpsM += metres;
            }

            // The odometer counts in tens of metres; its rise over the samples is the distance ridden while connected.
            let bikeKm = 0;
            for (let i = 1; i < samples.length; i++) {
                const step = samples[i].odometerKm - samples[i - 1].odometerKm;
                if (step > 0 && step < 1) bikeKm += step;
            }
            const distanceFrom = bikeKm > 0 ? 'bike' : route.length > 1 ? 'gps' : null;
            const distanceKm = distanceFrom === 'bike' ? bikeKm : gpsM / 1000;

            const movingSamples = samples.filter((s) => s.speedKmh > 0 || s.riderWatts > 0);
            const mean = (/** @type {number[]} */ values) =>
                values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
            const speeds = [...samples.map((s) => s.speedKmh), ...route.map((f) => (f.speed ?? 0) * 3.6)];

            const endedAt = endAt === null ? lastAt : Math.min(lastAt, endAt);
            let pausedMs = 0;
            for (const [from, to] of pauses) {
                if (from < endedAt) pausedMs += Math.min(to ?? endedAt, endedAt) - from;
            }
            const used = energy.filter((e) => e.t <= endedAt);

            return {
                id,
                startedAt,
                endedAt,
                ended,
                paused: pauses.at(-1)?.[1] === null,
                totalMs: Math.max(0, endedAt - startedAt - pausedMs),
                movingMs,
                distanceKm,
                distanceFrom,
                averageKmh: movingMs > 0 && distanceFrom !== null ? distanceKm / (movingMs / 3_600_000) : null,
                maxKmh: speeds.length > 0 ? Math.max(...speeds) : null,
                averageMotorWatts: mean(movingSamples.map((s) => s.motorWatts)),
                averageRiderWatts: mean(movingSamples.map((s) => s.riderWatts)),
                energyWh: used.length > 1 ? Math.max(0, (used[0].mWh - (used.at(-1)?.mWh ?? 0)) / 1000) : null,
                route: route.map((fix) => [fix.lon, fix.lat]),
            };
        },

        /** Whether the bike has shown no movement for the auto-pause time, as of `now`. */
        stoppedAt(/** @type {number} */ now) {
            const last = [
                ...bike.filter((s) => s.speedKmh > 0 || s.riderWatts > 0).map((s) => s.t),
                ...fixes.filter((f) => (f.speed ?? 0) >= GPS_MOVING_MPS).map((f) => f.t),
            ].reduce((latest, t) => Math.max(latest, t), Number.NEGATIVE_INFINITY);
            return now - last >= AUTO_PAUSE_MS;
        },
    };
}

/** @typedef {ReturnType<typeof createRideReader>} RideReader */
