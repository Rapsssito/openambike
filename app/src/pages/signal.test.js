import { SIGNAL_WINDOW_MS, signalStats } from './signal.js';

describe('signal test', () => {
    test('the median and the number of readings are taken over the last 5 seconds, the latest reading over all', () => {
        const now = 100000;
        const readings = [
            { at: now - SIGNAL_WINDOW_MS - 1, rssi: -90 },
            { at: now - 3000, rssi: -60 },
            { at: now - 2000, rssi: -95 },
            { at: now - 1000, rssi: -66 },
        ];
        // One deep dip does not move the median, as it would the mean (-74).
        expect(signalStats(readings, now)).toEqual({ latest: -66, median: -66, count: 3 });
    });

    test('with no reading in the last 5 seconds, there is no median, but the latest reading stays', () => {
        expect(signalStats([{ at: 0, rssi: -70 }], SIGNAL_WINDOW_MS + 1)).toEqual({
            latest: -70,
            median: null,
            count: 0,
        });
        expect(signalStats([], 0)).toEqual({ latest: null, median: null, count: 0 });
    });
});
