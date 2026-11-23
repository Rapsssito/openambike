import { setLanguage, t } from '../i18n/i18n.js';
import { describeActivity, RECENT_EVENTS } from './activity.js';

// Every text comes from the translation files, through t(): a change of wording changes no test.
describe("auto-connect's history", () => {
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
        setLanguage('en');
    });

    test('the signal: of the connection while connected, of the advertising otherwise, or out of range', () => {
        expect(describeActivity({ running: true, connected: true, signalNowDbm: -70 }).signal).toBe('-70 dBm');
        expect(describeActivity({ running: true, connected: true }).signal).toBe(t('activity.signalMeasuring'));
        expect(describeActivity({ running: true, heardDbm: -66, heardAgoMs: 400 }).signal).toBe('-66 dBm');
        expect(describeActivity({ running: true, heardDbm: -66, heardAgoMs: 20_000 }).signal).toBe(
            t('activity.signalOut')
        );
        expect(describeActivity({ running: true }).signal).toBe(t('activity.signalOut'));
    });

    test('a dropped connection: the signal says how long it still waits for it to come back', () => {
        const { signal } = describeActivity({ running: true, heardDbm: -70, heardAgoMs: 1_000, dropLeftMs: 22_000 });
        expect(signal).toBe(t('activity.signalDropped', { time: '22 s' }));
    });

    test('the history says each event with its time and value, newest first', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const { history } = describeActivity(
            {
                running: true,
                history: [
                    { at, event: 'LOCKING_AWAY', value: -84 },
                    { at: at - 7_000, event: 'WAITING_MOVED', value: 4 },
                ],
            },
            'en-GB'
        );
        expect(history).toEqual([
            { time: '17:31:05', text: t('activity.LOCKING_AWAY', { value: '-84' }) },
            { time: '17:30:58', text: t('activity.WAITING_MOVED', { value: '4' }) },
        ]);
    });

    test('only the newest events are shown at first; all of them on asking', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const events = Array.from({ length: 30 }, (_, i) => ({ at: at - i * 1_000, event: 'RECONNECTED', value: 0 }));
        const { recent, history } = describeActivity({ running: true, history: events }, 'en-GB');
        expect(RECENT_EVENTS).toBe(5);
        expect(history).toHaveLength(30);
        expect(recent).toEqual(history.slice(0, RECENT_EVENTS));
        expect(recent[0].time).toBe('17:31:05');
    });

    test('the history says what became of a dropped connection', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const events = [
            'LINK_LOST',
            'RECONNECTED',
            'LINK_GONE',
            'LINK_LOST_UNLOCKED',
            'LINK_LEFT',
            'LINK_LEFT_UNLOCKED',
        ];
        const { history } = describeActivity(
            { running: true, history: events.map((event) => ({ at, event, value: 30 })) },
            'en-GB'
        );
        expect(history.map((entry) => entry.text)).toEqual([
            t('activity.LINK_LOST', { value: '30' }),
            t('activity.RECONNECTED'),
            t('activity.LINK_GONE'),
            t('activity.LINK_LOST_UNLOCKED'),
            t('activity.LINK_LEFT'),
            t('activity.LINK_LEFT_UNLOCKED'),
        ]);
        expect(new Set(history.map((entry) => entry.text)).size).toBe(events.length);
    });

    test('off, it says so, with no history', () => {
        expect(describeActivity({ running: false })).toEqual({
            signal: t('activity.stateOff'),
            recent: [],
            history: [],
        });
    });
});
