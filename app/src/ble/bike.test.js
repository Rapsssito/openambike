import { jest } from '@jest/globals';

import { fakeClient, view } from '../test-support/fake-client.js';
import { ASSIST_CONFIRM, AuthenticationError, Bike, bikeById, chooseBike, scanForBikes } from './bike.js';
import { CHARACTERISTIC, SERVICE } from './protocol.js';

const KEY = 'A'.repeat(28);
const DEVICE = 'device-1';

describe('choosing and connecting', () => {
    test('the chooser filters on the name and asks for the three services', async () => {
        const { client } = fakeClient();
        const bike = await chooseBike(client, { native: false });
        expect(client.requestDevice).toHaveBeenCalledWith({
            namePrefix: 'AMPLER',
            optionalServices: [SERVICE.auth, SERVICE.bike, SERVICE.owner],
        });
        expect(bike.deviceId).toBe(DEVICE);
    });

    test("on Android, the app's own scan filters on the name and reports each bike", async () => {
        const fake = fakeClient();
        const found = jest.fn();
        const stop = await scanForBikes(fake.client, found);
        expect(fake.client.requestLEScan).toHaveBeenCalledWith(
            { namePrefix: 'AMPLER', scanMode: 1 },
            expect.any(Function)
        );
        expect(found).toHaveBeenCalledWith({ deviceId: DEVICE, name: 'AMPLER3', rssi: -60 });
        await stop();
        expect(fake.client.stopLEScan).toHaveBeenCalled();
    });

    test('a bike found before is reached by its identifier, with no scan', async () => {
        const fake = fakeClient();
        const bike = await bikeById(fake.client, DEVICE);
        await bike.connect();
        expect(fake.client.requestLEScan).not.toHaveBeenCalled();
        expect(fake.client.connect).toHaveBeenCalledWith(DEVICE, expect.any(Function));
    });

    test('on Android, a bike with no bond is bonded before connecting', async () => {
        const { client } = fakeClient({ bonded: false });
        await new Bike(client, DEVICE, { native: true }).connect();
        expect(client.createBond).toHaveBeenCalledWith(DEVICE);
        expect(client.connect).toHaveBeenCalled();
    });

    test('in a browser, bonding is left to the browser', async () => {
        const { client } = fakeClient({ bonded: false });
        await new Bike(client, DEVICE, { native: false }).connect();
        expect(client.isBonded).not.toHaveBeenCalled();
        expect(client.createBond).not.toHaveBeenCalled();
    });

    test('disconnection reaches every listener', async () => {
        const { client } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        const listener = jest.fn();
        bike.onDisconnect(listener);
        await bike.connect();
        const onDisconnect = client.connect.mock.calls[0][1];
        if (!onDisconnect) throw new Error('connect was called without a disconnect callback');
        onDisconnect(DEVICE);
        expect(listener).toHaveBeenCalledWith(DEVICE);
    });
});

