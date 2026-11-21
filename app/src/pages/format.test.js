import { distance, duration, number, speed } from './format.js';

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
});
