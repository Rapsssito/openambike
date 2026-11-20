// A minimal reader of ZIP files, enough to take a few files out of an Android bug report. It reads only the parts of
// the file it needs, through Blob.slice, so that a bug report of hundreds of megabytes is never loaded whole, and
// inflates with the browser's own DecompressionStream. ZIP64 sizes and offsets are understood; encryption is not.

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;

/** Thrown when a file is not a ZIP file this reader understands. */
export class ZipError extends Error {}

/**
 * One file inside a ZIP file.
 * @typedef {object} ZipEntry
 * @property {string} name its path inside the ZIP file
 * @property {number} method 0 stored, 8 deflated
 * @property {number} compressedSize
 * @property {number} localOffset where its local header starts
 */

/**
 * @param {Blob} blob
 * @param {number} start
 * @param {number} end
 * @returns {Promise<DataView>}
 */
async function view(blob, start, end) {
    return new DataView(await blob.slice(start, end).arrayBuffer());
}

/**
 * @param {DataView} data
 * @param {number} offset
 * @returns {number}
 */
function uint64(data, offset) {
    const value = data.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('ZIP offset too large.');
    return Number(value);
}

/**
 * The files a ZIP file holds, from its central directory.
 * @param {Blob} blob
 * @returns {Promise<ZipEntry[]>}
 */
export async function zipEntries(blob) {
    const tailStart = Math.max(0, blob.size - EOCD_SIZE - MAX_COMMENT);
    const tail = await view(blob, tailStart, blob.size);
    let eocd = -1;
    for (let i = tail.byteLength - EOCD_SIZE; i >= 0; i--) {
        if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new ZipError('Not a ZIP file.');

    let count = tail.getUint16(eocd + 10, true);
    let directorySize = tail.getUint32(eocd + 12, true);
    let directoryOffset = tail.getUint32(eocd + 16, true);
    const locator = eocd - ZIP64_LOCATOR_SIZE;
    if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
        const recordOffset = uint64(tail, locator + 8);
        const record = await view(blob, recordOffset, recordOffset + 56);
        if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new ZipError('Damaged ZIP64 record.');
        count = uint64(record, 32);
        directorySize = uint64(record, 40);
        directoryOffset = uint64(record, 48);
    }

    const directory = await view(blob, directoryOffset, directoryOffset + directorySize);
    const decoder = new TextDecoder();
    /** @type {ZipEntry[]} */
    const entries = [];
    let at = 0;
    for (let n = 0; n < count; n++) {
        if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== CENTRAL_SIGNATURE) {
            throw new ZipError('Damaged ZIP directory.');
        }
        const method = directory.getUint16(at + 10, true);
        let compressedSize = directory.getUint32(at + 20, true);
        let uncompressedSize = directory.getUint32(at + 24, true);
        const nameLength = directory.getUint16(at + 28, true);
        const extraLength = directory.getUint16(at + 30, true);
        const commentLength = directory.getUint16(at + 32, true);
        let localOffset = directory.getUint32(at + 42, true);
        const nameStart = directory.byteOffset + at + 46;
        const name = decoder.decode(new Uint8Array(directory.buffer, nameStart, nameLength));

        // ZIP64 extra field: the 64-bit values of the fields that are all ones, in this order.
        let extra = at + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
            const id = directory.getUint16(extra, true);
            const size = directory.getUint16(extra + 2, true);
            if (id === 0x0001) {
                let field = extra + 4;
                if (uncompressedSize === 0xffffffff) {
                    uncompressedSize = uint64(directory, field);
                    field += 8;
                }
                if (compressedSize === 0xffffffff) {
                    compressedSize = uint64(directory, field);
                    field += 8;
                }
                if (localOffset === 0xffffffff) localOffset = uint64(directory, field);
            }
            extra += 4 + size;
        }
        entries.push({ name, method, compressedSize, localOffset });
        at = extraEnd + commentLength;
    }
    return entries;
}

/**
 * The bytes of one file of a ZIP file, inflated.
 * @param {Blob} blob
 * @param {ZipEntry} entry
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function zipEntryBytes(blob, entry) {
    const local = await view(blob, entry.localOffset, entry.localOffset + 30);
    if (local.byteLength < 30 || local.getUint32(0, true) !== LOCAL_SIGNATURE) {
        throw new ZipError('Damaged ZIP entry.');
    }
    const dataStart = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const data = blob.slice(dataStart, dataStart + entry.compressedSize);
    if (entry.method === STORED) return new Uint8Array(await data.arrayBuffer());
    if (entry.method !== DEFLATED) throw new ZipError(`Unsupported ZIP compression method ${entry.method}.`);
    const inflated = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(inflated).arrayBuffer());
}
