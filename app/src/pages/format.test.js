import { chartRange, distance, duration, number, speed } from './format.js';

describe('format', () => {
    test('a duration is minutes and seconds, with hours from an hour on', () => {
        expect(duration(0)).toBe('0:00');
        expect(duration(309_999)).toBe('5:09');
        expect(duration(3_909_000)).toBe('1:05:09');
    });

    test('numbers follow the language', () => {
        expect(number(51.194, 2, 'en')).toBe('51.19');
        expect(number(51.194, 2, 'es')).toBe('51,19');
    });

    test('speed and distance in kilometres or miles', () => {
        expect(speed(25, 'km', 'en')).toBe('25.0 km/h');
        expect(speed(25, 'mi', 'en')).toBe('15.5 mph');
        expect(distance(3774.23, 'km', 'en')).toBe('3,774.2 km');
        expect(distance(3774.23, 'mi', 'en')).toBe('2,345.2 mi');
        expect(distance(3774.23, 'km', 'en', 0)).toBe('3,774 km');
    });

    test("a chart's scale runs from its lowest value to its highest, never from zero by default", () => {
        expect(
            chartRange([
                [
                    [0, 30],
                    [1, 34],
                    [2, 31],
                ],
            ])
        ).toEqual({ low: 30, high: 34 });
        // Several series share one scale.
        expect(
            chartRange([
                [[0, 40]],
                [
                    [0, 90],
                    [1, 120],
                ],
            ])
        ).toEqual({ low: 40, high: 120 });
        expect(chartRange([[], []])).toBeNull();
    });

    test('a flat chart gets a little room, and no room below zero where the values are not below it', () => {
        expect(chartRange([[[0, 30]]])).toEqual({ low: 29, high: 31 });
        expect(chartRange([[[0, 0]]])).toEqual({ low: 0, high: 1 });
        expect(chartRange([[[0, -5]]])).toEqual({ low: -6, high: -4 });
    });
});
