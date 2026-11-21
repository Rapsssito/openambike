// A ride's file as the native service writes it, built for tests: a ride along a straight line north, with GPS fixes,
// the bike's ASI metrics and battery notifications, and a pause in the middle.
import { CHARACTERISTIC } from '../ble/protocol.js';

export const RIDE_ID = Date.UTC(2026, 10, 21, 9, 0, 0);

/**
 * ASI metrics bytes, as protocol.js decodes them: odometer in hundredths of a kilometre, motor power, speed in tenths
 * of a km/h, and the rider's power as two factors (here the power itself times 1, with the divisor of protocol.js).
 * @param {{ odometer: number, motor: number, speed: number, riderRaw: [number, number] }} figures
 */
export function asiMetrics({ odometer, motor, speed, riderRaw }) {
    const bytes = new DataView(new ArrayBuffer(12));
    bytes.setUint32(0, odometer, true);
    bytes.setUint16(4, motor, true);
    bytes.setUint16(6, speed, true);
    bytes.setUint16(8, riderRaw[0], true);
    bytes.setUint16(10, riderRaw[1], true);
    return Array.from(new Uint8Array(bytes.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Battery bytes with an absolute state of charge, in milliwatt-hours, at bytes 7 to 10.
 * @param {number} mWh
 */
export function battery(mWh) {
    const bytes = new DataView(new ArrayBuffer(11));
    bytes.setUint16(0, 52000, true);
    bytes.setUint16(4, 3000, true);
    bytes.setUint8(6, 70);
    bytes.setUint32(7, mWh, true);
    return Array.from(new Uint8Array(bytes.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** About 5 m north, in degrees of latitude. */
const STEP_DEG = 5 / 111_195;

/**
 * A ride: 60 s riding at 18 km/h (5 m/s, a fix and a bike frame each second, the odometer up 10 m every 2 s), then a
 * pause of 30 s, then 20 s standing still with the GPS drifting, then 20 s riding again; stopped at the end.
 */
export function rideFile() {
    /** @type {Record<string, unknown>[]} */
    const lines = [{ t: RIDE_ID, type: 'start', format: 1 }];
    let t = RIDE_ID;
    let lat = 41.38;
    let odometer = 377_423;
    const frame = (/** @type {number} */ speedKmh, /** @type {number} */ motor) => {
        lines.push({
            t,
            type: 'frame',
            c: CHARACTERISTIC.asiMetrics.uuid,
            v: asiMetrics({ odometer, motor, speed: speedKmh * 10, riderRaw: speedKmh > 0 ? [100, 1] : [0, 0] }),
        });
    };
    const ride = (/** @type {number} */ seconds) => {
        for (let i = 0; i < seconds; i++) {
            t += 1000;
            lat += STEP_DEG;
            if (i % 2 === 1) odometer += 1;
            lines.push({ t, type: 'fix', lat, lon: 2.17, alt: 12, acc: 4, speed: 5 });
            frame(18, 120);
        }
    };
    lines.push({ t, type: 'frame', c: CHARACTERISTIC.battery.uuid, v: battery(227_172) });
    ride(60);
    lines.push({ t: t + 1, type: 'pause' });
    t += 30_000;
    lines.push({ t, type: 'resume' });
    for (let i = 0; i < 20; i++) {
        t += 1000;
        // Standing: the fix drifts by a metre, within its accuracy, and the bike sends no speed.
        lines.push({ t, type: 'fix', lat: lat + (i % 2) * 0.00001, lon: 2.17, acc: 4, speed: 0 });
    }
    ride(20);
    lines.push({ t, type: 'frame', c: CHARACTERISTIC.battery.uuid, v: battery(222_172) });
    lines.push({ t, type: 'stop' });
    return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}
