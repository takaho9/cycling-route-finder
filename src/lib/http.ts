export const DEFAULT_TIMEOUT_MS = 15_000

export class HttpError extends Error {
  readonly status: number
  /** Retry-After ヘッダ（秒）。無ければ undefined */
  readonly retryAfterSec?: number
  constructor(status: number, url: string, retryAfterSec?: number) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

/** Retry-After（秒 or HTTP-date）を秒に */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined
  if (/^\d+$/.test(v.trim())) return Number(v.trim())
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : Math.max(0, Math.round((t - now) / 1000))
}

export function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

/** ms 待つ（abort されたら AbortError） */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

/** p を signal の abort と競争させる（abort されたら AbortError で reject） */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/**
 * fetch ＋ 後処理（本文の読み取りなど）を、ひとつのタイムアウトと abort の下で実行する（BACKLOG-2 C14）。
 * - 呼び出し元が abort → AbortError
 * - タイムアウト（本文の読み取り中も含む）→ TimeoutError
 * - 非 2xx → HttpError
 */
export async function requestWithTimeout<T>(
  url: string,
  init: RequestInit,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw abortError()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    // 本文のストリームは fetch の signal で止まらない実装もあるので、読み取りも abort と競争させる
    return await raceAbort(
      (async () => {
        const res = await fetch(url, { ...init, signal: controller.signal })
        if (!res.ok) throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('Retry-After')))
        return read(res)
      })(),
      controller.signal,
    )
  } catch (e) {
    if (timedOut) throw new TimeoutError(timeoutMs)
    if (signal?.aborted) throw abortError()
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** fetch + タイムアウト + 呼び出し元の AbortSignal 連携（ヘッダ受信まで）。本文も読むなら fetchJson を使う */
export function fetchWithTimeout(url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<Response> {
  return requestWithTimeout(url, init, opts, async (res) => res)
}

/** JSON を取得。本文のパースが終わるまでタイムアウトと abort を維持する（C14） */
export function fetchJson<T>(url: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<T> {
  return requestWithTimeout(url, init, opts, async (res) => (await res.json()) as T)
}

/** 小さな同時実行数制限付き map */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
