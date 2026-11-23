import { followRoute, MAP_STYLES, routeBounds, routeGeoJson } from './route-map.js';

describe('route map', () => {
    const route = /** @type {[number, number][]} */ ([
        [2.17, 41.38],
        [2.18, 41.39],
        [2.16, 41.4],
    ]);

    test('the map comes from OpenFreeMap', () => {
        expect(MAP_STYLES.light).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
        expect(MAP_STYLES.dark).toMatch(/^https:\/\/tiles\.openfreemap\.org\//);
    });

    test('the route is a line, with its start and end as points', () => {
        const { features } = routeGeoJson(route);
        expect(features.map((f) => f.properties.part)).toEqual(['route', 'start', 'end']);
        expect(features[0].geometry.coordinates).toEqual(route);
        expect(features[1].geometry.coordinates).toEqual([2.17, 41.38]);
        expect(features[2].geometry.coordinates).toEqual([2.16, 41.4]);
    });

    test('the map opens on the box that holds the route', () => {
        expect(routeBounds(route)).toEqual([
            [2.16, 41.38],
            [2.18, 41.4],
        ]);
    });

    /** A map as followRoute uses it: its source, its view, and the events it listens to. */
    function fakeMap() {
        /** @type {Record<string, ((event: { originalEvent?: unknown }) => void)[]>} */
        const handlers = {};
        const map = {
            /** @type {unknown[]} */
            drawn: [],
            /** @type {unknown[]} */
            fitted: [],
            hasSource: false,
            getSource: () =>
                map.hasSource ? { setData: (/** @type {unknown} */ data) => map.drawn.push(data) } : undefined,
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
        const follow = followRoute(map);
        follow.update(route.slice(0, 2));
        expect(map.drawn).toEqual([]);
        map.hasSource = true;
        map.emit('load');
        expect(map.drawn).toEqual([routeGeoJson(route.slice(0, 2))]);
        follow.update(route);
        expect(map.drawn.at(-1)).toEqual(routeGeoJson(route));
        expect(map.fitted.at(-1)).toEqual(routeBounds(route));
        // A zoom of its own, as fitting the route, changes nothing; the rider's does.
        map.emit('zoomstart');
        follow.update(route);
        expect(map.fitted).toHaveLength(3);
        map.emit('zoomstart', { originalEvent: {} });
        follow.update([...route, [2.2, 41.5]]);
        expect(map.fitted).toHaveLength(3);
        expect(map.drawn).toHaveLength(4);
    });

    test('the rider dragging the map also stops the fitting', () => {
        const map = fakeMap();
        map.hasSource = true;
        const follow = followRoute(map);
        map.emit('dragstart', { originalEvent: {} });
        follow.update(route);
        expect(map.fitted).toEqual([]);
        expect(map.drawn).toHaveLength(1);
    });
});
