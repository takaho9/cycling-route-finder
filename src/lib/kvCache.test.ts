import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { closeChoichariDb, DB_NAME, DB_VERSION, KV_STORE, openChoichariDb, PLACES_STORE } from './idb'
import { createIndexedDbKvBackend, createKvCache, createLocalStorageKvBackend, KV_LS_PREFIX, type KvBackend } from './kvCache'
import { createIndexedDbCache } from './places/cache'

const DAY = 24 * 60 * 60 * 1000

function clock(t0 = 1_000_000) {
  let t = t0
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

const backends: [string, () => KvBackend][] = [
  ['IndexedDB', () => createIndexedDbKvBackend(new IDBFactory())],
  ['localStorage', () => createLocalStorageKvBackend(localStorage)],
]

describe.each(backends)('createKvCache (%s)', (_name, make) => {
  it('set / get / getMany, namespaces are isolated', async () => {
    const backend = make()
    const a = createKvCache<number>({ namespace: 'a', ttlMs: DAY, maxEntries: 10, backend })
    const b = createKvCache<number>({ namespace: 'b', ttlMs: DAY, maxEntries: 10, backend })
    await a.setMany([
      ['x', 1],
      ['y', 2],
    ])
    await b.set('x', 99)
    expect(await a.get('x')).toBe(1)
    expect(await a.get('nope')).toBeUndefined()
    expect([...(await a.getMany(['x', 'y', 'z', 'x']))]).toEqual([
      ['x', 1],
      ['y', 2],
    ])
    expect(await b.get('x')).toBe(99)
    await a.clear()
    expect(await a.get('x')).toBeUndefined()
    expect(await b.get('x')).toBe(99)
  })

  it('stores null values (e.g. "no photo")', async () => {
    const c = createKvCache<string | null>({ namespace: 'n', ttlMs: DAY, maxEntries: 10, backend: make() })
    await c.set('k', null)
    const m = await c.getMany(['k'])
    expect(m.has('k')).toBe(true)
    expect(m.get('k')).toBeNull()
  })

  it('expires after the TTL; ttlFor gives per-value TTL', async () => {
    const t = clock()
    const c = createKvCache<string | null>({
      namespace: 't',
      ttlMs: 30 * DAY,
      ttlFor: (v) => (v ? 30 * DAY : 3 * DAY),
      maxEntries: 10,
      backend: make(),
      now: t.now,
    })
    await c.setMany([
      ['photo', 'url'],
      ['none', null],
    ])
    t.advance(3 * DAY - 1)
    expect((await c.getMany(['photo', 'none'])).size).toBe(2)
    t.advance(2)
    expect([...(await c.getMany(['photo', 'none'])).keys()]).toEqual(['photo'])
    t.advance(27 * DAY)
    expect(await c.get('photo')).toBeUndefined()
  })

  it('keeps at most maxEntries per namespace, dropping the oldest', async () => {
    const t = clock()
    const backend = make()
    const c = createKvCache<number>({ namespace: 'm', ttlMs: DAY, maxEntries: 3, backend, now: t.now })
    const other = createKvCache<number>({ namespace: 'o', ttlMs: DAY, maxEntries: 3, backend, now: t.now })
    await other.set('keep', 1)
    for (const k of ['a', 'b', 'c', 'd', 'e']) {
      t.advance(1)
      await c.set(k, 1)
    }
    expect([...(await c.getMany(['a', 'b', 'c', 'd', 'e'])).keys()]).toEqual(['c', 'd', 'e'])
    expect(await other.get('keep')).toBe(1)
  })
})

describe('createKvCache: best effort', () => {
  it('a failing backend reads as a miss and swallows writes', async () => {
    const broken: KvBackend = {
      getMany: () => Promise.reject(new Error('boom')),
      putMany: () => Promise.reject(new Error('boom')),
      deleteMany: () => Promise.reject(new Error('boom')),
      clear: () => Promise.reject(new Error('boom')),
    }
    const c = createKvCache<number>({ namespace: 'x', ttlMs: DAY, maxEntries: 3, backend: broken })
    await expect(c.set('a', 1)).resolves.toBeUndefined()
    expect(await c.get('a')).toBeUndefined()
  })

  it('a hanging backend times out as a miss (does not block the network path)', async () => {
    const hang: KvBackend = {
      getMany: () => new Promise(() => {}),
      putMany: () => new Promise(() => {}),
      deleteMany: () => new Promise(() => {}),
      clear: () => new Promise(() => {}),
    }
    const c = createKvCache<number>({ namespace: 'x', ttlMs: DAY, maxEntries: 3, backend: hang, timeoutMs: 20 })
    expect(await c.get('a')).toBeUndefined()
  })

  it('falls back to localStorage when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const c = createKvCache<number>({ namespace: 'fb', ttlMs: DAY, maxEntries: 3 })
    await c.set('a', 7)
    expect(JSON.parse(localStorage.getItem(`${KV_LS_PREFIX}fb`)!)).toMatchObject({ a: [7, expect.any(Number), expect.any(Number)] })
    expect(await c.get('a')).toBe(7)
  })

  it('maxEntriesLocalStorage caps the localStorage fallback', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const t = clock()
    const c = createKvCache<number>({ namespace: 'cap', ttlMs: DAY, maxEntries: 100, maxEntriesLocalStorage: 2, now: t.now })
    for (const k of ['a', 'b', 'c']) {
      t.advance(1)
      await c.set(k, 1)
    }
    expect(Object.keys(JSON.parse(localStorage.getItem(`${KV_LS_PREFIX}cap`)!)).sort()).toEqual(['b', 'c'])
  })

  it('broken localStorage JSON reads as empty', async () => {
    localStorage.setItem(`${KV_LS_PREFIX}bad`, '{oops')
    const c = createKvCache<number>({ namespace: 'bad', ttlMs: DAY, maxEntries: 3, backend: createLocalStorageKvBackend(localStorage) })
    expect(await c.get('a')).toBeUndefined()
    await c.set('a', 1)
    expect(await c.get('a')).toBe(1)
  })
})