describe('authentication', () => {
    test('notifications on auth are enabled before the key is written, and "owner ok" accepts it', async () => {
        const { client, writes } = fakeClient();
        await new Bike(client, DEVICE, { native: false }).authenticate(KEY);
        expect(client.startNotifications.mock.invocationCallOrder[0]).toBeLessThan(
            client.write.mock.invocationCallOrder[0]
        );
        expect(writes).toEqual([{ uuid: CHARACTERISTIC.auth.uuid, bytes: Array(28).fill('41').join(' ') }]);
        expect(client.stopNotifications).toHaveBeenCalled();
    });

    test('any other answer is a refusal', async () => {
        const { client } = fakeClient({ authReply: 'no' });
        await expect(new Bike(client, DEVICE, { native: false }).authenticate(KEY)).rejects.toThrow(
            AuthenticationError
        );
    });

    test('no answer is a failure after the timeout', async () => {
        jest.useFakeTimers();
        try {
            const { client } = fakeClient({ authReply: null });
            const failure = new Bike(client, DEVICE, { native: false }).authenticate(KEY).catch((error) => error);
            await jest.advanceTimersByTimeAsync(5000);
            expect(await failure).toBeInstanceOf(AuthenticationError);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a key of the wrong form is refused before anything is sent', async () => {
        const { client } = fakeClient();
        await expect(new Bike(client, DEVICE, { native: false }).authenticate('short')).rejects.toThrow(RangeError);
        expect(client.write).not.toHaveBeenCalled();
    });
});

describe('commands', () => {
    test('each command writes the documented bytes to its characteristic', async () => {
        const { client, writes } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        await bike.setAssistMode(2);
        await bike.setLights(true);
        await bike.setLocked(true);
        await bike.setGnss(false);
        await bike.setGsm(false);
        await bike.setAssistLevels({ speedKmh: 25, amountPercent: 50 }, { speedKmh: 25, amountPercent: 70 });
        await bike.restart();
        await bike.sleep();
        await bike.calibrateTorqueSensor();
        expect(writes).toEqual([
            { uuid: CHARACTERISTIC.assistMode.uuid, bytes: '02' },
            { uuid: CHARACTERISTIC.lights.uuid, bytes: '01 01' },
            { uuid: CHARACTERISTIC.lock.uuid, bytes: '01' },
            { uuid: CHARACTERISTIC.gnssEnabled.uuid, bytes: '00' },
            { uuid: CHARACTERISTIC.gsmEnabled.uuid, bytes: '00' },
            { uuid: CHARACTERISTIC.assistLevels.uuid, bytes: 'ff 2b 2a ff 80 7f' },
            { uuid: CHARACTERISTIC.reset.uuid, bytes: '72 65 73 65 74' },
            { uuid: CHARACTERISTIC.stateManagement.uuid, bytes: '73 68 75 74 64 6f 77 6e' },
            { uuid: CHARACTERISTIC.motorCalibration.uuid, bytes: '00' },
        ]);
    });

    test('commands sent together reach the bike one at a time, in order', async () => {
        const { client, writes, maxInFlight } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        await Promise.all([bike.setLights(true), bike.setAssistMode(1), bike.setLocked(false)]);
        expect(maxInFlight()).toBe(1);
        expect(writes.map((w) => w.bytes)).toEqual(['01 01', '01', '00']);
    });

    test('a failed command does not stop the ones after it', async () => {
        const { client, writes } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        client.write.mockRejectedValueOnce(new Error('GATT error'));
        const first = bike.setLights(true);
        const second = bike.setAssistMode(1);
        await expect(first).rejects.toThrow('GATT error');
        await second;
        expect(writes).toEqual([{ uuid: CHARACTERISTIC.assistMode.uuid, bytes: '01' }]);
    });

    test('both assist modes are written at once, and read back until the bike returns them', async () => {
        const { client, writes } = fakeClient({
            reads: { [CHARACTERISTIC.assistLevels.uuid]: [0xff, 0x2b, 0x2a, 0xff, 0x95, 0x95, 0, 0] },
        });
        const bike = new Bike(client, DEVICE, { native: false });
        const levels = await bike.changeAssistLevels(
            { speedKmh: 17, amountPercent: 70 },
            { speedKmh: 25, amountPercent: 75 }
        );
        expect(writes).toEqual([{ uuid: CHARACTERISTIC.assistLevels.uuid, bytes: '77 80 7f ff 95 95' }]);
        expect(levels.mode1).toEqual({ speedKmh: 17, powerPercent: 70, gainPercent: 70 });
    });

    test('a bike that keeps its assist levels is read for about a second, and its own levels are returned', async () => {
        jest.useFakeTimers();
        try {
            const { client } = fakeClient({
                reads: { [CHARACTERISTIC.assistLevels.uuid]: [0xff, 0x2b, 0x2a, 0xff, 0x95, 0x95, 0, 0] },
                ignored: [CHARACTERISTIC.assistLevels.uuid],
            });
            const bike = new Bike(client, DEVICE, { native: false });
            const pending = bike.changeAssistLevels(
                { speedKmh: 17, amountPercent: 70 },
                { speedKmh: 25, amountPercent: 75 }
            );
            await jest.advanceTimersByTimeAsync(ASSIST_CONFIRM.reads * ASSIST_CONFIRM.everyMs);
            const levels = await pending;
            expect(levels.mode1.speedKmh).toBe(25);
            const reads = client.read.mock.calls.filter(([, , uuid]) => uuid === CHARACTERISTIC.assistLevels.uuid);
            expect(reads).toHaveLength(1 + ASSIST_CONFIRM.reads);
        } finally {
            jest.useRealTimers();
        }
    });

    test("assist levels beyond the bike's maxima are refused before anything is sent", () => {
        const { client } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        expect(() =>
            bike.setAssistLevels({ speedKmh: 26, amountPercent: 50 }, { speedKmh: 25, amountPercent: 70 })
        ).toThrow(RangeError);
        expect(client.write).not.toHaveBeenCalled();
    });
});

describe('values', () => {
    test('official-317: values read are decoded', async () => {
        const { client } = fakeClient({
            reads: {
                [CHARACTERISTIC.assistLevels.uuid]: [0xff, 0x2b, 0x2a, 0xff, 0x95, 0x95, 0x00, 0x00],
                [CHARACTERISTIC.lights.uuid]: [0x0a, 0x01],
                [CHARACTERISTIC.battery.uuid]: [0xfa, 0xc7, 0x00, 0x00, 0x3a, 0x00, 0x4a, 0x64, 0x77, 0x03, 0x00],
            },
        });
        const bike = new Bike(client, DEVICE, { native: false });
        expect((await bike.readAssistLevels()).mode2.powerPercent).toBe(75);
        expect(await bike.readLights()).toBe(true);
        expect((await bike.readBattery()).percent).toBe(74);
    });

    test('notifications are decoded by the caller until it unsubscribes', async () => {
        const { client, listeners } = fakeClient();
        const bike = new Bike(client, DEVICE, { native: false });
        const received = jest.fn();
        const unsubscribe = await bike.subscribe(CHARACTERISTIC.battery, received);
        listeners.get(CHARACTERISTIC.battery.uuid)?.(view([1, 2]));
        expect(received).toHaveBeenCalledWith(Uint8Array.of(1, 2));
        await unsubscribe();
        expect(listeners.has(CHARACTERISTIC.battery.uuid)).toBe(false);
    });

    test('the IoT state is requested with 00 and collected until EOM', async () => {
        const { client, writes } = fakeClient();
        const state = await new Bike(client, DEVICE, { native: false }).readIotState();
        expect(writes).toEqual([{ uuid: CHARACTERISTIC.iotState.uuid, bytes: '00' }]);
        expect(state).toEqual({ settings: { assist_mode: 1 } });
    });
});
