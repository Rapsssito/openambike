import { distance, number, speed } from './format.js';

describe('format', () => {
    test('numbers follow the language', () => {
        expect(number(51.194, 2, 'en')).toBe('51.19');
        expect(number(51.194, 2, 'es')).toBe('51,19');
    });

    test('speed and distance in kilometres or miles', () => {
        expect(speed(25, 'km', 'en')).toBe('25.0 km/h');
        expect(speed(25, 'mi', 'en')).toBe('15.5 mph');
        expect(distance(3774.23, 'km', 'en')).toBe('3,774.2 km');
        expect(distance(3774.23, 'mi', 'en')).toBe('2,345.2 mi');
    });
});
