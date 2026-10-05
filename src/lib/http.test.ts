import { describe, expect, it, vi } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../test/fetchMock'
import { fetchJson, fetchWithTimeout, HttpError, mapWithConcurrency, TimeoutError } from './http'

describe('fetchWithTimeout', () => {
  it('returns parsed JSON', async () => {
    mockFetch(() => jsonResponse({ ok: 1 }))
    await expect(fetchJson('https://x.test')).resolves.toEqual({ ok: 1 })
  })
  it('throws HttpError on non-2xx', async () => {
    mockFetch(() => jsonResponse({}, 503))
    await expect(fetchWithTimeout('https://x.test')).rejects.toBeInstanceOf(HttpError)
  })
  it('throws TimeoutError after timeoutMs', async () => {
    vi.useFakeTimers()
    mockFetch(hangingFetch)
    const p = fetchWithTimeout('https://x.test', {}, { timeoutMs: 1000 })
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })
  it('throws AbortError when caller aborts', async () => {
    mockFetch(hangingFetch)
    const ac = new AbortController()
    const p = fetchWithTimeout('https://x.test', {}, { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('throws immediately if already aborted', async () => {
    const f = mockFetch(() => jsonResponse({}))
    const ac = new AbortController()
    ac.abort()
    await expect(fetchWithTimeout('https://x.test', {}, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('mapWithConcurrency', () => {
  it('preserves order and limits concurrency', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
  })
})
