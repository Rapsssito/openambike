// Where the owner key is kept on this device, so that it is typed once. On Android, in the Android Keystore through the
// secure storage plugin, with a copy for Android's backup, since the Keystore's key never leaves the phone. In a browser, encrypted with a non-extractable AES-GCM key that only this origin can use:
// the browser's storage never holds the owner key as plain text, and the encryption key cannot be read out of it.
import { isOwnerKey } from '../ble/protocol.js';

/**
 * @typedef {object} KeyStore
 * @property {() => Promise<string | null>} load the stored owner key, or null when there is none
 * @property {(key: string) => Promise<void>} save
 * @property {() => Promise<void>} remove
 */

/** Name of the stored item, in either storage. */
const OWNER_KEY_ITEM = 'owner-key';

/**
 * The part of the secure storage plugin's interface this module uses.
 * @typedef {object} SecureStorageLike
 * @property {(key: string) => Promise<string | null>} getItem
 * @property {(key: string, value: string) => Promise<void>} setItem
 * @property {(key: string) => Promise<void>} removeItem
 */

/**
 * The owner key's copy for Android's backup, kept by the app's own plugin outside the Keystore.
 * @typedef {object} KeyBackup
 * @property {() => Promise<{ key?: string }>} getKeyBackup
 * @property {(options: { key?: string }) => Promise<void>} setKeyBackup without `key`, removes the copy
 */

/**
 * @param {string} key
 */
function checkKey(key) {
    if (!isOwnerKey(key)) throw new RangeError('Not an owner key.');
}

/**
 * The Android store, in the Android Keystore, with a copy for Android's backup: when the Keystore holds no key, as on a
 * phone restored from a backup, the copy is saved in the Keystore again; a key saved before the copy existed gets one.
 * @param {SecureStorageLike} storage
 * @param {KeyBackup} [backup]
 * @returns {KeyStore}
 */
export function createNativeKeyStore(storage, backup) {
    return {
        async load() {
            const kept = await storage.getItem(OWNER_KEY_ITEM).catch(() => null);
            const key = kept && isOwnerKey(kept) ? kept : null;
            if (!backup) return key;
            const copy = (await backup.getKeyBackup().catch(() => ({ key: undefined }))).key;
            if (key) {
                if (copy !== key) await backup.setKeyBackup({ key }).catch(() => undefined);
                return key;
            }
            if (!copy || !isOwnerKey(copy)) return null;
            await storage.setItem(OWNER_KEY_ITEM, copy).catch(() => undefined);
            return copy;
        },
        async save(key) {
            checkKey(key);
            await storage.setItem(OWNER_KEY_ITEM, key);
            await backup?.setKeyBackup({ key });
        },
        async remove() {
            await storage.removeItem(OWNER_KEY_ITEM);
            await backup?.setKeyBackup({});
        },
    };
}

/**
 * Records kept by name, as in an IndexedDB object store; values are anything structured cloning keeps, CryptoKey
 * included.
 * @typedef {object} Records
 * @property {(name: string) => Promise<unknown>} get
 * @property {(name: string, value: unknown) => Promise<void>} put
 * @property {(name: string) => Promise<void>} delete
 */

/** Name of the record that holds the non-extractable key that encrypts the owner key. */
const DEVICE_KEY_RECORD = 'device-key';

/**
 * The browser store: the owner key encrypted with AES-GCM under a key that cannot be exported.
 * @param {Records} records
 * @param {SubtleCrypto} subtle
 * @returns {KeyStore}
 */
export function createWebKeyStore(records, subtle) {
    /** @returns {Promise<CryptoKey>} */
    async function deviceKey() {
        const stored = await records.get(DEVICE_KEY_RECORD);
        if (stored instanceof CryptoKey) return stored;
        const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await records.put(DEVICE_KEY_RECORD, key);
        return key;
    }

    return {
        async load() {
            const stored = /** @type {{ iv: Uint8Array<ArrayBuffer>, data: ArrayBuffer } | undefined} */ (
                await records.get(OWNER_KEY_ITEM)
            );
            const key = await records.get(DEVICE_KEY_RECORD);
            if (!stored || !(key instanceof CryptoKey)) return null;
            try {
                const plain = await subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, key, stored.data);
                const ownerKey = new TextDecoder().decode(plain);
                return isOwnerKey(ownerKey) ? ownerKey : null;
            } catch {
                return null;
            }
        },
        async save(ownerKey) {
            checkKey(ownerKey);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = await subtle.encrypt(
                { name: 'AES-GCM', iv },
                await deviceKey(),
                new TextEncoder().encode(ownerKey)
            );
            await records.put(OWNER_KEY_ITEM, { iv, data });
        },
        async remove() {
            await records.delete(OWNER_KEY_ITEM);
        },
    };
}

/** IndexedDB database and object store of the browser store. */
const DATABASE = 'openambike';
const STORE = 'keys';

/**
 * Records in this origin's IndexedDB.
 * @param {IDBFactory} indexedDB
 * @returns {Records}
 */
export function indexedDbRecords(indexedDB) {
    /** @type {Promise<IDBDatabase> | null} */
    let opening = null;
    const open = () =>
        (opening ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }));

    /**
     * @param {IDBTransactionMode} mode
     * @param {(store: IDBObjectStore) => IDBRequest} action
     * @returns {Promise<unknown>}
     */
    async function run(mode, action) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const request = action(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    return {
        get: (name) => run('readonly', (store) => store.get(name)),
        put: async (name, value) => {
            await run('readwrite', (store) => store.put(value, name));
        },
        delete: async (name) => {
            await run('readwrite', (store) => store.delete(name));
        },
    };
}
