import { jest } from '@jest/globals';

import { Bike } from './ble/bike.js';
import { CHARACTERISTIC } from './ble/protocol.js';
import { createSession, TEMPERATURE_INTERVAL_MS } from './session.js';
import { DEVICE, fakeClient } from './test-support/fake-client.js';

/** Values the bike of the official-317 capture returns, standing. */
const READS = {
    [CHARACTERISTIC.battery.uuid]: [0xfa, 0xc7, 0x00, 0x00, 0x3a, 0x00, 0x4a, 0x64, 0x77, 0x03, 0x00],
    [CHARACTERISTIC.batteryExtended.uuid]: [0x51, 0x00, 0xe1, 0x00, 0xe9, 0x00, 0xff, 0xff, 0x00, 0x00, 0x8f, 0x00],
    [CHARACTERISTIC.asiMetrics.uuid]: [0x4f, 0xc2, 0x05, 0x00, 0, 0, 0, 0, 0, 0, 0, 0],
    [CHARACTERISTIC.range.uuid]: [64],
    [CHARACTERISTIC.assistMode.uuid]: [1, 0, 0, 0],
    [CHARACTERISTIC.assistLevels.uuid]: [0xff, 0x2b, 0x2a, 0xff, 0x95, 0x95, 0x00, 0x00],
    [CHARACTERISTIC.lights.uuid]: [0x0a, 0x00],
    [CHARACTERISTIC.lock.uuid]: [0],
    [CHARACTERISTIC.gnssEnabled.uuid]: [1],
    [CHARACTERISTIC.gsmEnabled.uuid]: [1],
    [CHARACTERISTIC.firmwareVersion.uuid]: [...new TextEncoder().encode('v3.9.0 1e774d1c f551786850'), 0],
    [CHARACTERISTIC.batteryFirmwareStatus.uuid]: [...new TextEncoder().encode('Up to date')],
};

async function startedSession() {
    const fake = fakeClient({ reads: READS });
    const session = createSession(new Bike(fake.client, DEVICE, { native: false }));
    await session.start();
    return { fake, session };
}

describe('session', () => {
    test('official-317: every value is read at the start', async () => {
        const { session } = await startedSession();
        expect(session.state).toMatchObject({
            battery: { percent: 74, milliamps: 58 },
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

    test('changing one mode writes 6 bytes that keep the other mode, and shows the levels read back', async () => {
        const { fake, session } = await startedSession();
        await session.changeAssistMode(2, { speedKmh: 25, amountPercent: 60 });
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

    test('stopping ends every notification', async () => {
        const { fake, session } = await startedSession();
        expect(fake.listeners.size).toBeGreaterThan(0);
        await session.stop();
        expect(fake.listeners.size).toBe(0);
    });
});
