import { setLanguage, t } from '../i18n/i18n.js';
import { describeEvents, RECENT_EVENTS } from './events.js';

// Every text comes from the translation files, through t(): a change of wording changes no test.
describe("auto-connect's events", () => {
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
        setLanguage('en');
    });

    test('each event is said with its time and value, newest first', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const { events: shown } = describeEvents(
            {
                running: true,
                events: [
                    { at, event: 'LOCKING_AWAY', value: -84 },
                    { at: at - 7_000, event: 'WAITING_MOVED', value: -80, extra: 4 },
                ],
            },
            'en-GB'
        );
        expect(shown).toEqual([
            { time: '17:31:05', text: t('events.LOCKING_AWAY', { value: '-84' }) },
            { time: '17:30:58', text: t('events.WAITING_MOVED', { value: '-80', extra: '4' }) },
        ]);
    });

    test('only the newest events are shown at first; all of them on asking', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const events = Array.from({ length: 30 }, (_, i) => ({ at: at - i * 1_000, event: 'RECONNECTED', value: 0 }));
        const { recent, events: shown } = describeEvents({ running: true, events }, 'en-GB');
        expect(RECENT_EVENTS).toBe(5);
        expect(shown).toHaveLength(30);
        expect(recent).toEqual(shown.slice(0, RECENT_EVENTS));
        expect(recent[0].time).toBe('17:31:05');
    });

    test('the events say what became of a dropped connection', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const events = [
            'LINK_LOST',
            'RECONNECTED',
            'LINK_GONE',
            'LINK_LOST_UNLOCKED',
            'LINK_LEFT',
            'LINK_LEFT_UNLOCKED',
        ];
        const { events: shown } = describeEvents(
            { running: true, events: events.map((event) => ({ at, event, value: 30 })) },
            'en-GB'
        );
        expect(shown.map((entry) => entry.text)).toEqual([
            t('events.LINK_LOST', { value: '30' }),
            t('events.RECONNECTED'),
            t('events.LINK_GONE'),
            t('events.LINK_LOST_UNLOCKED'),
            t('events.LINK_LEFT'),
            t('events.LINK_LEFT_UNLOCKED'),
        ]);
        expect(new Set(shown.map((entry) => entry.text)).size).toBe(events.length);
    });

    test('off, there are no events', () => {
        expect(describeEvents({ running: false })).toEqual({
            recent: [],
            events: [],
        });
    });
});
