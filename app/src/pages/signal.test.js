import { SIGNAL_WINDOW_MS, signalStats } from './signal.js';

describe('signal test', () => {
    test('the average and the number of readings are taken over the last 5 seconds, the latest reading over all', () => {
        const now = 100000;
        const readings = [
            { at: now - SIGNAL_WINDOW_MS - 1, rssi: -90 },
            { at: now - 3000, rssi: -60 },
            { at: now - 1000, rssi: -66 },
        ];
        expect(signalStats(readings, now)).toEqual({ latest: -66, average: -63, count: 2 });
    });

    test('with no reading in the last 5 seconds, there is no average, but the latest reading stays', () => {
        expect(signalStats([{ at: 0, rssi: -70 }], SIGNAL_WINDOW_MS + 1)).toEqual({
            latest: -70,
            average: null,
            count: 0,
        });
        expect(signalStats([], 0)).toEqual({ latest: null, average: null, count: 0 });
    });
});
