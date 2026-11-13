// On-device storage. Everything lives in this browser's IndexedDB; nothing is sent anywhere.
const NAME = 'ldc-inventory';
export const STORES = ['halls', 'rooms', 'assets', 'projects', 'movements', 'shares', 'meta'];

let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, rec) => run(store, 'readwrite', s => s.put(rec));
export const putMany = (store, recs) => run(store, 'readwrite', s => { for (const r of recs) s.put(r); });

// Ask the browser not to evict the data when storage runs low.
export async function persist() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
