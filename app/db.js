// IndexedDB access layer.
//
// Everything the practice records lives here. localStorage was the previous
// home and it is neither durable nor large enough for attachments; IndexedDB
// survives far more, and (once the app is installed to the Home Screen) is not
// subject to Safari's eviction of unused website data.

const DB_NAME = "practice";
// v2 added the certificates store. Upgrades are additive, so an older install
// gains the new store without touching the records already on the device.
const DB_VERSION = 2;

/** Every store carries the same envelope so sync and backup stay generic. */
export const STORES = {
  patients: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["surname", "surname"]] },
  prescriptions: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["patientId", "patientId"], ["issuedAt", "issuedAt"]] },
  encounters: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["patientId", "patientId"], ["date", "date"]] },
  invoices: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["patientId", "patientId"], ["number", "number"]] },
  certificates: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["patientId", "patientId"], ["date", "date"]] },
  medicines: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["name", "name"]] },
  attachments: { keyPath: "id", indexes: [["updatedAt", "updatedAt"], ["patientId", "patientId"]] },
  settings: { keyPath: "key", indexes: [] },
  outbox: { keyPath: "seq", autoIncrement: true, indexes: [] },
};

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Migrations are additive and idempotent so an older install upgrades
      // cleanly without touching data already on the device.
      for (const [name, spec] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, {
              keyPath: spec.keyPath,
              autoIncrement: Boolean(spec.autoIncrement),
            });
        for (const [indexName, keyPath] of spec.indexes) {
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
        }
      }
      void event;
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database upgrade blocked — close other tabs of this app."));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = fn(store, tx);
        } catch (err) {
          tx.abort();
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      })
  );
}

const wrap = (request) => ({ __req: request });

export const get = (store, key) => run(store, "readonly", (s) => wrap(s.get(key)));

export const getAll = (store) => run(store, "readonly", (s) => wrap(s.getAll()));

export const put = (store, value) => run(store, "readwrite", (s) => {
  s.put(value);
  return value;
});

export const putMany = (store, values) => run(store, "readwrite", (s) => {
  for (const v of values) s.put(v);
  return values.length;
});

export const del = (store, key) => run(store, "readwrite", (s) => {
  s.delete(key);
  return true;
});

export const clear = (store) => run(store, "readwrite", (s) => {
  s.clear();
  return true;
});

export function getAllByIndex(store, indexName, query) {
  return run(store, "readonly", (s) => wrap(s.index(indexName).getAll(query)));
}

/** Read across several stores in one transaction so a backup is consistent. */
export function snapshot(storeNames) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, "readonly");
        const out = {};
        for (const name of storeNames) {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => {
            out[name] = req.result;
          };
        }
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** Write several stores atomically — used by restore and by sync pulls. */
export function replaceAll(payload, { merge = false } = {}) {
  const names = Object.keys(payload);
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(names, "readwrite");
        for (const name of names) {
          const store = tx.objectStore(name);
          if (!merge) store.clear();
          for (const record of payload[name] || []) store.put(record);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

/**
 * Ask the browser to exempt this origin from storage eviction. Safari grants
 * this once the app is installed to the Home Screen; elsewhere it is a no-op.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const already = await navigator.storage.persisted();
  const persisted = already || (await navigator.storage.persist());
  return { supported: true, persisted };
}

export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
