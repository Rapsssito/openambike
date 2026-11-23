import { AUTO_CONNECT_THRESHOLDS } from '../auto-connect.js';
import { setLanguage, t } from '../i18n/i18n.js';
import { describeActivity } from './activity.js';

const { farDbm: FAR, nearDbm: NEAR } = AUTO_CONNECT_THRESHOLDS;

const LOCK = { autoLock: true, autoUnlock: false, autoRide: false };

// Every text comes from the translation files, through t(): a change of wording changes no test.
describe("auto-connect's activity", () => {
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
        setLanguage('en');
    });

    test('connected and unlocked: the last signal, the movement, and the signal that locks', () => {
        const { now } = describeActivity(
            { running: true, state: 'CONNECTED', connected: true, locked: false, signalNowDbm: -70, movedAgoMs: 2_000 },
            LOCK
        );
        expect(now).toEqual([
            { label: t('activity.signal'), value: '-70 dBm' },
            { label: t('activity.moving'), value: t('activity.movingYes') },
            { label: t('activity.lock'), value: t('activity.unlockedTo', { dbm: String(FAR) }) },
        ]);
    });

    test('leaving, the lock counts down; near and locked, the unlock counts down with auto-unlock', () => {
        const leaving = describeActivity(
            { running: true, state: 'CONNECTED', connected: true, locked: false, movedAgoMs: 60_000, leaveInMs: 1_200 },
            LOCK
        );
        expect(leaving.now[1].value).toBe(t('activity.movingNo'));
        expect(leaving.now[2].value).toBe(t('activity.lockingIn', { time: '2 s' }));
        /** @type {import('../auto-connect.js').Activity} */
        const near = { running: true, state: 'NEAR', locked: true, heardDbm: -66, heardAgoMs: 400, connectInMs: 3_100 };
        const unlocking = describeActivity(near, { ...LOCK, autoUnlock: true });
        expect(unlocking.now.map((line) => line.value)).toEqual([
            '-66 dBm',
            t('activity.unknown'),
            t('activity.unlockingIn', { time: '4 s' }),
        ]);
        expect(describeActivity(near, LOCK).now[2].value).toBe(t('activity.locked'));
        const held = describeActivity({ ...near, lockHeld: true }, { ...LOCK, autoUnlock: true });
        expect(held.now[2].value).toBe(t('activity.lockedByYou'));
        const far = describeActivity(
            { ...near, connectInMs: undefined, heardAgoMs: 20_000 },
            { ...LOCK, autoUnlock: true }
        );
        expect(far.now[0].value).toBe(t('activity.signalOut'));
        expect(far.now[2].value).toBe(t('activity.lockedTo', { dbm: String(NEAR) }));
    });

    test('the ride: inactive, starting, active, and stopping', () => {
        const ride = { autoLock: false, autoUnlock: false, autoRide: true };
        /** @param {import('../auto-connect.js').Activity['ride']} state */
        const line = (state) =>
            describeActivity({ running: true, state: 'CONNECTED', connected: true, ride: state }, ride).now[2].value;
        expect(line({ active: false })).toBe(t('activity.rideInactive'));
        expect(line({ active: false, startInMs: 11_000 })).toBe(t('activity.rideStartingIn', { time: '11 s' }));
        expect(line({ active: true, auto: false })).toBe(t('activity.rideActive'));
        expect(line({ active: true, auto: true, stopInMs: 14 * 60_000 + 54_000 })).toBe(
            t('activity.rideStoppingIn', { time: '14:54' })
        );
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

    test('a dropped connection: the signal says how long it still waits for it to come back', () => {
        const { now } = describeActivity(
            { running: true, state: 'NEAR', connected: false, heardDbm: -70, heardAgoMs: 1_000, dropLeftMs: 42_000 },
            LOCK
        );
        expect(now[0]).toEqual({ label: t('activity.signal'), value: t('activity.signalDropped', { time: '42 s' }) });
    });

    test('the history says what became of a dropped connection', () => {
        const at = new Date(2026, 10, 22, 17, 31, 5).getTime();
        const events = ['LINK_LOST', 'RECONNECTED', 'LINK_GONE', 'LINK_LOST_UNLOCKED'];
        const { history } = describeActivity(
            { running: true, state: 'IDLE', history: events.map((event) => ({ at, event, value: 60 })) },
            LOCK,
            'en-GB'
        );
        expect(history.map((entry) => entry.text)).toEqual([
            t('activity.LINK_LOST', { value: '60' }),
            t('activity.RECONNECTED'),
            t('activity.LINK_GONE'),
            t('activity.LINK_LOST_UNLOCKED'),
        ]);
    });

    test('off, it says so', () => {
        expect(describeActivity({ running: false }, LOCK)).toEqual({
            now: [{ label: t('activity.state'), value: t('activity.stateOff') }],
            history: [],
        });
    });
});
