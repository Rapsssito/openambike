import { LAYERS, layerGeoJson, layerRange, layerSeries, NEAREST_MS, pointAt, routePoints } from './layers.js';

/** @param {number} t @param {number} lon @param {Partial<import('./ride.js').Fix>} [more] */
const fix = (t, lon, more = {}) => ({ t, lat: 41.4, lon, alt: null, acc: 5, speed: null, ...more });
/** @param {number} t @param {number} speedKmh @param {number} riderWatts @param {number} motorWatts */
const sample = (t, speedKmh, riderWatts, motorWatts) => ({ t, odometerKm: 1, speedKmh, riderWatts, motorWatts });

describe('route layers', () => {
    test('the layers, speed first, the default', () => {
        expect(LAYERS).toEqual(['speed', 'rider', 'motor', 'elevation']);
    });

    test("each point takes the bike's figures reported nearest to it in time, within 3 seconds", () => {
        const points = routePoints(
            [fix(1_000, 2.1, { alt: 30 }), fix(2_000, 2.2), fix(10_000, 2.3, { speed: 5 })],
            [sample(900, 18, 120, 60), sample(2_600, 20, 100, 50), sample(2_900, 21, 90, 40)]
        );
        expect(NEAREST_MS).toBe(3_000);
        expect(points).toEqual([
            { t: 1_000, lon: 2.1, lat: 41.4, speed: 18, rider: 120, motor: 60, elevation: 30 },
            { t: 2_000, lon: 2.2, lat: 41.4, speed: 20, rider: 100, motor: 50, elevation: null },
            // No report within 3 s: the GPS's speed, in km/h, and no power.
            { t: 10_000, lon: 2.3, lat: 41.4, speed: 18, rider: null, motor: null, elevation: null },
        ]);
    });

    test("a layer's range is its lowest and highest value, or none without values", () => {
        const points = routePoints([fix(0, 2.1, { alt: 30 }), fix(1_000, 2.2, { alt: 42 })], []);
        expect(layerRange(points, 'elevation')).toEqual({ low: 30, high: 42 });
        expect(layerRange(points, 'rider')).toBeNull();
    });

    test('the route is drawn piece by piece, each with where its value stands in the range, or -1 without one', () => {
        const points = routePoints(
            [fix(0, 2.1), fix(1_000, 2.2), fix(2_000, 2.3), fix(9_000, 2.4)],
            [sample(0, 10, 0, 0), sample(1_000, 20, 0, 0), sample(2_000, 30, 0, 0)]
        );
        const { features } = layerGeoJson(points, 'speed');
        const pieces = features.filter((f) => f.properties.part === 'route');
        expect(pieces.map((f) => f.geometry.coordinates)).toEqual([
            [
                [2.1, 41.4],
                [2.2, 41.4],
            ],
            [
                [2.2, 41.4],
                [2.3, 41.4],
            ],
            [
                [2.3, 41.4],
                [2.4, 41.4],
            ],
        ]);
        expect(pieces.map((f) => f.properties.value)).toEqual([0.5, 1, -1]);
        const ends = features.filter((f) => f.properties.part !== 'route');
        expect(ends.map((f) => [f.properties.part, f.geometry.coordinates])).toEqual([
            ['start', [2.1, 41.4]],
            ['end', [2.4, 41.4]],
        ]);
    });

    test('a layer whose values are all the same draws them in the middle of its colours', () => {
        const points = routePoints([fix(0, 2.1), fix(1_000, 2.2)], [sample(0, 20, 0, 0), sample(1_000, 20, 0, 0)]);
        const pieces = layerGeoJson(points, 'speed').features.filter((f) => f.properties.part === 'route');
        expect(pieces.map((f) => f.properties.value)).toEqual([0.5]);
    });

    test('the point nearest a moment, for the chart that marks where the rider was', () => {
        const points = routePoints([fix(1_000, 2.1), fix(2_000, 2.2), fix(4_000, 2.3)], []);
        expect(pointAt(points, 0)?.lon).toBe(2.1);
        expect(pointAt(points, 2_900)?.lon).toBe(2.2);
        expect(pointAt(points, 3_100)?.lon).toBe(2.3);
        expect(pointAt(points, 99_000)?.lon).toBe(2.3);
        expect(pointAt([], 1_000)).toBeNull();
    });

    test("a layer's chart: the bike's figures as reported, the GPS's speed without them, and the GPS's altitude", () => {
        const fixes = [
            fix(1_000, 2.1, { alt: 30, speed: 5 }),
            fix(2_000, 2.2, { speed: null }),
            fix(3_000, 2.3, { alt: 34 }),
        ];
        const samples = [sample(1_500, 18, 120, 60), sample(2_500, 20, 100, 50)];
        expect(layerSeries(samples, fixes, 'speed')).toEqual([
            [1_500, 18],
            [2_500, 20],
        ]);
        expect(layerSeries(samples, fixes, 'rider')).toEqual([
            [1_500, 120],
            [2_500, 100],
        ]);
        expect(layerSeries(samples, fixes, 'motor')).toEqual([
            [1_500, 60],
            [2_500, 50],
        ]);
        expect(layerSeries([], fixes, 'speed')).toEqual([[1_000, 18]]);
        expect(layerSeries(samples, fixes, 'elevation')).toEqual([
            [1_000, 30],
            [3_000, 34],
        ]);
    });
});
