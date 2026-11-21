import { rideDetector, RIDE_END_MS, RIDE_START_MS } from './ride-mode.js';

/**
 * @param {number} speedKmh
 * @param {number} [riderWatts]
 */
const metrics = (speedKmh, riderWatts = 0) => ({ odometerKm: 3774.25, motorWatts: 0, speedKmh, riderWatts });

describe('ride detection', () => {
    test('ride-charge: moving for 3 seconds starts a ride', () => {
        const ride = rideDetector();
        expect(ride.observe(metrics(8.2), 0)).toBe(false);
        expect(ride.observe(metrics(10.4), 1000)).toBe(false);
        expect(ride.observe(metrics(14.5), RIDE_START_MS)).toBe(true);
        expect(ride.riding).toBe(true);
    });

    test('rider power alone counts as moving', () => {
        const ride = rideDetector();
        for (let at = 0; at <= RIDE_START_MS; at += 1000) ride.observe(metrics(0, 120), at);
        expect(ride.riding).toBe(true);
    });

    test('a stop or a long gap before 3 seconds starts counting again', () => {
        const ride = rideDetector();
        ride.observe(metrics(10), 0);
        ride.observe(metrics(0), 1000);
        ride.observe(metrics(10), 2000);
        expect(ride.observe(metrics(10), 4000)).toBe(false);
        expect(ride.observe(metrics(10), 60000)).toBe(false);
        expect(ride.riding).toBe(false);
    });

    test('a minute still, or with no figures, ends the ride', () => {
        const ride = rideDetector();
        for (let at = 0; at <= RIDE_START_MS; at += 1000) ride.observe(metrics(15), at);
        expect(ride.observe(metrics(0), RIDE_START_MS + 1000)).toBe(false);
        expect(ride.tick(RIDE_START_MS + RIDE_END_MS - 1)).toBe(false);
        expect(ride.tick(RIDE_START_MS + RIDE_END_MS)).toBe(true);
        expect(ride.riding).toBe(false);
    });
});
