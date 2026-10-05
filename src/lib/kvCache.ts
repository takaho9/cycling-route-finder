import { globalIndexedDb, idbDone, KV_INDEX_NS_SAVED, KV_STORE, openChoichariDb } from './idb'

/**
 * 汎用の永続 KV キャッシュ（v1.2）。標高・写真・ルートの「アプリを開き直しても残る」層。
 * - IndexedDB（DB 'choichari' の store 'kv'）。無ければ localStorage（名前空間ごとに 1 キーの JSON）
 * - 名前空間・TTL（値ごとに変えられる）・最大件数（保存が古いものから削除）
 * - 読み書きはすべて best effort: 失敗・タイムアウトは「キャッシュに無い」「保存しない」として扱う
 * メモリ層は呼び出し側で持つ（メモリ → 永続 → ネットワーク）。
 */

export interface KvRecord {
  /** `${ns}|${key}` */
  k: string
  ns: string
  key: string
  v: unknown
  savedAt: number
  expiresAt: number
}

/** 低レベルの保存先（IndexedDB / localStorage / テスト用） */
export interface KvBackend {
  getMany(ns: string, keys: readonly string[]): Promise<Map<string, KvRecord>>
  /** 保存し、ns 内が maxEntries を超えたら savedAt の古い順に削除 */
  putMany(ns: string, records: readonly KvRecord[], maxEntries: number): Promise<void>
  deleteMany(ns: string, keys: readonly string[]): Promise<void>
  clear(ns: string): Promise<void>
}

export interface KvCacheOptions<T> {
  namespace: string
  /** 既定の有効期間 (ms) */
  ttlMs: number
  /** 値によって有効期間を変える（例: 写真なしは短く） */
  ttlFor?: (value: T) => number
  maxEntries: number
  /** localStorage に落ちたときの最大件数（既定 = maxEntries） */
  maxEntriesLocalStorage?: number
  /** 省略時: IndexedDB があればそれ、無ければ localStorage */
  backend?: KvBackend | null
  /** 1 回の読み書きの待ち時間の上限 (ms)。超えたらキャッシュ無しとして進む（既定 1500ms） */
  timeoutMs?: number
  now?: () => number
}

export interface KvCache<T> {
  get(key: string): Promise<T | undefined>
  /** まとめて読む（IndexedDB は 1 トランザクション）。有効なものだけ返す */
  getMany(keys: readonly string[]): Promise<Map<string, T>>
  set(key: string, value: T): Promise<void>
  /** まとめて書く（IndexedDB は 1 トランザクション） */
  setMany(entries: Iterable<readonly [string, T]>): Promise<void>
  clear(): Promise<void>
}

const recordKey = (ns: string, key: string) => `${ns}|${key}`

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      },
    )
  })
}

