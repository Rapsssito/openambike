import { MAP_STYLES, routeBounds, routeGeoJson } from './route-map.js';

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
});
