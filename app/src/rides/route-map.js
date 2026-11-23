// A ride's route on a map: drawn with MapLibre from OpenFreeMap's tiles, which are free and need no account or key,
// built on OpenStreetMap's data. The map is the only thing the app downloads: its tiles, only while a ride is shown,
// and each download tells OpenFreeMap the phone's IP address and the area shown (README.md, "Your privacy").

/** OpenFreeMap's styles, light and dark. */
export const MAP_STYLES = Object.freeze({
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
});

/**
 * The route as GeoJSON, with its start and its end as points.
 * @param {[number, number][]} route [longitude, latitude] of each point
 */
export function routeGeoJson(route) {
    return {
        type: /** @type {const} */ ('FeatureCollection'),
        features: [
            {
                type: /** @type {const} */ ('Feature'),
                properties: { part: 'route' },
                geometry: { type: /** @type {const} */ ('LineString'), coordinates: route },
            },
            {
                type: /** @type {const} */ ('Feature'),
                properties: { part: 'start' },
                geometry: { type: /** @type {const} */ ('Point'), coordinates: route[0] },
            },
            {
                type: /** @type {const} */ ('Feature'),
                properties: { part: 'end' },
                geometry: { type: /** @type {const} */ ('Point'), coordinates: route.at(-1) ?? route[0] },
            },
        ],
    };
}

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

/**
 * @typedef {object} RouteMap a map as `followRoute` uses it: MapLibre's, or a fake in tests
 * @property {(id: string) => { setData: (data: ReturnType<typeof routeGeoJson>) => unknown } | undefined} getSource
 * @property {(bounds: ReturnType<typeof routeBounds>, options: object) => unknown} fitBounds
 * @property {(name: string, handler: (event: { originalEvent?: unknown }) => void) => unknown} on
 */

/**
 * Keeps the route of a ride being recorded drawn as it grows: drawn once the map has loaded, and the map fitted to it
 * until the rider moves or zooms the map, whose own moves, as fitting the route, have no `originalEvent`.
 * @param {RouteMap} map
 */
export function followRoute(map) {
    /** @type {[number, number][] | null} */
    let latest = null;
    let fitting = true;
    const riderMoved = (/** @type {{ originalEvent?: unknown }} */ event) => {
        if (event.originalEvent) fitting = false;
    };
    map.on('dragstart', riderMoved);
    map.on('zoomstart', riderMoved);
    map.on('rotatestart', riderMoved);
    /** @param {[number, number][]} route */
    const draw = (route) => {
        const source = map.getSource('ride');
        if (!source) return;
        source.setData(routeGeoJson(route));
        if (fitting) map.fitBounds(routeBounds(route), { padding: 32, animate: false });
    };
    map.on('load', () => {
        if (latest) draw(latest);
    });
    return {
        /** @param {[number, number][]} route the whole route so far */
        update(route) {
            latest = route;
            draw(route);
        },
    };
}

/**
 * Draws the route on a map in the container. MapLibre is loaded the first time, to keep it out of the app's start.
 * @param {HTMLElement} container sized, and in the page
 * @param {[number, number][]} route
 * @returns {Promise<{ update: (route: [number, number][]) => void }>} draws the route again as it grows, for a ride
 *     being recorded
 */
export async function showRoute(container, route) {
    const [{ default: maplibregl }] = await Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const colour = getComputedStyle(container).getPropertyValue('--ion-color-primary').trim() || '#0f9d76';
    const map = new maplibregl.Map({
        container,
        style: dark ? MAP_STYLES.dark : MAP_STYLES.light,
        bounds: routeBounds(route),
        fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true },
    });
    map.on('load', () => {
        map.addSource('ride', { type: 'geojson', data: routeGeoJson(route) });
        map.addLayer({
            id: 'ride-route',
            type: 'line',
            source: 'ride',
            filter: ['==', ['get', 'part'], 'route'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': colour, 'line-width': 4 },
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
    });
    // After the load above, which adds the route's source.
    return followRoute(/** @type {RouteMap} */ (/** @type {unknown} */ (map)));
}
