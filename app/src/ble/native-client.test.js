import { jest } from '@jest/globals';

import { createSession } from '../session.js';
import { DEVICE, fakeClient, OFFICIAL_317_READS } from '../test-support/fake-client.js';
import { Bike } from './bike.js';
import { createNativeClient, fromHex, toHex } from './native-client.js';
import { fakePlugin } from '../test-support/fake-plugin.js';
import { CHARACTERISTIC } from './protocol.js';

describe('native client', () => {
    test('bytes cross the bridge as hexadecimal text', () => {
        const bytes = new DataView(Uint8Array.from([0x00, 0x0a, 0xff]).buffer);
        expect(toHex(bytes)).toBe('000aff');
        expect(Array.from(new Uint8Array(fromHex('00 0a ff').buffer))).toEqual([0x00, 0x0a, 0xff]);
        expect(fromHex('').byteLength).toBe(0);
    });

    test('a bike over the native plugin authenticates and keeps a session live, as over the Bluetooth plugin', async () => {
        const fake = fakeClient({ reads: OFFICIAL_317_READS });
        const plugin = fakePlugin(fake);
        const client = createNativeClient(plugin);
        await client.initialize();
        const bike = new Bike(client, DEVICE, { native: true });
        await bike.connect();
        await bike.authenticate('A'.repeat(28));
        const session = createSession(bike);
        await session.start();
        expect(session.state).toMatchObject({ connected: true, range: 64, lights: false });
        await session.setLights(true);
        expect(session.state.lights).toBe(true);
        expect(fake.writes.at(-1)).toEqual({ uuid: CHARACTERISTIC.lights.uuid, bytes: '01 01' });
        await session.stop();
    });

    test('a notification stops reaching its callback once its notifications are stopped', async () => {
        const fake = fakeClient({ reads: OFFICIAL_317_READS });
        const client = createNativeClient(fakePlugin(fake));
        await client.initialize();
        const callback = jest.fn();
        const { service, uuid } = CHARACTERISTIC.range;
        await client.startNotifications(DEVICE, service, uuid, callback);
        fake.notify(uuid, [42]);
        expect(callback).toHaveBeenCalledTimes(1);
        await client.stopNotifications(DEVICE, service, uuid);
        fake.notify(uuid, [43]);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('the bike disconnecting reaches the callback given to connect', async () => {
        const plugin = fakePlugin(fakeClient());
        const client = createNativeClient(plugin);
        const onDisconnect = jest.fn();
        await client.connect(DEVICE, onDisconnect);
        plugin.emit('disconnected', { deviceId: 'another-device' });
        expect(onDisconnect).not.toHaveBeenCalled();
        plugin.emit('disconnected', { deviceId: DEVICE });
        expect(onDisconnect).toHaveBeenCalledWith(DEVICE);
    });

    test('scan results reach the callback until the scan stops', async () => {
        const plugin = fakePlugin(fakeClient());
        const client = createNativeClient(plugin);
        const onResult = jest.fn();
        await client.requestLEScan({ namePrefix: 'AMPLER' }, onResult);
        expect(plugin.requestLEScan).toHaveBeenCalledWith({ namePrefix: 'AMPLER', scanMode: undefined });
        expect(onResult).toHaveBeenCalledWith({
            device: { deviceId: DEVICE, name: 'AMPLER3' },
            localName: 'AMPLER3',
            rssi: -60,
        });
        await client.stopLEScan();
        plugin.emit('scanResult', { deviceId: DEVICE, name: 'AMPLER3', rssi: -50 });
        expect(onResult).toHaveBeenCalledTimes(1);
    });

    test('the plugin is listened to once, however many calls use it', async () => {
        const plugin = fakePlugin(fakeClient());
        const client = createNativeClient(plugin);
        await client.initialize();
        await client.connect(DEVICE);
        await client.startNotifications(
            DEVICE,
            CHARACTERISTIC.range.service,
            CHARACTERISTIC.range.uuid,
            () => undefined
        );
        expect(plugin.addListener).toHaveBeenCalledTimes(3);
    });
});
