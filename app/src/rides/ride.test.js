import { RIDE_ID, rideFile } from '../test-support/ride-file.js';
import { createRideReader, haversineM } from './ride.js';

describe('ride', () => {
    test('a degree of latitude is about 111 km', () => {
        expect(haversineM(41, 2, 42, 2)).toBeCloseTo(111_195, -1);
    });

    test('a ride is summed up from its file: moving time, distance from the odometer, speeds, power and energy', () => {
        const reader = createRideReader(RIDE_ID);
        reader.push(rideFile());
        const ride = reader.summary();
        expect(ride).toMatchObject({
            id: RIDE_ID,
            startedAt: RIDE_ID,
            endedAt: RIDE_ID + 130_000,
            ended: true,
            paused: false,
        });
        // 130 s from start to stop, less the rider's pause of 30 s.
        expect(ride.totalMs).toBe(100_001);
        // 59 s and 19 s moving; the pause and the 20 s standing still are left out.
        expect(ride.movingMs).toBe(78_000);
        expect(ride.distanceFrom).toBe('bike');
        expect(ride.distanceKm).toBeCloseTo(0.4, 5);
        expect(ride.averageKmh).toBeCloseTo(18.46, 1);
        expect(ride.maxKmh).toBe(18);
        expect(ride.averageMotorWatts).toBe(120);
        expect(ride.averageRiderWatts).toBeCloseTo(10.47, 1);
        expect(ride.energyWh).toBe(5);
        expect(ride.route).toHaveLength(100);
        expect(ride.route[0]).toEqual([2.17, expect.closeTo(41.38, 3)]);
    });

    test('without the bike, the distance comes from GPS, leaving out the drift while standing', () => {
        const withoutBike = rideFile()
            .split('\n')
            .filter((line) => !line.includes('"frame"'))
            .join('\n');
        const reader = createRideReader(RIDE_ID);
        reader.push(withoutBike);
        const ride = reader.summary();
        expect(ride.distanceFrom).toBe('gps');
        // 59 and 19 steps of 5 m, and the step from standing back to riding.
        expect(ride.distanceKm).toBeGreaterThan(0.39);
        expect(ride.distanceKm).toBeLessThan(0.4);
        expect(ride.movingMs).toBe(78_000);
        expect(ride.energyWh).toBeNull();
    });

    test('a file read in pieces, and a line cut mid-write, give the same ride', () => {
        const text = rideFile();
        const whole = createRideReader(RIDE_ID);
        whole.push(text);
        const pieces = createRideReader(RIDE_ID);
        const lines = text.split('\n');
        pieces.push(`${lines.slice(0, 50).join('\n')}\n`);
        pieces.push('{"t": 1, "type": "fix", "la');
        pieces.push(lines.slice(50).join('\n'));
        expect(pieces.summary()).toEqual(whole.summary());
    });

    test('a ride still recording, and paused by the rider, says so', () => {
        const reader = createRideReader(RIDE_ID);
        reader.push(
            [
                { t: RIDE_ID, type: 'start' },
                { t: RIDE_ID + 5000, type: 'pause' },
            ]
                .map((line) => JSON.stringify(line))
                .join('\n')
        );
        expect(reader.summary()).toMatchObject({ ended: false, paused: true, distanceFrom: null, averageKmh: null });
    });

    test('a ride auto-ride stopped ends at its last movement: what came after is left out', () => {
        const end = RIDE_ID + 60_000;
        const file = rideFile().replace(/"type":"stop"}\n$/, `"type":"stop","end":${end}}\n`);
        const reader = createRideReader(RIDE_ID);
        reader.push(file);
        const ride = reader.summary();
        expect(ride.endedAt).toBe(end);
        expect(ride.totalMs).toBe(60_000);
        expect(ride.movingMs).toBe(59_000);
        expect(ride.distanceKm).toBeCloseTo(0.3, 5);
        expect(ride.route).toHaveLength(60);
        expect(ride.energyWh).toBeNull();
    });

    test('with no speed for 10 s, the ride counts as stopped', () => {
        const reader = createRideReader(RIDE_ID);
        reader.push(rideFile());
        expect(reader.stoppedAt(RIDE_ID + 130_000 + 9_000)).toBe(false);
        expect(reader.stoppedAt(RIDE_ID + 130_000 + 10_000)).toBe(true);
    });
});
