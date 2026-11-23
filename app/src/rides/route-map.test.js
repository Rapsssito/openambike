import { layerGeoJson, routePoints } from './layers.js';
import { followRoute, LAYER_COLOURS, MAP_STYLES, routeBounds } from './route-map.js';

describe('route map', () => {
    const route = /** @type {[number, number][]} */ ([
        [2.17, 41.38],
        [2.18, 41.39],
        [2.16, 41.4],
    ]);
    /** @param {[number, number][]} lonLats */
    const pointsOf = (lonLats) =>
        routePoints(
            lonLats.map(([lon, lat], i) => ({ t: i * 1_000, lon, lat, alt: 10 + i, acc: 5, speed: 5 + i })),
            []
        );
    const points = pointsOf(route);

    test('the map comes from OpenFreeMap', () => {
        expect(MAP_STYLES.light).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
        expect(MAP_STYLES.dark).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    });

    test('the layers go from a colour for the lowest to one for the highest', () => {
        expect(LAYER_COLOURS.length).toBeGreaterThanOrEqual(2);
    });

    test('the map opens on the box that holds the route', () => {
        expect(routeBounds(route)).toEqual([
            [2.16, 41.38],
            [2.18, 41.4],
        ]);
    });

    /** A map as followRoute uses it: its sources, its view, and the events it listens to. */
    function fakeMap() {
        /** @type {Record<string, ((event: { originalEvent?: unknown }) => void)[]>} */
        const handlers = {};
        const map = {
            /** @type {Record<string, unknown[]>} */
            drawn: { ride: [], cursor: [] },
            /** @type {unknown[]} */
            fitted: [],
            hasSource: false,
            styleLoaded: false,
            isStyleLoaded: () => map.styleLoaded,
            getSource: (/** @type {string} */ id) =>
                map.hasSource ? { setData: (/** @type {unknown} */ data) => map.drawn[id].push(data) } : undefined,
            fitBounds: (/** @type {unknown} */ bounds) => map.fitted.push(bounds),
            on: (/** @type {string} */ name, /** @type {(event: { originalEvent?: unknown }) => void} */ handler) => {
                (handlers[name] ??= []).push(handler);
            },
            /** @param {string} name @param {{ originalEvent?: unknown }} [event] */
            emit: (name, event = {}) => {
                for (const handler of handlers[name] ?? []) handler(event);
            },
        };
        return map;
    }

    test('a growing route is drawn as it grows, once the map has loaded, and fitted until the rider moves the map', () => {
        const map = fakeMap();
        const follow = followRoute(map, 'speed');
        const early = points.slice(0, 2);
        follow.update(early);
        expect(map.drawn.ride).toEqual([]);
        map.hasSource = true;
        map.emit('load');
        expect(map.drawn.ride).toEqual([layerGeoJson(early, 'speed')]);
        follow.update(points);
        expect(map.drawn.ride.at(-1)).toEqual(layerGeoJson(points, 'speed'));
        expect(map.fitted.at(-1)).toEqual(routeBounds(route));
        // A zoom of its own, as fitting the route, changes nothing; the rider's does.
        map.emit('zoomstart');
        follow.update(points);
        expect(map.fitted).toHaveLength(3);
        map.emit('zoomstart', { originalEvent: {} });
        follow.update(pointsOf([...route, [2.2, 41.5]]));
        expect(map.fitted).toHaveLength(3);
        expect(map.drawn.ride).toHaveLength(4);
    });

    test('the rider dragging the map also stops the fitting', () => {
        const map = fakeMap();
        map.hasSource = true;
        const follow = followRoute(map, 'speed');
        map.emit('dragstart', { originalEvent: {} });
        follow.update(points);
        expect(map.fitted).toEqual([]);
        expect(map.drawn.ride).toHaveLength(1);
    });

    test('another layer draws the route again with its values', () => {
        const map = fakeMap();
        map.hasSource = true;
        const follow = followRoute(map, 'speed');
        follow.update(points);
        follow.setLayer('elevation');
        expect(map.drawn.ride.at(-1)).toEqual(layerGeoJson(points, 'elevation'));
    });

    test('the cursor marks a point of the route, and goes away without one', () => {
        const map = fakeMap();
        map.hasSource = true;
        const follow = followRoute(map, 'speed');
        follow.setCursor(points[1]);
        expect(map.drawn.cursor.at(-1)).toEqual({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.18, 41.39] } }],
        });
        follow.setCursor(null);
        expect(map.drawn.cursor.at(-1)).toEqual({ type: 'FeatureCollection', features: [] });
    });

    test('it says when the map has loaded', async () => {
        const map = fakeMap();
        const follow = followRoute(map, 'speed');
        let loaded = false;
        follow.ready.then(() => {
            loaded = true;
        });
        await Promise.resolve();
        expect(loaded).toBe(false);
        map.emit('load');
        await follow.ready;
        expect(loaded).toBe(true);
    });

    test('a map whose style cannot be loaded fails, but a tile that fails after it loaded does not', async () => {
        const failing = fakeMap();
        const first = followRoute(failing, 'speed');
        failing.emit('error');
        await expect(first.ready).rejects.toThrow();
        const loaded = fakeMap();
        const second = followRoute(loaded, 'speed');
        loaded.styleLoaded = true;
        loaded.emit('error');
        loaded.emit('load');
        await expect(second.ready).resolves.toBeUndefined();
    });
});
