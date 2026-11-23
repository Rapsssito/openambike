// A ride's route on a map, coloured by a layer (./layers.js): drawn with MapLibre from OpenFreeMap's tiles, which are free and need no account or key,
// built on OpenStreetMap's data. The map is the only thing the app downloads: its tiles, only while a ride is shown,
// and each download tells OpenFreeMap the phone's IP address and the area shown (README.md, "Your privacy").
import { layerGeoJson } from './layers.js';

/** OpenFreeMap's styles, light and dark. */
export const MAP_STYLES = Object.freeze({
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
});

/**
 * The smallest box that holds the route, as [[west, south], [east, north]].
 * @param {[number, number][]} route
 * @returns {[[number, number], [number, number]]}
 */
export function routeBounds(route) {
    const lons = route.map(([lon]) => lon);
    const lats = route.map(([, lat]) => lat);
    return [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
    ];
}

/** The colours of a layer, from its lowest value to its highest; the route is grey where it has none. */
export const LAYER_COLOURS = Object.freeze(['#3b82f6', '#22c55e', '#eab308', '#ef4444']);

/** @typedef {import('./layers.js').Layer} Layer */
/** @typedef {import('./layers.js').RoutePoint} RoutePoint */

/**
 * @typedef {object} RouteMap a map as `followRoute` uses it: MapLibre's, or a fake in tests
 * @property {(id: string) => { setData: (data: object) => unknown } | undefined} getSource
 * @property {(bounds: ReturnType<typeof routeBounds>, options: object) => unknown} fitBounds
 * @property {(name: string, handler: (event: { originalEvent?: unknown }) => void) => unknown} on
 * @property {() => boolean} isStyleLoaded
 */

/**
 * @typedef {object} RouteView a route drawn on a map
 * @property {(points: RoutePoint[]) => void} update draws the route again, as it grows
 * @property {(layer: Layer) => void} setLayer colours it by another layer
 * @property {(point: RoutePoint | null) => void} setCursor marks a point of it, or none
 * @property {Promise<void>} ready settles once the map has loaded; fails if its style cannot be loaded, as without
 *     internet
 */

/** @param {RoutePoint | null} point */
const cursorGeoJson = (point) => ({
    type: 'FeatureCollection',
    features: point
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }]
        : [],
});

/**
 * Keeps a route drawn on a map: drawn once the map has loaded, coloured by a layer, with a cursor, and the map fitted to
 * it as it grows until the rider moves or zooms the map, whose own moves, as fitting the route, have no `originalEvent`.
 * @param {RouteMap} map
 * @param {Layer} layer
 * @returns {RouteView}
 */
export function followRoute(map, layer) {
    /** @type {RoutePoint[] | null} */
    let latest = null;
    /** @type {RoutePoint | null} */
    let cursor = null;
    let shown = layer;
    let fitting = true;
    const riderMoved = (/** @type {{ originalEvent?: unknown }} */ event) => {
        if (event.originalEvent) fitting = false;
    };
    map.on('dragstart', riderMoved);
    map.on('zoomstart', riderMoved);
    map.on('rotatestart', riderMoved);
    const draw = () => {
        const source = map.getSource('ride');
        if (!source || !latest || latest.length === 0) return;
        source.setData(layerGeoJson(latest, shown));
        if (fitting) {
            map.fitBounds(routeBounds(latest.map((point) => [point.lon, point.lat])), { padding: 32, animate: false });
        }
    };
    const drawCursor = () => map.getSource('cursor')?.setData(cursorGeoJson(cursor));
    /** @type {() => void} */
    let loaded = () => undefined;
    /** @type {(error: Error) => void} */
    let failed = () => undefined;
    const ready = new Promise((resolve, reject) => {
        loaded = () => resolve(undefined);
        failed = reject;
    });
    // The caller may not wait for it.
    ready.catch(() => undefined);
    map.on('load', () => {
        draw();
        if (cursor) drawCursor();
        loaded();
    });
    // A tile that fails after the style loaded changes nothing; a style that cannot load leaves the map blank.
    map.on('error', () => {
        if (!map.isStyleLoaded()) failed(new Error('The map could not be loaded.'));
    });
    return {
        ready,
        update(points) {
            latest = points;
            draw();
        },
        setLayer(next) {
            shown = next;
            draw();
        },
        setCursor(point) {
            cursor = point;
            drawCursor();
        },
    };
}

/**
 * Draws a route on a map in the container, coloured by a layer. MapLibre is loaded the first time, to keep it out of
 * the app's start.
 * @param {HTMLElement} container sized, and in the page
 * @param {RoutePoint[]} points at least two
 * @param {Layer} layer
 * @returns {Promise<RouteView>}
 */
export async function showRoute(container, points, layer) {
    const [{ default: maplibregl }] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const style = getComputedStyle(container);
    const colour = style.getPropertyValue('--ion-color-primary').trim() || '#0f9d76';
    const none = style.getPropertyValue('--app-muted').trim() || '#66736e';
    const map = new maplibregl.Map({
        container,
        style: dark ? MAP_STYLES.dark : MAP_STYLES.light,
        bounds: routeBounds(points.map((point) => [point.lon, point.lat])),
        fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true },
    });
    const stops = LAYER_COLOURS.flatMap((c, i) => [i / (LAYER_COLOURS.length - 1), c]);
    map.on('load', () => {
        // No simplification: at low zoom it drops the short pieces, and with them the colours.
        map.addSource('ride', { type: 'geojson', data: layerGeoJson(points, layer), tolerance: 0 });
        map.addSource('cursor', { type: 'geojson', data: cursorGeoJson(null) });
        map.addLayer({
            id: 'ride-route',
            type: 'line',
            source: 'ride',
            filter: ['==', ['get', 'part'], 'route'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': [
                    'case',
                    ['<', ['get', 'value'], 0],
                    none,
                    ['interpolate', ['linear'], ['get', 'value'], ...stops],
                ],
                'line-width': 5,
            },
        });
        map.addLayer({
            id: 'ride-ends',
            type: 'circle',
            source: 'ride',
            filter: ['!=', ['get', 'part'], 'route'],
            paint: {
                'circle-radius': 6,
                'circle-color': ['match', ['get', 'part'], 'start', colour, '#ffffff'],
                'circle-stroke-color': colour,
                'circle-stroke-width': 3,
            },
        });
        map.addLayer({
            id: 'ride-cursor',
            type: 'circle',
            source: 'cursor',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ffffff',
                'circle-stroke-color': '#111111',
                'circle-stroke-width': 3,
            },
        });
    });
    // After the load above, which adds the sources.
    const view = followRoute(/** @type {RouteMap} */ (/** @type {unknown} */ (map)), layer);
    view.update(points);
    return view;
}
