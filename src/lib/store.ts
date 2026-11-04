/** 離線快取（契約 §6.1：IndexedDB）。失敗時退回記憶體，不影響畫面。 */
const mem = new Map<string, unknown>();
let dbp: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      if (typeof indexedDB === "undefined") return res(null);
      const r = indexedDB.open("stock-watch", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
export type Cached<T> = { at: string; data: T };
export async function put<T>(key: string, data: T) {
  const v: Cached<T> = { at: new Date().toISOString(), data };
  mem.set(key, v);
  const db = await open(); if (!db) return;
  try { db.transaction("kv", "readwrite").objectStore("kv").put(v, key); } catch { /* ignore */ }
}
export async function get<T>(key: string): Promise<Cached<T> | null> {
  if (mem.has(key)) return mem.get(key) as Cached<T>;
  const db = await open(); if (!db) return null;
  return new Promise((res) => {
    try { const r = db.transaction("kv").objectStore("kv").get(key); r.onsuccess = () => res((r.result as Cached<T>) ?? null); r.onerror = () => res(null); }
    catch { res(null); }
  });
}
