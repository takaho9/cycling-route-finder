import { vi } from 'vitest'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** global fetch を差し替え、console.warn を黙らせる */
export function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => impl(String(input), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** signal が abort されるまで解決しない fetch */
export function hangingFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      reject(e)
    })
  })
}
