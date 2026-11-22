import { ASI_ODOMETER, CHARACTERISTIC, decodeAsiMetrics } from '../ble/protocol.js';
import { setLanguage } from '../i18n/i18n.js';
import { fakeClient } from '../test-support/fake-client.js';
import { fakePlugin } from '../test-support/fake-plugin.js';
import { RIDE_ID, rideFile } from '../test-support/ride-file.js';
import { createRides, rideConfig } from './rides.js';

describe('rides', () => {
    beforeAll(() => {
        Object.assign(globalThis, { document: { documentElement: {} } });
        setLanguage('en');
    });

    test('a ride starts with the characteristics it keeps and the texts of its notification, and stops', async () => {
        const plugin = fakePlugin(fakeClient());
        const rides = createRides(plugin);
        expect(await rides.active()).toBeNull();
        const id = await rides.start();
        const config = JSON.parse(plugin.ride?.config ?? '{}');
        expect(config.characteristics).toEqual([CHARACTERISTIC.asiMetrics.uuid, CHARACTERISTIC.battery.uuid]);
        expect(config.texts.riding).toBeTruthy();
        await rides.setPaused(true);
        expect(await rides.active()).toEqual({ id, paused: true });
        expect(await rides.stop()).toBe(id);
        expect(await rides.active()).toBeNull();
        expect(await rides.list()).toEqual([id]);
    });

    test("the service shows a ride's distance from the odometer where decodeAsiMetrics reads it, in the rider's units", () => {
        const { odometer, distance, texts } = rideConfig('mi');
        expect(odometer.characteristic).toBe(CHARACTERISTIC.asiMetrics.uuid);
        // The service reads an unsigned 32-bit little-endian value at the offset, divided by perKm.
        const frame = new Uint8Array(12);
        new DataView(frame.buffer).setUint32(ASI_ODOMETER.offset, 377_423, true);
        const view = new DataView(frame.buffer);
        expect(view.getUint32(odometer.offset, true) / odometer.perKm).toBe(decodeAsiMetrics(frame).odometerKm);
        expect(distance).toEqual({ kmPerUnit: 1.609344, unit: 'mi' });
        expect(rideConfig('km').distance).toEqual({ kmPerUnit: 1, unit: 'km' });
        expect(texts).toMatchObject({ rideChannel: 'Rides', pause: 'Pause', resume: 'Resume' });
    });

    test('a ride that grows is read from where it was left', async () => {
        const plugin = fakePlugin(fakeClient());
        const rides = createRides(plugin);
        const lines = rideFile().split('\n');
        plugin.rides.set(RIDE_ID, `${lines.slice(0, 100).join('\n')}\n`);
        const early = (await rides.reader(RIDE_ID)).summary();
        expect(early.ended).toBe(false);
        plugin.rides.set(RIDE_ID, rideFile());
        const late = (await rides.reader(RIDE_ID)).summary();
        expect(late.ended).toBe(true);
        expect(late.distanceKm).toBeCloseTo(0.4, 5);
    });

    test('one ride, or the whole history, is exported as one GPX file through the share menu', async () => {
        const plugin = fakePlugin(fakeClient());
        const rides = createRides(plugin);
        plugin.rides.set(RIDE_ID, rideFile());
        plugin.rides.set(RIDE_ID + 86_400_000, rideFile());
        await rides.exportRides([RIDE_ID]);
        expect(plugin.shared[0]).toMatchObject({ name: 'openambike-ride-2026-11-21.gpx', type: 'application/gpx+xml' });
        expect(plugin.shared[0].text.match(/<trk>/g)).toHaveLength(1);
        await rides.exportRides(await rides.list());
        expect(plugin.shared[1].name).toBe('openambike-rides-2026-11-22.gpx');
        expect(plugin.shared[1].text.match(/<trk>/g)).toHaveLength(2);
    });

    test('the history reads a ride that ended once, then its kept summary', async () => {
        const plugin = fakePlugin(fakeClient());
        plugin.rides.set(RIDE_ID, rideFile());
        const first = await createRides(plugin).history();
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ id: RIDE_ID, ended: true, movingMs: 78_000 });
        expect(first[0]).not.toHaveProperty('route');
        const again = await createRides(plugin).history();
        expect(again).toEqual(first);
        expect(plugin.reads.get(RIDE_ID)).toBe(1);
    });

    test('a summary kept by another version, or of a ride still recording, is made from the file again', async () => {
        const plugin = fakePlugin(fakeClient());
        plugin.rides.set(RIDE_ID, `${rideFile().split('\n').slice(0, 100).join('\n')}\n`);
        plugin.summaries.set(RIDE_ID + 1, JSON.stringify({ version: 0, id: RIDE_ID + 1 }));
        plugin.rides.set(RIDE_ID + 1, rideFile());
        const rides = createRides(plugin);
        expect(await rides.history(RIDE_ID)).toHaveLength(1);
        await rides.history();
        expect(plugin.summaries.has(RIDE_ID)).toBe(false);
        expect(JSON.parse(plugin.summaries.get(RIDE_ID + 1) ?? '{}').version).toBe(1);
        expect(plugin.reads.get(RIDE_ID)).toBe(1);
    });

    test('a deleted ride leaves the history', async () => {
        const plugin = fakePlugin(fakeClient());
        const rides = createRides(plugin);
        plugin.rides.set(RIDE_ID, rideFile());
        await rides.remove(RIDE_ID);
        expect(await rides.list()).toEqual([]);
    });
});
