import type { Region } from './types';

/**
 * OCR results kept in IndexedDB, keyed by file hash + page + reader. Paid AI
 * reading survives reloads and re-opening the same file. Failures (private
 * mode, quota) only mean the cache is skipped.
 */

const DB = 'recto-ocr';
const STORE = 'pages';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCached(key: string): Promise<Region[] | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Region[] | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function putCached(key: string, regions: Region[]): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(regions, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Cache is best effort.
  }
}

/** SHA-256 of a file's bytes, hex. */
export async function hashBytes(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
