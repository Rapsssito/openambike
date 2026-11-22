import { AUTO_CONNECT_THRESHOLDS, autoConnectConfig, createAutoConnect } from './auto-connect.js';
import { CHARACTERISTIC } from './ble/protocol.js';
import { setLanguage } from './i18n/i18n.js';
import { fakeClient } from './test-support/fake-client.js';
import { rideConfig } from './rides/rides.js';
import { fakePlugin } from './test-support/fake-plugin.js';

const KEY = 'A'.repeat(28);
const ADDRESS = 'AA:BB:CC:DD:EE:FF';

describe('auto-connect', () => {
    // setLanguage marks the page's language; the tests run with no page.
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
    });
    beforeEach(() => setLanguage('en'));

    test('the service gets the owner key, the lock and the movement bytes as protocol.js writes and reads them', () => {
        const config = autoConnectConfig({ address: ADDRESS, key: KEY, autoLock: true });
        expect(config.address).toBe(ADDRESS);
        expect(config.auth).toEqual({
            service: CHARACTERISTIC.auth.service,
            characteristic: CHARACTERISTIC.auth.uuid,
            value: '41'.repeat(28),
            reply: '6f776e6572206f6b',
        });
        expect(config.lock).toEqual({
            service: CHARACTERISTIC.lock.service,
            characteristic: CHARACTERISTIC.lock.uuid,
            value: '01',
        });
        expect(config.movement).toEqual({
            service: CHARACTERISTIC.asiMetrics.service,
            characteristic: CHARACTERISTIC.asiMetrics.uuid,
            from: 4,
            to: 12,
        });
        expect(config.thresholds).toEqual(AUTO_CONNECT_THRESHOLDS);
        expect(config.thresholds).toMatchObject({ nearDbm: -72, farDbm: -80, farMs: 3_000, parkedMs: 900_000 });
        expect(config.unlock).toEqual({ ...config.lock, value: '00' });
    });

    test('the notifications are in the language of the app', () => {
        setLanguage('es');
        const { texts } = autoConnectConfig({ address: ADDRESS, key: KEY, autoLock: false });
        expect(texts.looking).toBe('Buscando tu bici');
        expect(texts.pausedParked).toContain('15 min parada');
    });

    test('auto-unlock goes to the service only with auto-lock', () => {
        const config = (/** @type {boolean} */ autoLock) =>
            autoConnectConfig({ address: ADDRESS, key: KEY, autoLock, autoUnlock: true });
        expect(config(false).autoUnlock).toBe(false);
        expect(config(true).autoUnlock).toBe(true);
    });

    test('with auto-ride, the service gets what a ride records, as for one started by hand', () => {
        const off = autoConnectConfig({ address: ADDRESS, key: KEY, autoLock: false });
        expect(off.autoRide).toBe(false);
        expect(off).not.toHaveProperty('ride');
        const on = autoConnectConfig({ address: ADDRESS, key: KEY, autoLock: false, autoRide: true });
        expect(on.ride).toEqual(rideConfig());
    });

    test('a lock pressed by hand, and the answer to location all the time, go to the service', async () => {
        const plugin = fakePlugin(fakeClient());
        const autoConnect = createAutoConnect(plugin);
        await autoConnect.lockPressed(true);
        expect(plugin.lockHeld).toBe(true);
        await autoConnect.lockPressed(false);
        expect(plugin.lockHeld).toBe(false);
        plugin.backgroundLocation = false;
        expect(await autoConnect.askBackgroundLocation()).toBe(false);
    });

    test('a key that is not an owner key is refused before anything reaches the service', () => {
        expect(() => autoConnectConfig({ address: ADDRESS, key: 'short', autoLock: false })).toThrow(RangeError);
    });

    test('turned on, then refreshed, auto-connect keeps auto-lock as it was; turned off, it has nothing', async () => {
        const plugin = fakePlugin(fakeClient());
        const autoConnect = createAutoConnect(plugin);
        const off = { enabled: false, autoLock: false, autoUnlock: false, autoRide: false };
        expect(await autoConnect.status()).toEqual(off);
        await autoConnect.refresh({ address: ADDRESS, key: KEY });
        expect(plugin.autoConnect).toBeUndefined();
        await autoConnect.enable({ address: ADDRESS, key: KEY, autoLock: true, autoUnlock: true, autoRide: true });
        expect(await autoConnect.status()).toEqual({ enabled: true, autoLock: true, autoUnlock: true, autoRide: true });
        setLanguage('es');
        await autoConnect.refresh({ address: ADDRESS, key: KEY });
        expect(JSON.parse(plugin.autoConnect ?? '{}')).toMatchObject({
            autoLock: true,
            autoUnlock: true,
            autoRide: true,
            texts: { looking: 'Buscando tu bici' },
            ride: { texts: { riding: expect.any(String) } },
        });
        await autoConnect.disable();
        expect(await autoConnect.status()).toEqual(off);
    });

    test('after a backup was restored, the first connection turns auto-connect on with the options it brought back', async () => {
        const plugin = fakePlugin(fakeClient());
        plugin.restored = JSON.stringify({ autoLock: true, autoUnlock: false, autoRide: true });
        const autoConnect = createAutoConnect(plugin);
        expect((await autoConnect.status()).enabled).toBe(false);
        expect(await autoConnect.refresh({ address: ADDRESS, key: KEY })).toEqual({ restored: true, autoRide: true });
        expect(await autoConnect.status()).toEqual({
            enabled: true,
            autoLock: true,
            autoUnlock: false,
            autoRide: true,
        });
        expect(await autoConnect.refresh({ address: ADDRESS, key: KEY })).toEqual({ restored: false, autoRide: true });
        plugin.backgroundLocation = false;
        expect(await autoConnect.hasBackgroundLocation()).toBe(false);
    });

    test('auto-connect left on alone, with neither auto-lock nor auto-ride, turns off; restored alone, it stays off', async () => {
        const plugin = fakePlugin(fakeClient());
        const autoConnect = createAutoConnect(plugin);
        await autoConnect.enable({ address: ADDRESS, key: KEY, autoLock: false });
        await autoConnect.turnOffAlone();
        expect((await autoConnect.status()).enabled).toBe(false);
        await autoConnect.enable({ address: ADDRESS, key: KEY, autoLock: false });
        expect(await autoConnect.refresh({ address: ADDRESS, key: KEY })).toEqual({ restored: false, autoRide: false });
        expect((await autoConnect.status()).enabled).toBe(false);
        await autoConnect.enable({ address: ADDRESS, key: KEY, autoLock: true });
        await autoConnect.turnOffAlone();
        expect((await autoConnect.status()).enabled).toBe(true);
        await autoConnect.disable();
        plugin.restored = JSON.stringify({ autoLock: false, autoUnlock: false, autoRide: false });
        expect(await autoConnect.refresh({ address: ADDRESS, key: KEY })).toEqual({ restored: false, autoRide: false });
        expect((await autoConnect.status()).enabled).toBe(false);
    });

    test('pausing and the connection signal go to the service', async () => {
        const plugin = fakePlugin(fakeClient());
        const autoConnect = createAutoConnect(plugin);
        await autoConnect.pause();
        expect(plugin.paused).toBe(true);
        expect(await autoConnect.readRssi(ADDRESS)).toBe(-63);
    });
});
