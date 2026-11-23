import { jest } from '@jest/globals';

import { createBikeLink, LET_GO } from './bike-link.js';
import { InterruptedError } from './session.js';
import { DEVICE, fakeClient, OFFICIAL_317_READS } from './test-support/fake-client.js';

const KEY = 'A'.repeat(28);

/** @param {{ known?: string | null, key?: string | null, authReply?: string }} [options] */
function link({ known = DEVICE, key = KEY, ...options } = {}) {
    const fake = fakeClient({ reads: OFFICIAL_317_READS, ...options });
    const saveBikeId = jest.fn();
    const onConnected = jest.fn();
    const onRiderConnect = jest.fn(async () => undefined);
    const bikeLink = createBikeLink({
        client: fake.client,
        native: true,
        loadKey: async () => key,
        loadBikeId: () => known,
        saveBikeId,
        onConnected,
        onRiderConnect,
        delays: [10],
    });
    /** @type {string[]} */
    const phases = [];
    bikeLink.onStatus(({ phase }) => {
        if (phases.at(-1) !== phase) phases.push(phase);
    });
    return { fake, bikeLink, saveBikeId, onConnected, onRiderConnect, phases };
}

describe('the link to the bike', () => {
    test('connects to the bike known from before, step by step, and shows its values', async () => {
        const { bikeLink, saveBikeId, onConnected, phases } = link();
        expect(bikeLink.status.phase).toBe('idle');
        await bikeLink.connect();
        expect(phases).toEqual(['connecting', 'connected']);
        expect(bikeLink.view.state.connected).toBe(true);
        expect(bikeLink.view.state.range).toBe(64);
        expect(saveBikeId).toHaveBeenCalledWith(DEVICE);
        expect(onConnected).toHaveBeenCalledWith(expect.anything(), KEY);
        await bikeLink.disconnect();
    });

    test('disconnected, it keeps the last values, and a command fails as interrupted', async () => {
        const { fake, bikeLink } = link();
        await bikeLink.connect();
        await bikeLink.disconnect('why');
        expect(bikeLink.status).toEqual({ phase: 'idle', message: 'why' });
        expect(fake.client.disconnect).toHaveBeenCalled();
        expect(bikeLink.view.state.connected).toBe(false);
        expect(bikeLink.view.state.range).toBe(64);
        await expect(bikeLink.view.setLights(true)).rejects.toBeInstanceOf(InterruptedError);
    });

    test('a refused key says so, and a failure keeps its error', async () => {
        const refused = link({ authReply: 'no' });
        await refused.bikeLink.connect();
        expect(refused.bikeLink.status.phase).toBe('refused');
        expect(refused.onConnected).not.toHaveBeenCalled();

        const failed = link();
        const error = new Error('Connection timeout');
        failed.fake.client.connect.mockRejectedValueOnce(error);
        await failed.bikeLink.connect();
        expect(failed.bikeLink.status).toEqual({ phase: 'failed', step: 0, error });
    });

    test('a dropped link shows as reconnecting until it is back', async () => {
        jest.useFakeTimers();
        try {
            const { fake, bikeLink, phases, onConnected } = link();
            await bikeLink.connect();
            /** @type {(id: string) => void} */
            const drop = fake.client.connect.mock.calls[0][1] ?? (() => undefined);
            drop(DEVICE);
            await jest.advanceTimersByTimeAsync(0);
            expect(bikeLink.status.phase).toBe('reconnecting');
            expect(bikeLink.view.state.range).toBe(64);
            await jest.advanceTimersByTimeAsync(10);
            expect(phases).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
            expect(onConnected).toHaveBeenCalledTimes(1);
            await bikeLink.disconnect();
        } finally {
            jest.useRealTimers();
        }
    });

    test('with no bike known, it searches, and connects to the one chosen', async () => {
        jest.useFakeTimers();
        try {
            const { bikeLink, saveBikeId } = link({ known: null });
            await bikeLink.connect();
            expect(bikeLink.status.phase).toBe('searching');
            const [found] = bikeLink.status.found ?? [];
            expect(found.deviceId).toBe(DEVICE);
            await bikeLink.choose(found);
            expect(bikeLink.status.phase).toBe('connected');
            expect(saveBikeId).toHaveBeenCalledWith(DEVICE);
            await bikeLink.disconnect();
        } finally {
            jest.useRealTimers();
        }
    });

    test('after auto-connect let the bike go, the app waits, and connects when the rider asks', async () => {
        const { fake, bikeLink, onRiderConnect } = link();
        fake.client.connect.mockRejectedValueOnce(new Error(LET_GO));
        await bikeLink.connect();
        expect(bikeLink.status).toEqual({ phase: 'idle', letGo: true });
        expect(onRiderConnect).not.toHaveBeenCalled();
        await bikeLink.connect({ rider: true });
        expect(onRiderConnect).toHaveBeenCalled();
        expect(bikeLink.status.phase).toBe('connected');
        await bikeLink.disconnect();
    });

    test('a dropped link that auto-connect let go says so, and joins it once it connects again', async () => {
        jest.useFakeTimers();
        try {
            const { fake, bikeLink } = link();
            await bikeLink.connect();
            /** @type {(id: string) => void} */
            const drop = fake.client.connect.mock.calls[0][1] ?? (() => undefined);
            fake.client.connect.mockRejectedValueOnce(new Error(LET_GO));
            drop(DEVICE);
            await jest.advanceTimersByTimeAsync(10);
            expect(bikeLink.status).toEqual({ phase: 'idle', letGo: true });
            expect(bikeLink.view.state.range).toBe(64);
            await jest.advanceTimersByTimeAsync(10);
            expect(bikeLink.status.phase).toBe('connected');
            await bikeLink.disconnect();
        } finally {
            jest.useRealTimers();
        }
    });

    test('"Disconnect" during a connection drops it', async () => {
        const { bikeLink } = link();
        const connecting = bikeLink.connect();
        await bikeLink.disconnect();
        await connecting;
        expect(bikeLink.status.phase).toBe('idle');
        expect(bikeLink.view.state.connected).toBe(false);
    });
});
