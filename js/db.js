// IndexedDB wrapper. All user data lives here, on this device only.
//
// Stores (see README "Backup file format" for field details):
//   labs        { id, test, value, units, low, high, date, notes }
//   metrics     { id: "<metric>|<date>", metric, date, value, source }
//   logFields   { id, name, type: number|scale|bool|text, unit, order, archived }
//   logEntries  { id: "<date>|<fieldId>", date, fieldId, value }
//   settings    { key, value }

const DB_NAME = 'health-dashboard';
const DB_VERSION = 1;
export const STORES = ['labs', 'metrics', 'logFields', 'logEntries', 'settings'];

let dbPromise;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('labs')) {
        const s = db.createObjectStore('labs', { keyPath: 'id' });
        s.createIndex('test', 'test');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('metrics')) {
        const s = db.createObjectStore('metrics', { keyPath: 'id' });
        s.createIndex('metric', 'metric');
      }
      if (!db.objectStoreNames.contains('logFields')) {
        db.createObjectStore('logFields', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('logEntries')) {
        const s = db.createObjectStore('logEntries', { keyPath: 'id' });
        s.createIndex('fieldId', 'fieldId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function getAll(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, value) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function get(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function remove(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

export async function removeByIndex(store, index, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const keys = await wrap(os.index(index).getAllKeys(value));
  for (const k of keys) os.delete(k);
  await done(tx);
  return keys.length;
}

export async function clear(store) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

/** Replaces or merges many stores in a single transaction (used by backup import). */
export async function bulkWrite(data, { replace }) {
  const db = await openDb();
  const names = Object.keys(data);
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const os = tx.objectStore(name);
    if (replace) os.clear();
    for (const v of data[name]) os.put(v);
  }
  return done(tx);
}

export async function getSetting(key, fallback = undefined) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

export async function deleteSetting(key) {
  return remove('settings', key);
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* unsupported */ }
  return false;
}
