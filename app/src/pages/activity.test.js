import { setLanguage, t } from '../i18n/i18n.js';
import { describeActivity } from './activity.js';

const LOCK = { autoLock: true, autoUnlock: false, autoRide: false };

// Every text comes from the translation files, through t(): a change of wording changes no test.
describe("auto-connect's activity", () => {
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
        setLanguage('en');
    });

    test('with the app open and the bike connected, the timers show what auto-lock would do', () => {
        const { now } = describeActivity(
            {
                running: true,
                state: 'APP',
                connected: true,
                locked: false,
                signalDbm: -84,
                signalNowDbm: -86,
                signalSettled: true,
                movedAgoMs: 12_400,
                guardLeftMs: 17_600,
                parkedLeftMs: 14 * 60_000 + 52_000,
            },
            LOCK
        );
        expect(now.map((line) => line.value)).toEqual([
            t('activity.stateApp'),
            t('activity.signalValue', { now: '-86', median: '-84' }),
            t('activity.movedWaiting', { ago: '12', left: '18' }),
            t('activity.parkedLeft', { time: '14:52' }),
            t('activity.unlocked'),
        ]);
    });

    test('a connection just made, with no movement, can lock at once; the signal shows once measured', () => {
        const { now } = describeActivity(
            {
                running: true,
                state: 'CONNECTED',
                connected: true,
                signalDbm: -70,
                signalNowDbm: -70,
                signalSettled: false,
                guardLeftMs: 0,
            },
            LOCK
        );
        expect(now[1].value).toBe(t('activity.signalNow', { now: '-70' }));
        expect(now[2].value).toBe(t('activity.neverMoved'));
        expect(now[4].value).toBe(t('activity.lockUnknown'));
    });

    test('near the bike, it gives the signal; with auto-lock off, no movement line', () => {
        const near = describeActivity({ running: true, state: 'NEAR', nearDbm: -66, nearForMs: 4_200 }, LOCK);
        expect(near.now).toEqual([{ label: t('activity.state'), value: t('activity.stateNear', { dbm: '-66' }) }]);
        const ride = describeActivity(
            {
                running: true,
                state: 'CONNECTED',
                connected: true,
                signalDbm: -60,
                signalNowDbm: -60,
                signalSettled: true,
            },
            { autoLock: false, autoUnlock: false, autoRide: true }
        );
        expect(ride.now.map((line) => line.label)).toEqual([
            t('activity.state'),
            t('activity.signal'),
            t('activity.parked'),
            t('activity.lock'),
        ]);
        expect(ride.now[1].value).toBe(t('activity.signalValue', { now: '-60', median: '-60' }));
    });

    test('the history says each event with its time and value', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const { history } = describeActivity(
            {
                running: true,
                state: 'IDLE',
                history: [
                    { at, event: 'LOCKING_AWAY', value: -84 },
                    { at: at - 7_000, event: 'WAITING_MOVED', value: 4 },
                ],
            },
            LOCK,
            'en-GB'
        );
        expect(history).toEqual([
            { time: '17:31:05', text: t('activity.LOCKING_AWAY', { value: '-84' }) },
            { time: '17:30:58', text: t('activity.WAITING_MOVED', { value: '4' }) },
        ]);
    });

    test('off, it says so', () => {
        expect(describeActivity({ running: false }, LOCK)).toEqual({
            now: [{ label: t('activity.state'), value: t('activity.stateOff') }],
            history: [],
        });
    });
});