describe('IndexedDB upgrade (v1 → v2)', () => {
  it('keeps the existing places store and its data, and adds kv', async () => {
    const idb = new IDBFactory()
    // v1.1 と同じ形の DB を作る
    await new Promise<void>((resolve, reject) => {
      const r = idb.open(DB_NAME, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(PLACES_STORE, { keyPath: 'key' })
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction(PLACES_STORE, 'readwrite')
        tx.objectStore(PLACES_STORE).put({ key: 'old', savedAt: Date.now(), result: { places: [{ id: 'p1' }], errors: [], sources: [] } })
        tx.oncomplete = () => (db.close(), resolve())
        tx.onerror = () => reject(tx.error)
      }
      r.onerror = () => reject(r.error)
    })

    const db = await openChoichariDb(idb)
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual([KV_STORE, PLACES_STORE].sort())

    // 既存の places データが読める（places キャッシュ経由）
    const places = createIndexedDbCache(idb)
    expect((await places.get('old'))?.places).toEqual([{ id: 'p1' }])

    // kv も同じ DB で使える
    const kv = createKvCache<number>({ namespace: 'e', ttlMs: DAY, maxEntries: 10, backend: createIndexedDbKvBackend(idb) })
    await kv.set('a', 1)
    expect(await kv.get('a')).toBe(1)
    await closeChoichariDb(idb)

    // 開き直しても両方残る
    const again = await openChoichariDb(idb)
    expect([...again.objectStoreNames].sort()).toEqual([KV_STORE, PLACES_STORE].sort())
    expect(await kv.get('a')).toBe(1)
    expect((await places.get('old'))?.places).toEqual([{ id: 'p1' }])
    await closeChoichariDb(idb)
  })

  it('a fresh install creates both stores', async () => {
    const idb = new IDBFactory()
    const db = await openChoichariDb(idb)
    expect([...db.objectStoreNames].sort()).toEqual([KV_STORE, PLACES_STORE].sort())
    await closeChoichariDb(idb)
  })
})
