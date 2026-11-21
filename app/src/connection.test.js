import { jest } from '@jest/globals';

import { AuthenticationError, Bike } from './ble/bike.js';
import { keepConnected } from './connection.js';
import { createSession } from './session.js';
import { DEVICE, fakeClient, OFFICIAL_317_READS } from './test-support/fake-client.js';

const KEY = 'A'.repeat(28);

async function connected(options = {}) {
    const fake = fakeClient({ reads: OFFICIAL_317_READS, ...options });
    const bike = new Bike(fake.client, DEVICE, { native: false });
    await bike.connect();
    await bike.authenticate(KEY);
    const session = createSession(bike);
    await session.start();
    /** @type {(id: string) => void} */
    const drop = fake.client.connect.mock.calls[0][1] ?? (() => undefined);
    return { fake, bike, session, drop };
}

describe('keeping connected', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('a dropped link pauses the session, then reconnects, checks the key and starts it again', async () => {
        const { fake, bike, session, drop } = await connected();
        const onGiveUp = jest.fn();
        keepConnected({ bike, session, key: KEY, onGiveUp, delays: [10] });
        drop(DEVICE);
        await jest.advanceTimersByTimeAsync(0);
        expect(session.state.connected).toBe(false);
        expect(session.state.range).toBe(64);
        await jest.advanceTimersByTimeAsync(10);
        expect(fake.client.connect).toHaveBeenCalledTimes(2);
        expect(session.state.connected).toBe(true);
        expect(onGiveUp).not.toHaveBeenCalled();
        await session.stop();
    });

    test('a failed attempt is retried after the next delay', async () => {
        const { fake, bike, session, drop } = await connected();
        keepConnected({ bike, session, key: KEY, onGiveUp: jest.fn(), delays: [10, 20] });
        fake.client.connect.mockRejectedValueOnce(new Error('Connection timeout'));
        drop(DEVICE);
        await jest.advanceTimersByTimeAsync(10);
        expect(session.state.connected).toBe(false);
        await jest.advanceTimersByTimeAsync(20);
        expect(fake.client.connect).toHaveBeenCalledTimes(3);
        expect(session.state.connected).toBe(true);
        await session.stop();
    });

    test('a refused key ends the reconnecting', async () => {
        const { bike, session, drop } = await connected();
        const onGiveUp = jest.fn();
        keepConnected({ bike, session, key: KEY, onGiveUp, delays: [10] });
        jest.spyOn(bike, 'authenticate').mockRejectedValueOnce(new AuthenticationError('refused'));
        drop(DEVICE);
        await jest.advanceTimersByTimeAsync(10);
        expect(onGiveUp).toHaveBeenCalledTimes(1);
        await session.stop();
    });

    test('once stopped, a disconnection is left alone', async () => {
        const { fake, bike, session, drop } = await connected();
        keepConnected({ bike, session, key: KEY, onGiveUp: jest.fn(), delays: [10] }).stop();
        drop(DEVICE);
        await jest.advanceTimersByTimeAsync(100);
        expect(fake.client.connect).toHaveBeenCalledTimes(1);
        await session.stop();
    });
});
