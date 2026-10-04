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

/**
 * fetch + タイムアウト + 呼び出し元の AbortSignal 連携。
 * - 呼び出し元が abort → AbortError を throw
 * - タイムアウト → TimeoutError を throw
 * - 非 2xx → HttpError を throw
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<Response> {
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
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('Retry-After')))
    return res
  } catch (e) {
    if (timedOut) throw new TimeoutError(timeoutMs)
    if (signal?.aborted) throw abortError()
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, opts?: RequestOptions): Promise<T> {
  const res = await fetchWithTimeout(url, init, opts)
  return (await res.json()) as T
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
