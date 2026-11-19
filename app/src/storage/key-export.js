// The encrypted export of the owner key, to keep as a backup or to move the key to another device: a small JSON text,
// the key encrypted with AES-GCM under a key derived from a passphrase with PBKDF2-SHA-256.
import { isOwnerKey } from '../ble/protocol.js';

/** Identifies an export of this app, and its version. */
export const EXPORT_FORMAT = 'openambike-owner-key';
export const EXPORT_VERSION = 1;

/** PBKDF2 iterations, as OWASP recommends for PBKDF2-SHA-256. */
export const PBKDF2_ITERATIONS = 600000;

/** Shortest passphrase accepted for an export. */
export const MIN_PASSPHRASE_LENGTH = 8;

/** Thrown when an export cannot be opened: wrong passphrase, or not an export of this app. */
export class ExportError extends Error {}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64(text) {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/**
 * @param {string} passphrase
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
        'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * @param {string} ownerKey
 * @param {string} passphrase
 * @param {number} [iterations]
 * @returns {Promise<string>} the export, as JSON text
 */
export async function exportOwnerKey(ownerKey, passphrase, iterations = PBKDF2_ITERATIONS) {
    if (!isOwnerKey(ownerKey)) throw new RangeError('Not an owner key.');
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new RangeError(`The passphrase is at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, iterations);
    const data = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(ownerKey))
    );
    return JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
        cipher: { name: 'AES-GCM', iv: toBase64(iv) },
        data: toBase64(data),
    });
}

/**
 * @param {string} text an export, as JSON text
 * @param {string} passphrase
 * @returns {Promise<string>} the owner key
 */
export async function importOwnerKey(text, passphrase) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ExportError('Not an export of this app.');
    }
    if (parsed?.format !== EXPORT_FORMAT || parsed.version !== EXPORT_VERSION) {
        throw new ExportError('Not an export of this app.');
    }
    try {
        const key = await deriveKey(passphrase, fromBase64(parsed.kdf.salt), parsed.kdf.iterations);
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64(parsed.cipher.iv) },
            key,
            fromBase64(parsed.data)
        );
        const ownerKey = new TextDecoder().decode(plain);
        if (!isOwnerKey(ownerKey)) throw new Error('not an owner key');
        return ownerKey;
    } catch {
        throw new ExportError('Wrong passphrase, or a damaged export.');
    }
}
