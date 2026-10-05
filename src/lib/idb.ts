/**
 * IndexedDB 'choichari' の開き方を 1 か所に（v1.2）。
 * store を足すときは DB_VERSION を上げ、upgradeChoichariDb に「無ければ作る」を追記する
 * （既存の store は消さない。古いバージョンからでも一気に最新へ上がれるようにする）。
 *
 * - v1: places（目的地の検索結果, keyPath 'key'）
 * - v2: kv（汎用の永続 KV キャッシュ, keyPath 'k', index 'ns_savedAt' = [ns, savedAt]）
 */
export const DB_NAME = 'choichari'
export const DB_VERSION = 2
export const PLACES_STORE = 'places'
export const KV_STORE = 'kv'
export const KV_INDEX_NS_SAVED = 'ns_savedAt'

export function upgradeChoichariDb(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(PLACES_STORE)) db.createObjectStore(PLACES_STORE, { keyPath: 'key' })
  if (!db.objectStoreNames.contains(KV_STORE)) {
    const kv = db.createObjectStore(KV_STORE, { keyPath: 'k' })
    kv.createIndex(KV_INDEX_NS_SAVED, ['ns', 'savedAt'])
  }
}

const opened = new WeakMap<IDBFactory, Promise<IDBDatabase>>()

/**
 * DB を開く（IDBFactory ごとに 1 回だけ）。失敗・ブロック時は reject し、次の呼び出しで開き直す。
 * 別タブが新しいバージョンに上げるときは閉じて道を空ける。
 */
export function openChoichariDb(idb: IDBFactory): Promise<IDBDatabase> {
  const cached = opened.get(idb)
  if (cached) return cached
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const r = idb.open(DB_NAME, DB_VERSION)
    r.onupgradeneeded = () => upgradeChoichariDb(r.result)
    r.onsuccess = () => {
      const db = r.result
      db.onversionchange = () => {
        db.close()
        opened.delete(idb)
      }
      db.onclose = () => opened.delete(idb)
      resolve(db)
    }
    r.onerror = () => reject(r.error)
    // 古いタブが v1 を開いたままだと待たされる。キャッシュは best effort なので諦めてネットワークへ
    r.onblocked = () => reject(new Error('IndexedDB upgrade blocked'))
  })
  opened.set(idb, p)
  p.catch(() => opened.delete(idb))
  return p
}

/** テスト用: 開いた DB を閉じて忘れる */
export async function closeChoichariDb(idb: IDBFactory): Promise<void> {
  const p = opened.get(idb)
  opened.delete(idb)
  try {
    ;(await p)?.close()
  } catch {
    /* ignore */
  }
}

export function idbRequest<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/** グローバルの indexedDB（無い・触ると例外の環境では null） */
export function globalIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null
  } catch {
    return null
  }
}
