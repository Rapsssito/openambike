import { RIDE_ID, rideFile } from '../test-support/ride-file.js';
import { ridesToGpx } from './gpx.js';
import { createRideReader } from './ride.js';

describe('GPX', () => {
    const reader = createRideReader(RIDE_ID);
    reader.push(rideFile());

    test('a ride is a track with a point per fix, its time, and the bike speed and powers', () => {
        const gpx = ridesToGpx([{ name: 'Ride & more', reader }], { creator: 'OpenAMBike' });
        expect(gpx).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" creator="OpenAMBike"/);
        expect(gpx).toContain('<name>Ride &amp; more</name>');
        expect(gpx.match(/<trkpt /g)).toHaveLength(100);
        expect(gpx).toContain(`<time>${new Date(RIDE_ID + 1000).toISOString()}</time>`);
        expect(gpx).toContain('<gpxtpx:speed>5.00</gpxtpx:speed>');
        expect(gpx).toContain('<power>10</power>');
        expect(gpx).toContain('<openambike:motorPower>120</openambike:motorPower>');
        expect(gpx).toContain('<ele>12.0</ele>');
        expect(gpx.trim().endsWith('</gpx>')).toBe(true);
    });

    test('the history is one file with a track per ride', () => {
        const gpx = ridesToGpx(
            [
                { name: 'One', reader },
                { name: 'Two', reader },
            ],
            { creator: 'OpenAMBike' }
        );
        expect(gpx.match(/<trk>/g)).toHaveLength(2);
    });
});
