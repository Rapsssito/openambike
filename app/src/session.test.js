import { jest } from '@jest/globals';

import { Bike } from './ble/bike.js';
import { CHARACTERISTIC } from './ble/protocol.js';
import { createSession, InterruptedError, isCharging, NotConfirmedError, TEMPERATURE_INTERVAL_MS } from './session.js';
import { DEVICE, fakeClient, OFFICIAL_317_READS } from './test-support/fake-client.js';

/** @param {{ ignored?: string[], confirmTimeoutMs?: number }} [options] */
async function startedSession({ ignored = [], confirmTimeoutMs } = {}) {
    const fake = fakeClient({ reads: OFFICIAL_317_READS, ignored });
    const session = createSession(new Bike(fake.client, DEVICE, { native: false }), { confirmTimeoutMs });
    await session.start();
    return { fake, session };
}

describe('session', () => {
    test('official-317: every value is read at the start', async () => {
        const { session } = await startedSession();
        expect(session.state).toMatchObject({
            connected: true,
            battery: { percent: 74, milliamps: 58 },
            batteryCycles: 81,
            packTemperaturesC: [22.5, 23.3],
            metrics: { odometerKm: 3774.23 },
            range: 64,
            assistMode: 1,
            assistLevels: { mode1: { speedKmh: 25, powerPercent: 50 }, mode2: { speedKmh: 25, powerPercent: 75 } },
            lights: false,
            locked: false,
            gnss: true,
            gsm: true,
            firmware: { version: 'v3.9.0' },
            batteryFirmwareStatus: 'Up to date',
            iotState: { settings: { assist_mode: 1 } },
        });
        await session.stop();
    });

    test('notifications keep the values live and reach the listeners', async () => {
        const { fake, session } = await startedSession();
        const listener = jest.fn();
        session.onChange(listener);
        fake.notify(CHARACTERISTIC.battery.uuid, [0xd2, 0xc5, 0x00, 0x00, 0x93, 0x03, 0x48, 0x65, 0x67, 0x03, 0x00]);
        expect(session.state.battery?.milliamps).toBe(915);
        expect(listener).toHaveBeenCalledWith(session.state);
        await session.stop();
    });

    test('a command changes the state when the bike notifies the new value', async () => {
        const { session } = await startedSession();
        await session.setLights(true);
        expect(session.state.lights).toBe(true);
        await session.setAssistMode(2);
        expect(session.state.assistMode).toBe(2);
        await session.setLocked(true);
        expect(session.state.locked).toBe(true);
        await session.setGnss(false);
        expect(session.state.gnss).toBe(false);
        await session.stop();
    });

    test('a command does not change the state before the bike notifies the new value', async () => {
        const { fake, session } = await startedSession();
        /** @type {(boolean | null)[]} */
        const seen = [];
        session.onChange((state) => seen.push(state.lights));
        const command = session.setLights(true);
        expect(session.state.lights).toBe(false);
        await command;
        expect(fake.writes.at(-1)).toEqual({ uuid: CHARACTERISTIC.lights.uuid, bytes: '01 01' });
        expect(seen).toEqual([true]);
        await session.stop();
    });

    test('a command fails if the bike takes the write but does not notify the value, and the state stays', async () => {
        const { session } = await startedSession({ ignored: [CHARACTERISTIC.lights.uuid], confirmTimeoutMs: 20 });
        await expect(session.setLights(true)).rejects.toBeInstanceOf(NotConfirmedError);
        expect(session.state.lights).toBe(false);
        await session.stop();
    });

    test('another value notified meanwhile does not confirm a command', async () => {
        const { fake, session } = await startedSession({ ignored: [CHARACTERISTIC.lock.uuid], confirmTimeoutMs: 20 });
        const command = session.setLocked(true);
        fake.notify(CHARACTERISTIC.battery.uuid, [0xfa, 0xc7, 0x00, 0x00, 0x3a, 0x00, 0x4a, 0x64, 0x77, 0x03, 0x00]);
        fake.notify(CHARACTERISTIC.lock.uuid, [0]);
        await expect(command).rejects.toBeInstanceOf(NotConfirmedError);
        expect(session.state.locked).toBe(false);
        await session.stop();
    });

    test('a command waiting for the bike fails when the link drops, and none is sent while it is down', async () => {
        const { fake, session } = await startedSession({ ignored: [CHARACTERISTIC.gsmEnabled.uuid] });
        const command = session.setGsm(false);
        await Promise.resolve();
        await session.pause();
        await expect(command).rejects.toBeInstanceOf(InterruptedError);
        const writes = fake.writes.length;
        await expect(session.setGsm(false)).rejects.toBeInstanceOf(InterruptedError);
        expect(fake.writes).toHaveLength(writes);
    });

    test('both modes are written in one write of 6 bytes, and the levels read back are shown', async () => {
        const { fake, session } = await startedSession();
        await session.changeAssistLevels({ speedKmh: 25, amountPercent: 50 }, { speedKmh: 25, amountPercent: 60 });
        expect(fake.writes.at(-1)).toEqual({ uuid: CHARACTERISTIC.assistLevels.uuid, bytes: 'ff 2b 2a ff 55 55' });
        expect(session.state.assistLevels?.mode2).toEqual({ speedKmh: 25, powerPercent: 60, gainPercent: 60 });
        expect(session.state.assistLevels?.mode1.powerPercent).toBe(50);
        await session.stop();
    });

    test('pack temperatures are read again every 10 seconds until the session stops', async () => {
        jest.useFakeTimers();
        try {
            const { fake, session } = await startedSession();
            const reads = () =>
                fake.client.read.mock.calls.filter((call) => call[2] === CHARACTERISTIC.batteryExtended.uuid).length;
            expect(reads()).toBe(1);
            await jest.advanceTimersByTimeAsync(TEMPERATURE_INTERVAL_MS);
            expect(reads()).toBe(2);
            await session.stop();
            await jest.advanceTimersByTimeAsync(TEMPERATURE_INTERVAL_MS * 3);
            expect(reads()).toBe(2);
        } finally {
            jest.useRealTimers();
        }
    });

    test('pausing keeps the values and the listeners, and starting again reads everything anew', async () => {
        const { fake, session } = await startedSession();
        const listener = jest.fn();
        session.onChange(listener);
        await session.pause();
        expect(session.state).toMatchObject({ connected: false, range: 64 });
        expect(fake.listeners.size).toBe(0);
        await session.start();
        expect(session.state.connected).toBe(true);
        expect(fake.listeners.size).toBeGreaterThan(0);
        expect(listener).toHaveBeenLastCalledWith(session.state);
        await session.stop();
    });

    test('the battery charges while its current is negative', () => {
        const battery = { volts: 52, milliamps: -2891, percent: 74, absoluteSoc: null };
        expect(isCharging(battery)).toBe(true);
        expect(isCharging({ ...battery, milliamps: 58 })).toBe(false);
        expect(isCharging(null)).toBe(false);
    });

    test('stopping ends every notification', async () => {
        const { fake, session } = await startedSession();
        expect(fake.listeners.size).toBeGreaterThan(0);
        await session.stop();
        expect(fake.listeners.size).toBe(0);
    });
});
