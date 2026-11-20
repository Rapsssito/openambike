import { deflateRawSync } from 'node:zlib';

import { CHARACTERISTIC } from '../ble/protocol.js';
import { acceptedKeys, attPdus, isSnoopLog, ownerKeysInBugReport } from './owner-key.js';
import { ZipError, zipEntries, zipEntryBytes } from './zip.js';

// Synthetic captures shaped like the official app's first connection in a capture of a Stellar of 2022: discovery of
// the auth characteristic, the key written to it, and the bike's answer. The key is anonymised.
const KEY = 'A'.repeat(28);
const AUTH_HANDLE = 0x0012;
const CONNECTION = 0x0040;

/** @param {string} uuid */
function uuidBytes(uuid) {
    const hex = uuid.replaceAll('-', '');
    return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16));
}

/** @param {number} value */
const le16 = (value) => [value & 0xff, value >> 8];

/**
 * ACL packets (H4) carrying one ATT PDU, split into fragments of at most `fragment` bytes of L2CAP.
 * @param {number[]} pdu
 * @param {number} [fragment]
 */
function aclPackets(pdu, fragment = 1000) {
    const l2cap = [...le16(pdu.length), ...le16(0x0004), ...pdu];
    const packets = [];
    for (let i = 0; i < l2cap.length; i += fragment) {
        const part = l2cap.slice(i, i + fragment);
        const boundary = i === 0 ? 0x2 : 0x1;
        packets.push([0x02, ...le16(CONNECTION | (boundary << 12)), ...le16(part.length), ...part]);
    }
    return packets;
}

/**
 * A btsnoop log of ATT PDUs, each sent (false) or received (true).
 * @param {[boolean, number[]][]} pdus
 * @param {number} [fragment]
 */
function btsnoop(pdus, fragment) {
    const bytes = [...new TextEncoder().encode('btsnoop\0'), 0, 0, 0, 1, 0, 0, 0x03, 0xea];
    for (const [received, pdu] of pdus) {
        for (const packet of aclPackets(pdu, fragment)) {
            const length = [0, 0, packet.length >> 8, packet.length & 0xff];
            bytes.push(...length, ...length, 0, 0, 0, received ? 1 : 0, 0, 0, 0, 0, ...new Array(8).fill(0));
            bytes.push(...packet);
        }
    }
    return Uint8Array.from(bytes);
}

const discovery = /** @type {[boolean, number[]][]} */ ([
    [false, [0x08, ...le16(0x0010), ...le16(0xffff), ...le16(0x2803)]],
    [true, [0x09, 21, ...le16(AUTH_HANDLE - 1), 0x1a, ...le16(AUTH_HANDLE), ...uuidBytes(CHARACTERISTIC.auth.uuid)]],
]);
/** @param {string} key */
const writeKey = (key) =>
    /** @type {[boolean, number[]]} */ ([false, [0x12, ...le16(AUTH_HANDLE), ...new TextEncoder().encode(key)]]);
/** @param {string} text */
const answer = (text) =>
    /** @type {[boolean, number[]]} */ ([true, [0x1b, ...le16(AUTH_HANDLE), ...new TextEncoder().encode(text)]]);

/**
 * A ZIP file of the given files, each stored or deflated.
 * @param {{ name: string, data: Uint8Array, deflate?: boolean }[]} files
 */
function zip(files) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const { name, data, deflate } of files) {
        const body = deflate ? new Uint8Array(deflateRawSync(data)) : data;
        const nameBytes = new TextEncoder().encode(name);
        const method = deflate ? 8 : 0;
        const sizes = [...le32(body.length), ...le32(data.length)];
        const header = [...le32(0x04034b50), 20, 0, 0, 0, method, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...sizes];
        local.push(...header, ...le16(nameBytes.length), 0, 0, ...nameBytes, ...body);
        central.push(...le32(0x02014b50), 20, 0, 20, 0, 0, 0, method, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...sizes);
        central.push(...le16(nameBytes.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(offset), ...nameBytes);
        offset = local.length;
    }
    const end = [...le32(0x06054b50), 0, 0, 0, 0, ...le16(files.length), ...le16(files.length)];
    end.push(...le32(central.length), ...le32(offset), 0, 0);
    return new Blob([Uint8Array.from([...local, ...central, ...end])]);
}

/** @param {number} value */
function le32(value) {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

const LOG_PATH = 'FS/data/misc/bluetooth/logs/btsnoop_hci.log';

describe('ATT PDUs of a btsnoop log', () => {
    test('fragmented ACL packets are put back together', () => {
        const log = btsnoop([writeKey(KEY)], 8);
        const pdus = [...attPdus(log)];
        expect(pdus).toHaveLength(1);
        expect(pdus[0]).toMatchObject({ received: false, connection: CONNECTION });
        expect(new TextDecoder().decode(pdus[0].pdu.subarray(3))).toBe(KEY);
    });

    test('a file that is not a btsnoop log is refused', () => {
        expect(() => [...attPdus(new Uint8Array(32))]).toThrow(RangeError);
    });
});

describe('keys the bike accepted', () => {
    test('the key written to auth and answered "owner ok" is found', () => {
        expect(acceptedKeys(btsnoop([...discovery, writeKey(KEY), answer('owner ok')]))).toEqual({
            keys: [KEY],
            writes: 1,
            authFound: true,
        });
    });

    test('a key the bike refused is not found', () => {
        const other = 'B'.repeat(28);
        const log = btsnoop([...discovery, writeKey(other), answer('error'), writeKey(KEY), answer('owner ok')]);
        expect(acceptedKeys(log).keys).toEqual([KEY]);
    });

    test('with no discovery of auth, nothing is found', () => {
        expect(acceptedKeys(btsnoop([writeKey(KEY), answer('owner ok')]))).toEqual({
            keys: [],
            writes: 0,
            authFound: false,
        });
    });
});

describe('a bug report', () => {
    const log = btsnoop([...discovery, writeKey(KEY), answer('owner ok')]);

    test('snoop logs are recognised by their file name', () => {
        expect(isSnoopLog(LOG_PATH)).toBe(true);
        expect(isSnoopLog('FS/data/misc/bluetooth/logs/btsnoop_hci.log.last')).toBe(true);
        expect(isSnoopLog('bugreport.txt')).toBe(false);
    });

    test('the key is found in a deflated snoop log of the bug report', async () => {
        const report = zip([
            { name: 'bugreport.txt', data: new TextEncoder().encode('logs'), deflate: true },
            { name: LOG_PATH, data: log, deflate: true },
        ]);
        expect(await ownerKeysInBugReport(report)).toEqual({ logs: 1, keys: [KEY], writes: 1, authFound: true });
    });

    test('a stored entry reads back as it was', async () => {
        const report = zip([{ name: LOG_PATH, data: log }]);
        const [entry] = await zipEntries(report);
        expect(entry.name).toBe(LOG_PATH);
        expect(await zipEntryBytes(report, entry)).toEqual(log);
    });

    test('a btsnoop log on its own is read too', async () => {
        expect((await ownerKeysInBugReport(new Blob([log]))).keys).toEqual([KEY]);
    });

    test('a bug report with no snoop log says so', async () => {
        const report = zip([{ name: 'bugreport.txt', data: new TextEncoder().encode('logs') }]);
        expect(await ownerKeysInBugReport(report)).toEqual({ logs: 0, keys: [], writes: 0, authFound: false });
    });

    test('a file that is neither is refused', async () => {
        await expect(ownerKeysInBugReport(new Blob(['not a zip file']))).rejects.toThrow(ZipError);
    });
});
