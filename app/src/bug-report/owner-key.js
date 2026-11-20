// Finds the owner key in an Android bug report, as reverse-engineering/tools/owner_key.py does: in each Bluetooth HCI
// snoop log of the bug report, the key the official app wrote to auth when the bike answered `owner ok`
// (docs/protocol.md, "Connection and authentication"). Everything stays in memory on the device.
import { CHARACTERISTIC, isOwnerKey, isOwnerOk } from '../ble/protocol.js';
import { zipEntries, zipEntryBytes } from './zip.js';

const BTSNOOP_MAGIC = 'btsnoop\0';
const BTSNOOP_HEADER = 16;
const BTSNOOP_RECORD = 24;
const H4_ACL = 0x02;
const ATT_CID = 0x0004;
const CHARACTERISTIC_DECLARATION = 0x2803;
const OPCODE_READ_BY_TYPE_REQ = 0x08;
const OPCODE_READ_BY_TYPE_RSP = 0x09;
const OPCODE_WRITE_REQ = 0x12;
const OPCODE_NOTIFY = 0x1b;
const OPCODE_INDICATE = 0x1d;
const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/**
 * One ATT PDU of a capture.
 * @typedef {object} AttPdu
 * @property {boolean} received whether the phone received it from the bike
 * @property {number} connection the HCI connection handle
 * @property {Uint8Array} pdu
 */

/**
 * What a bug report holds.
 * @typedef {object} BugReportKeys
 * @property {number} logs the snoop logs found
 * @property {string[]} keys the keys the bike accepted, each once
 * @property {number} writes the writes to auth seen
 * @property {boolean} authFound whether the capture shows the bike's auth characteristic
 */

/**
 * The ATT PDUs of a btsnoop log (HCI UART, H4), with ACL fragments reassembled.
 * @param {Uint8Array} log
 * @returns {Generator<AttPdu>}
 */
export function* attPdus(log) {
    const data = new DataView(log.buffer, log.byteOffset, log.byteLength);
    if (log.length < BTSNOOP_HEADER || String.fromCharCode(...log.subarray(0, 8)) !== BTSNOOP_MAGIC) {
        throw new RangeError('Not a btsnoop log.');
    }
    /** @type {Map<string, number[]>} */
    const pending = new Map();
    let at = BTSNOOP_HEADER;
    while (at + BTSNOOP_RECORD <= log.length) {
        const included = data.getUint32(at + 4);
        const received = (data.getUint32(at + 8) & 1) === 1;
        const start = at + BTSNOOP_RECORD;
        at = start + included;
        if (at > log.length) return;
        const packet = log.subarray(start, at);
        if (packet.length < 5 || packet[0] !== H4_ACL) continue;
        const handleFlags = data.getUint16(start + 1, true);
        const length = data.getUint16(start + 3, true);
        const connection = handleFlags & 0x0fff;
        const boundary = (handleFlags >> 12) & 0x3;
        const payload = packet.subarray(5, 5 + length);
        const key = `${connection}/${received}`;
        let buffer = pending.get(key);
        if (boundary === 0x0 || boundary === 0x2) {
            buffer = [...payload];
            pending.set(key, buffer);
        } else if (buffer) {
            buffer.push(...payload);
        } else {
            continue;
        }
        if (buffer.length < 4) continue;
        const l2capLength = buffer[0] | (buffer[1] << 8);
        const cid = buffer[2] | (buffer[3] << 8);
        if (buffer.length < 4 + l2capLength) continue;
        pending.delete(key);
        if (cid === ATT_CID) yield { received, connection, pdu: Uint8Array.from(buffer.slice(4, 4 + l2capLength)) };
    }
}

/**
 * A UUID as text, from its 2 or 16 little-endian bytes.
 * @param {Uint8Array} raw
 * @returns {string}
 */
