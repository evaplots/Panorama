// Two-tier cache (memory + IndexedDB).
// IndexedDB persistence is REQUIRED — without it, every reload triggers
// fresh Overpass requests and the IP gets rate-limited.
// See docs/modules/data-layer.md "Cache verification protocol".

const DEBUG_CACHE = true;            // doc-mandated until Phase 2 stabilises
const DB_NAME = 'panorama-cache';
const STORE = 'entries';
const DB_VERSION = 1;
const MEM_MAX_ENTRIES = 500;

const memCache = new Map();
const pending = new Map();

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { resolve(null); return; }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[Cache] IndexedDB open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
  return _dbPromise;
}

function idbOp(mode, fn) {
  return new Promise(resolve => {
    openDB().then(db => {
      if (!db) { resolve(null); return; }
      try {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result = null;
        const req = fn(store);
        if (req) {
          req.onsuccess = () => { result = req.result; };
          req.onerror = () => { result = null; };
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => {
          console.error('[Cache] IDB transaction error:', tx.error);
          resolve(null);
        };
        tx.onabort = () => resolve(null);
      } catch (e) {
        console.error('[Cache] IDB op threw:', e);
        resolve(null);
      }
    });
  });
}

const idbGet    = (key)        => idbOp('readonly',  s => s.get(key));
const idbPut    = (key, entry) => idbOp('readwrite', s => s.put({ key, ...entry }));
const idbDelete = (key)        => idbOp('readwrite', s => s.delete(key));
const idbClear  = ()           => idbOp('readwrite', s => s.clear());

function evictMemLRU() {
  if (memCache.size < MEM_MAX_ENTRIES) return;
  let oldestKey = null, oldestTime = Infinity;
  for (const [k, v] of memCache) {
    if (v.lastUsed < oldestTime) { oldestTime = v.lastUsed; oldestKey = k; }
  }
  if (oldestKey) memCache.delete(oldestKey);
}

const isExpired = entry => entry.expiresAt && entry.expiresAt < Date.now();

function reportHit(hit) {
  const dbg = (typeof window !== 'undefined') && window.__panoramaDebug;
  if (!dbg) return;
  if (hit) dbg.cacheHits = (dbg.cacheHits ?? 0) + 1;
  else     dbg.cacheMisses = (dbg.cacheMisses ?? 0) + 1;
}

async function getInternal(key) {
  const mem = memCache.get(key);
  if (mem) {
    if (isExpired(mem)) {
      memCache.delete(key);
      idbDelete(key);
      return null;
    }
    mem.lastUsed = Date.now();
    return mem.value;
  }

  const idb = await idbGet(key);
  if (!idb) return null;
  if (isExpired(idb)) {
    idbDelete(key);
    return null;
  }
  evictMemLRU();
  memCache.set(key, {
    value: idb.value,
    expiresAt: idb.expiresAt,
    lastUsed: Date.now(),
  });
  return idb.value;
}

async function setInternal(key, value, ttlMs) {
  const expiresAt = ttlMs ? Date.now() + ttlMs : null;
  evictMemLRU();
  memCache.set(key, { value, expiresAt, lastUsed: Date.now() });
  // AWAIT the IDB write — fire-and-forget loses data when the page reloads
  // before the transaction commits, which is the dominant cache-failure mode.
  try {
    await idbPut(key, { value, expiresAt });
  } catch (err) {
    console.error('[Cache] IDB write failed for', key, err);
  }
}

export const Cache = {
  async get(key) {
    const result = await getInternal(key);
    const hit = result !== null;
    if (DEBUG_CACHE) console.log(`[Cache] ${hit ? 'HIT ' : 'MISS'} ${key}`);
    reportHit(hit);
    return result;
  },

  async set(key, value, ttlMs) {
    if (DEBUG_CACHE) {
      const sz = (() => { try { return JSON.stringify(value).length; } catch { return -1; } })();
      console.log(`[Cache] WRITE ${key} (${sz}b, ttl ${ttlMs}ms)`);
    }
    return setInternal(key, value, ttlMs);
  },

  async delete(key) {
    memCache.delete(key);
    await idbDelete(key);
  },

  async clear() {
    memCache.clear();
    await idbClear();
  },

  async size() { return 0; },

  /** Coalesce in-flight fetches for the same key. */
  dedupe(key, fetchFn) {
    const existing = pending.get(key);
    if (existing) return existing;
    const p = fetchFn().finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  },
};
