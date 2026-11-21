import { createNativeKeyStore, createWebKeyStore } from './key-store.js';

const KEY = 'A'.repeat(28);

/** Records in memory, as IndexedDB keeps them by structured cloning. */
function memoryRecords() {
    /** @type {Map<string, unknown>} */
    const map = new Map();
    return {
        map,
        /** @param {string} name */
        get: async (name) => map.get(name),
        /** @param {string} name @param {unknown} value */
        put: async (name, value) => {
            map.set(name, structuredClone(value));
        },
        /** @param {string} name */
        delete: async (name) => {
            map.delete(name);
        },
    };
}

describe('browser store', () => {
    test('the key saved is the key loaded', async () => {
        const store = createWebKeyStore(memoryRecords(), crypto.subtle);
        expect(await store.load()).toBeNull();
        await store.save(KEY);
        expect(await store.load()).toBe(KEY);
    });

    test('the browser storage never holds the key as plain text, nor a key that can be exported', async () => {
        const records = memoryRecords();
        await createWebKeyStore(records, crypto.subtle).save(KEY);
        const stored = /** @type {{ data: ArrayBuffer }} */ (records.map.get('owner-key'));
        expect(new TextDecoder().decode(stored.data)).not.toContain(KEY);
        const deviceKey = /** @type {CryptoKey} */ (records.map.get('device-key'));
        expect(deviceKey.extractable).toBe(false);
        await expect(crypto.subtle.exportKey('raw', deviceKey)).rejects.toThrow();
    });

    test('a removed key is gone', async () => {
        const store = createWebKeyStore(memoryRecords(), crypto.subtle);
        await store.save(KEY);
        await store.remove();
        expect(await store.load()).toBeNull();
    });

    test('a stored key that cannot be decrypted loads as no key', async () => {
        const records = memoryRecords();
        const store = createWebKeyStore(records, crypto.subtle);
        await store.save(KEY);
        await records.put(
            'device-key',
            await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        );
        expect(await store.load()).toBeNull();
    });

    test('only an owner key is saved', async () => {
        await expect(createWebKeyStore(memoryRecords(), crypto.subtle).save('short')).rejects.toThrow(RangeError);
    });
});

describe('Android store', () => {
    test('the key goes to the secure storage under one name', async () => {
        /** @type {Map<string, string>} */
        const map = new Map();
        const store = createNativeKeyStore({
            getItem: async (name) => map.get(name) ?? null,
            setItem: async (name, value) => {
                map.set(name, value);
            },
            removeItem: async (name) => {
                map.delete(name);
            },
        });
        await store.save(KEY);
        expect([...map.keys()]).toEqual(['owner-key']);
        expect(await store.load()).toBe(KEY);
        await store.remove();
        expect(await store.load()).toBeNull();
    });

    /** A secure storage in memory, and the plugin's copy for the backup. */
    const stores = () => {
        /** @type {Map<string, string>} */
        const map = new Map();
        const storage = {
            getItem: async (/** @type {string} */ name) => map.get(name) ?? null,
            setItem: async (/** @type {string} */ name, /** @type {string} */ value) => {
                map.set(name, value);
            },
            removeItem: async (/** @type {string} */ name) => {
                map.delete(name);
            },
        };
        const backup = {
            copy: /** @type {string | undefined} */ (undefined),
            getKeyBackup: async () => (backup.copy ? { key: backup.copy } : {}),
            setKeyBackup: async (/** @type {{ key?: string }} */ { key }) => {
                backup.copy = key;
            },
        };
        return { map, storage, backup };
    };

    test('the key saved gets a copy for the backup, and forgetting it removes both', async () => {
        const { storage, backup } = stores();
        const store = createNativeKeyStore(storage, backup);
        await store.save(KEY);
        expect(backup.copy).toBe(KEY);
        await store.remove();
        expect(backup.copy).toBeUndefined();
        expect(await store.load()).toBeNull();
    });

    test('a phone restored from a backup takes the key from its copy into the Keystore', async () => {
        const { map, storage, backup } = stores();
        backup.copy = KEY;
        expect(await createNativeKeyStore(storage, backup).load()).toBe(KEY);
        expect(map.get('owner-key')).toBe(KEY);
    });

    test('a key saved before the copy existed gets one', async () => {
        const { map, storage, backup } = stores();
        map.set('owner-key', KEY);
        expect(await createNativeKeyStore(storage, backup).load()).toBe(KEY);
        expect(backup.copy).toBe(KEY);
    });
});
