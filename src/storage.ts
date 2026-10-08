/** Local persistence in IndexedDB: one autosaved working copy plus any number of named saves. */

const DB_NAME = 'docplanner';
const AUTOSAVE = 'autosave';
const SAVES = 'saves';
const CURRENT = 'current';

export interface SaveEntry {
  name: string;
  savedAt: number;
  /** The workspace serialized as JSON, in the same format as an exported file. */
  data: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(AUTOSAVE);
      request.result.createObjectStore(SAVES, { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAutosave(): Promise<string | undefined> {
  return run<string | undefined>(AUTOSAVE, 'readonly', (s) => s.get(CURRENT));
}

export async function writeAutosave(data: string): Promise<void> {
  await run(AUTOSAVE, 'readwrite', (s) => s.put(data, CURRENT));
}

/** All named saves, most recent first. */
export async function listSaves(): Promise<SaveEntry[]> {
  const entries = await run<SaveEntry[]>(SAVES, 'readonly', (s) => s.getAll());
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export async function putSave(entry: SaveEntry): Promise<void> {
  await run(SAVES, 'readwrite', (s) => s.put(entry));
}

export async function hasSave(name: string): Promise<boolean> {
  return (await run(SAVES, 'readonly', (s) => s.getKey(name))) !== undefined;
}

export async function deleteSave(name: string): Promise<void> {
  await run(SAVES, 'readwrite', (s) => s.delete(name));
}