function uuidText(raw) {
    if (raw.length === 2) return `0000${(raw[0] | (raw[1] << 8)).toString(16).padStart(4, '0')}${BASE_UUID_SUFFIX}`;
    const hex = [...raw]
        .reverse()
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {Uint8Array} pdu
 * @param {number} offset
 * @returns {number}
 */
function uint16(pdu, offset) {
    return pdu[offset] | (pdu[offset + 1] << 8);
}

/**
 * The keys the bike accepted in one btsnoop log.
 * @param {Uint8Array} log
 * @returns {{ keys: string[], writes: number, authFound: boolean }}
 */
export function acceptedKeys(log) {
    const pdus = [...attPdus(log)];

    // The auth characteristic's value handles, from the characteristic discovery in the capture.
    /** @type {Map<number, number>} */
    const requestType = new Map();
    /** @type {Set<number>} */
    const authHandles = new Set();
    for (const { received, connection, pdu } of pdus) {
        if (!received && pdu[0] === OPCODE_READ_BY_TYPE_REQ && pdu.length >= 7) {
            requestType.set(connection, uint16(pdu, 5));
        }
        if (
            received &&
            pdu[0] === OPCODE_READ_BY_TYPE_RSP &&
            pdu.length > 2 &&
            requestType.get(connection) === CHARACTERISTIC_DECLARATION
        ) {
            const size = pdu[1];
            if (size < 7) continue;
            for (let i = 2; i + size <= pdu.length; i += size) {
                if (uuidText(pdu.subarray(i + 5, i + size)) === CHARACTERISTIC.auth.uuid) {
                    authHandles.add(uint16(pdu, i + 3));
                }
            }
        }
    }

    /** @type {string[]} */
    const keys = [];
    let writes = 0;
    /** @type {Map<number, Uint8Array>} the key written on each connection, waiting for the bike's answer */
    const written = new Map();
    for (const { received, connection, pdu } of pdus) {
        if (pdu.length < 3 || !authHandles.has(uint16(pdu, 1))) continue;
        const value = pdu.subarray(3);
        if (!received && pdu[0] === OPCODE_WRITE_REQ) {
            writes++;
            written.set(connection, value);
        } else if (received && (pdu[0] === OPCODE_NOTIFY || pdu[0] === OPCODE_INDICATE) && isOwnerOk(value)) {
            const bytes = written.get(connection);
            written.delete(connection);
            if (!bytes) continue;
            const key = String.fromCharCode(...bytes);
            if (isOwnerKey(key) && !keys.includes(key)) keys.push(key);
        }
    }
    return { keys, writes, authFound: authHandles.size > 0 };
}

/**
 * Whether a path inside a bug report is a Bluetooth HCI snoop log.
 * @param {string} name
 * @returns {boolean}
 */
export function isSnoopLog(name) {
    return (name.split('/').pop() ?? '').startsWith('btsnoop_hci.log');
}

/**
 * The owner keys the bike accepted in a bug report (`.zip`), or in a btsnoop log on its own.
 * @param {Blob} file
 * @returns {Promise<BugReportKeys>}
 * @throws {import('./zip.js').ZipError} if the file is neither a ZIP file nor a btsnoop log
 */
export async function ownerKeysInBugReport(file) {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    /** @type {(() => Promise<Uint8Array>)[]} */
    let logs;
    if (String.fromCharCode(...head) === BTSNOOP_MAGIC) {
        logs = [async () => new Uint8Array(await file.arrayBuffer())];
    } else {
        const entries = (await zipEntries(file)).filter((e) => isSnoopLog(e.name));
        logs = entries.map((entry) => () => zipEntryBytes(file, entry));
    }
    /** @type {BugReportKeys} */
    const result = { logs: logs.length, keys: [], writes: 0, authFound: false };
    for (const read of logs) {
        const found = acceptedKeys(await read());
        for (const key of found.keys) if (!result.keys.includes(key)) result.keys.push(key);
        result.writes += found.writes;
        result.authFound ||= found.authFound;
    }
    return result;
}
