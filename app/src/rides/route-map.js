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
 * Draws the route on a map in the container. MapLibre is loaded the first time, to keep it out of the app's start.
 * @param {HTMLElement} container sized, and in the page
 * @param {[number, number][]} route
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
    return map;
}
