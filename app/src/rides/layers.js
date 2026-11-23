// The layers a ride's map is coloured by: each point of the route with the bike's figures reported nearest to it in
// time, and the route as pieces, each with where its value stands between the layer's lowest and highest.

/** @typedef {import('./ride.js').Fix} Fix */
/** @typedef {import('./ride.js').BikeSample} BikeSample */
/** @typedef {'speed' | 'rider' | 'motor' | 'elevation'} Layer */

/**
 * @typedef {object} RoutePoint
 * @property {number} t
 * @property {number} lon
 * @property {number} lat
 * @property {number | null} speed km/h: the bike's, or the GPS's where the bike reported nothing near
 * @property {number | null} rider watts, where the bike reported near
 * @property {number | null} motor watts, where the bike reported near
 * @property {number | null} elevation metres, the GPS's altitude
 */

/** The layers, the first the default. */
export const LAYERS = /** @type {const} */ (['speed', 'rider', 'motor', 'elevation']);

/** A point of the route takes the bike's figures reported at most this far from it in time. */
export const NEAREST_MS = 3_000;

/**
 * The item of a list sorted by time nearest to a moment, or null for an empty list.
 * @template {{ t: number }} T
 * @param {T[]} items
 * @param {number} t
 * @returns {T | null}
 */
function nearest(items, t) {
    if (items.length === 0) return null;
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (items[middle].t < t) low = middle + 1;
        else high = middle;
    }
    const after = items[low];
    const before = items[low - 1];
    return before && t - before.t <= after.t - t ? before : after;
}

/**
 * Each fix of the route with the figures of the layers.
 * @param {Fix[]} route the fixes kept for the route, in order
 * @param {BikeSample[]} samples the bike's figures, in order
 * @returns {RoutePoint[]}
 */
export function routePoints(route, samples) {
    return route.map((fix) => {
        const found = nearest(samples, fix.t);
        const bike = found && Math.abs(found.t - fix.t) <= NEAREST_MS ? found : null;
        return {
            t: fix.t,
            lon: fix.lon,
            lat: fix.lat,
            speed: bike ? bike.speedKmh : fix.speed === null ? null : fix.speed * 3.6,
            rider: bike ? bike.riderWatts : null,
            motor: bike ? bike.motorWatts : null,
            elevation: fix.alt,
        };
    });
}

/**
 * A layer's lowest and highest value along the route, or null if it has none.
 * @param {RoutePoint[]} points
 * @param {Layer} layer
 * @returns {{ low: number, high: number } | null}
 */
export function layerRange(points, layer) {
    const values = points.map((point) => point[layer]).filter((value) => value !== null);
    if (values.length === 0) return null;
    return { low: Math.min(...values), high: Math.max(...values) };
}

/**
 * The route as GeoJSON for a layer: a line from each point to the next, with `value` where the value at its end stands
 * between the layer's lowest (0) and highest (1), or -1 without one; and its start and its end as points.
 * @param {RoutePoint[]} points at least one
 * @param {Layer} layer
 */
export function layerGeoJson(points, layer) {
    const range = layerRange(points, layer);
    /** @param {number | null} value */
    const where = (value) => {
        if (value === null || range === null) return -1;
        return range.high > range.low ? (value - range.low) / (range.high - range.low) : 0.5;
    };
    const pieces = points.slice(1).map((point, i) => ({
        type: /** @type {const} */ ('Feature'),
        properties: { part: 'route', value: where(point[layer]) },
        geometry: {
            type: /** @type {const} */ ('LineString'),
            coordinates: [
                [points[i].lon, points[i].lat],
                [point.lon, point.lat],
            ],
        },
    }));
    /** @param {'start' | 'end'} part @param {RoutePoint} point */
    const end = (part, point) => ({
        type: /** @type {const} */ ('Feature'),
        properties: { part, value: -1 },
        geometry: { type: /** @type {const} */ ('Point'), coordinates: [point.lon, point.lat] },
    });
    const last = points.at(-1) ?? points[0];
    return {
        type: /** @type {const} */ ('FeatureCollection'),
        features: [...pieces, end('start', points[0]), end('end', last)],
    };
}

/**
 * The point of the route nearest a moment, or null without points.
 * @param {RoutePoint[]} points
 * @param {number} t
 */
export function pointAt(points, t) {
    return nearest(points, t);
}

/**
 * A layer's values over the ride, for its chart, as [time, value]: the bike's figures as it reported them, or, for
 * speed without them, the GPS's; the GPS's altitude for elevation.
 * @param {BikeSample[]} samples
 * @param {Fix[]} fixes
 * @param {Layer} layer
 * @returns {[number, number][]}
 */
export function layerSeries(samples, fixes, layer) {
    if (layer === 'elevation') return fixes.flatMap((f) => (f.alt === null ? [] : [[f.t, f.alt]]));
    if (layer === 'speed' && samples.length === 0) {
        return fixes.flatMap((f) => (f.speed === null ? [] : [[f.t, f.speed * 3.6]]));
    }
    const field = layer === 'speed' ? 'speedKmh' : layer === 'rider' ? 'riderWatts' : 'motorWatts';
    return samples.map((s) => [s.t, s[field]]);
}
