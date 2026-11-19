import { ExportError, exportOwnerKey, importOwnerKey } from './key-export.js';

const KEY = 'A'.repeat(28);
// Fewer iterations than the app uses, so that the tests run fast; the format is the same.
const FAST = 1000;

describe('encrypted export', () => {
    test('an export opens with its passphrase and gives back the key', async () => {
        const text = await exportOwnerKey(KEY, 'correct horse', FAST);
        expect(await importOwnerKey(text, 'correct horse')).toBe(KEY);
    });

    test('the export holds no plain key, and names its format and parameters', async () => {
        const text = await exportOwnerKey(KEY, 'correct horse', FAST);
        expect(text).not.toContain(KEY);
        expect(JSON.parse(text)).toMatchObject({
            format: 'openambike-owner-key',
            version: 1,
            kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: FAST },
            cipher: { name: 'AES-GCM' },
        });
    });

    test('the app derives with 600 000 iterations by default', async () => {
        const text = await exportOwnerKey(KEY, 'correct horse');
        expect(JSON.parse(text).kdf.iterations).toBe(600000);
    });

    test('a wrong passphrase, a damaged export or another file is refused', async () => {
        const text = await exportOwnerKey(KEY, 'correct horse', FAST);
        await expect(importOwnerKey(text, 'wrong horse')).rejects.toThrow(ExportError);
        const damaged = JSON.parse(text);
        damaged.data = damaged.data.replace(/^./, (/** @type {string} */ c) => (c === 'A' ? 'B' : 'A'));
        await expect(importOwnerKey(JSON.stringify(damaged), 'correct horse')).rejects.toThrow(ExportError);
        await expect(importOwnerKey('{"hello": 1}', 'correct horse')).rejects.toThrow(ExportError);
        await expect(importOwnerKey('not json', 'correct horse')).rejects.toThrow(ExportError);
    });

    test('a short passphrase is refused', async () => {
        await expect(exportOwnerKey(KEY, 'short', FAST)).rejects.toThrow(RangeError);
    });
});
