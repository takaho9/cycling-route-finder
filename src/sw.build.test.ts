// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * ビルド成果物の sw.js に、都内データ（public/data/tokyo/*.json）の runtimeCaching ルートが入っていること（v1.3）。
 * precache には入れない（データが大きくなるため）。
 */
const root = join(import.meta.dirname, '..')
let outDir = ''
let sw = ''

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'choichari-build-'))
  const { build } = await import('vite')
  process.env.BASE_PATH = '/cycling-route-finder/'
  try {
    await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  } finally {
    delete process.env.BASE_PATH
  }
  // minify の有無（NODE_ENV）で書式が変わるので、空白と引用符を落として比べる
  sw = readFileSync(join(outDir, 'sw.js'), 'utf8').replace(/\s+/g, '').replace(/["']/g, '')
}, 120_000)

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

describe('service worker (build output)', () => {
  it('registers a StaleWhileRevalidate route with an entry limit for data/tokyo/*.json', () => {
    expect(sw).toContain('registerRoute(/\\/data\\/tokyo\\/(?:index|t_\\d+_\\d+)\\.json(?:\\?.*)?$/')
    expect(sw).toMatch(/StaleWhileRevalidate\(\{cacheName:choichari-data-tokyo,plugins:\[new\w*\.ExpirationPlugin/)
    expect(sw).toMatch(/ExpirationPlugin\(\{maxEntries:250/)
  })

  it('does not precache the data files, and navigation fallback skips /data/', () => {
    const precache = /precacheAndRoute\((\[.*?\])/s.exec(sw)?.[1] ?? ''
    expect(precache).toContain('index.html')
    expect(precache).not.toContain('data/tokyo')
    expect(sw).toContain('denylist:[/\\/data\\//]')
  })

  it('ships the data files next to the app (served from the same origin under BASE_PATH)', () => {
    expect(existsSync(join(outDir, 'data', 'tokyo', 'index.json'))).toBe(true)
    const index = JSON.parse(readFileSync(join(outDir, 'data', 'tokyo', 'index.json'), 'utf8')) as { tiles: Record<string, number> }
    for (const k of Object.keys(index.tiles)) expect(existsSync(join(outDir, 'data', 'tokyo', `t_${k}.json`))).toBe(true)
  })
})