export function createKvCache<T>(opts: KvCacheOptions<T>): KvCache<T> {
  const { namespace: ns, ttlMs, ttlFor, timeoutMs = 1500, now = Date.now } = opts
  let backend: KvBackend | null | undefined = opts.backend
  let maxEntries = opts.maxEntries
  const getBackend = (): KvBackend | null => {
    if (backend !== undefined) return backend
    const idb = globalIndexedDb()
    if (idb) backend = createIndexedDbKvBackend(idb)
    else {
      backend = createLocalStorageKvBackend()
      maxEntries = opts.maxEntriesLocalStorage ?? opts.maxEntries
    }
    return backend
  }

  const getMany = async (keys: readonly string[]): Promise<Map<string, T>> => {
    const out = new Map<string, T>()
    const b = getBackend()
    if (!b || keys.length === 0) return out
    const uniq = [...new Set(keys)]
    const found = await withTimeout(b.getMany(ns, uniq), timeoutMs, new Map<string, KvRecord>())
    const t = now()
    const expired: string[] = []
    for (const [key, r] of found) {
      if (typeof r.expiresAt === 'number' && r.expiresAt > t) out.set(key, r.v as T)
      else expired.push(key)
    }
    if (expired.length) void withTimeout(b.deleteMany(ns, expired), timeoutMs, undefined)
    return out
  }

  const setMany = async (entries: Iterable<readonly [string, T]>): Promise<void> => {
    const b = getBackend()
    if (!b) return
    const t = now()
    const records: KvRecord[] = []
    for (const [key, v] of entries) {
      const ttl = ttlFor ? ttlFor(v) : ttlMs
      if (!(ttl > 0)) continue
      records.push({ k: recordKey(ns, key), ns, key, v, savedAt: t, expiresAt: t + ttl })
    }
    if (records.length === 0) return
    await withTimeout(b.putMany(ns, records, maxEntries), timeoutMs * 2, undefined)
  }

  return {
    async get(key) {
      return (await getMany([key])).get(key)
    },
    getMany,
    set: (key, value) => setMany([[key, value]]),
    setMany,
    async clear() {
      const b = getBackend()
      if (b) await withTimeout(b.clear(ns), timeoutMs, undefined)
    },
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

export function createIndexedDbKvBackend(idb: IDBFactory): KvBackend {
  const bound = (ns: string) => IDBKeyRange.bound([ns, -Infinity], [ns, Infinity])
  return {
    async getMany(ns, keys) {
      const db = await openChoichariDb(idb)
      const tx = db.transaction(KV_STORE, 'readonly')
      const store = tx.objectStore(KV_STORE)
      const out = new Map<string, KvRecord>()
      keys.forEach((key) => {
        const r = store.get(recordKey(ns, key))
        r.onsuccess = () => {
          const rec = r.result as KvRecord | undefined
          if (rec) out.set(key, rec)
        }
      })
      await idbDone(tx)
      return out
    },
    async putMany(ns, records, maxEntries) {
      const db = await openChoichariDb(idb)
      const tx = db.transaction(KV_STORE, 'readwrite')
      const store = tx.objectStore(KV_STORE)
      for (const r of records) store.put(r)
      // 同じトランザクションで件数を見て、超えた分だけ古い順に削除
      const index = store.index(KV_INDEX_NS_SAVED)
      const count = index.count(bound(ns))
      count.onsuccess = () => {
        let over = count.result - maxEntries
        if (over <= 0) return
        const cur = index.openCursor(bound(ns))
        cur.onsuccess = () => {
          const c = cur.result
          if (!c || over <= 0) return
          c.delete()
          over--
          c.continue()
        }
      }
      await idbDone(tx)
    },
    async deleteMany(ns, keys) {
      const db = await openChoichariDb(idb)
      const tx = db.transaction(KV_STORE, 'readwrite')
      const store = tx.objectStore(KV_STORE)
      for (const key of keys) store.delete(recordKey(ns, key))
      await idbDone(tx)
    },
    async clear(ns) {
      const db = await openChoichariDb(idb)
      const tx = db.transaction(KV_STORE, 'readwrite')
      const index = tx.objectStore(KV_STORE).index(KV_INDEX_NS_SAVED)
      const cur = index.openKeyCursor(bound(ns))
      const store = tx.objectStore(KV_STORE)
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return
        store.delete(c.primaryKey)
        c.continue()
      }
      await idbDone(tx)
    },
  }
}

// ---------------------------------------------------------------------------
// localStorage（名前空間ごとに 1 キー: { key: [value, savedAt, expiresAt] }）
// ---------------------------------------------------------------------------

export const KV_LS_PREFIX = 'choichari:v1:kv:'

type LsBlob = Record<string, [unknown, number, number]>

export function createLocalStorageKvBackend(storage: Storage | null = safeLocalStorage()): KvBackend {
  const read = (ns: string): LsBlob => {
    try {
      const raw = storage?.getItem(KV_LS_PREFIX + ns)
      const blob = raw ? (JSON.parse(raw) as unknown) : null
      return blob && typeof blob === 'object' && !Array.isArray(blob) ? (blob as LsBlob) : {}
    } catch {
      return {}
    }
  }
  const write = (ns: string, blob: LsBlob) => {
    try {
      storage?.setItem(KV_LS_PREFIX + ns, JSON.stringify(blob))
    } catch {
      /* quota 等は無視 */
    }
  }
  const toRecord = (ns: string, key: string, e: LsBlob[string]): KvRecord | null =>
    Array.isArray(e) && typeof e[1] === 'number' && typeof e[2] === 'number'
      ? { k: recordKey(ns, key), ns, key, v: e[0], savedAt: e[1], expiresAt: e[2] }
      : null
  return {
    async getMany(ns, keys) {
      const blob = read(ns)
      const out = new Map<string, KvRecord>()
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(blob, key)) continue
        const r = toRecord(ns, key, blob[key])
        if (r) out.set(key, r)
      }
      return out
    },
    async putMany(ns, records, maxEntries) {
      if (!storage) return
      const blob = read(ns)
      for (const r of records) blob[r.key] = [r.v, r.savedAt, r.expiresAt]
      const now = records[0]?.savedAt ?? Date.now()
      const entries = Object.entries(blob)
        .filter(([, e]) => Array.isArray(e) && typeof e[1] === 'number' && e[2] > now)
        .sort((a, b) => b[1][1] - a[1][1])
        .slice(0, Math.max(0, maxEntries))
      write(ns, Object.fromEntries(entries))
    },
    async deleteMany(ns, keys) {
      if (!storage) return
      const blob = read(ns)
      for (const k of keys) delete blob[k]
      write(ns, blob)
    },
    async clear(ns) {
      try {
        storage?.removeItem(KV_LS_PREFIX + ns)
      } catch {
        /* ignore */
      }
    },
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
