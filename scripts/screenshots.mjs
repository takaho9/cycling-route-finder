// ?demo=1 を 390x844 (DPR 2) で開き、ライト/ダークで主要画面のスクリーンショットを docs/screenshots/ に保存する。
// 使い方: npm run build && npm run screenshots   （Chromium は PLAYWRIGHT_BROWSERS_PATH のものを使う）
// 環境変数: SHOT_URL=既に起動済みのURL（省略時は vite preview を起動） / SHOT_THEMES=light,dark / SHOT_ONLY=01,04
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}docs/screenshots/`
const themes = (process.env.SHOT_THEMES ?? 'light,dark').split(',')
const only = process.env.SHOT_ONLY?.split(',')
// 撮影時刻を固定（水曜 15:00 JST）。日没前・週の途中で、ストリーク等が自然に見えるように
const NOW = new Date('2026-10-07T15:00:00+09:00')
const TOKYO = { latitude: 35.6812, longitude: 139.7671 }

const ymd = (d) => d.toISOString().slice(0, 10)
const day = (offset) => ymd(new Date(NOW.getTime() + 9 * 3600_000 + offset * 86400_000))
const P = 'choichari:v1:'
const seed = {
  [`${P}rides`]: [
    { date: day(-5), placeId: 'seed:1', name: '等々力渓谷', minutes: 60, category: 'park' },
    { date: day(-4), placeId: 'seed:5', name: '珈琲 ひだまり', minutes: 45, category: 'cafe' },
    { date: day(-3), placeId: 'seed:2', name: '湯島天満宮', minutes: 45, category: 'shrine' },
    { date: day(-2), placeId: 'seed:3', name: '隅田川テラス', minutes: 30, category: 'waterside' },
    { date: day(-1), placeId: 'seed:4', name: '谷中ベーカリー', minutes: 45, category: 'bakery' },
  ],
  [`${P}departure`]: {
    placeId: 'seed:6',
    name: '晴海ふ頭公園',
    category: 'seaside',
    at: new Date(NOW.getTime() - 70 * 60_000).toISOString(),
    plannedMin: 45,
  },
  [`${P}flags`]: { welcomed: true },
}

async function startPreview() {
  if (process.env.SHOT_URL) return { url: process.env.SHOT_URL, stop: () => {} }
  const port = 4173 + Math.floor(Math.random() * 500)
  const vite = `${root}node_modules/vite/bin/vite.js`
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}/`
  const open = () =>
    new Promise((resolve) => {
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => (sock.destroy(), resolve(true)))
      sock.once('error', () => resolve(false))
    })
  for (let i = 0; i < 150 && !(await open()); i++) await new Promise((r) => setTimeout(r, 100))
  return { url, stop: () => proc.kill() }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  await mkdir(outDir, { recursive: true })
  const { url, stop } = await startPreview()
  const browser = await chromium.launch()
  try {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme: theme,
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        geolocation: TOKYO,
        permissions: ['geolocation'],
        serviceWorkers: 'block',
      })
      await context.clock.setFixedTime(NOW)
      const page = await context.newPage()
      page.on('pageerror', (e) => console.error(`[${theme}] pageerror`, e.message))
      page.on('console', (m) => m.type() === 'error' && console.error(`[${theme}] console`, m.text()))
      const shot = async (n, name) => {
        if (only && !only.includes(n)) return
        const path = `${outDir}${n}-${name}-${theme}.png`
        await page.screenshot({ path })
        console.log(path.replace(root, ''))
      }

      // 01 ホーム（記録なし・初回）
      await page.goto(`${url}?demo=1`)
      await page.locator('.dial').waitFor()
      await wait(900)
      await shot('01', 'home')

      // 02 おすすめ＋帰還カード
      await page.evaluate((s) => {
        localStorage.clear()
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v))
      }, seed)
      await page.reload()
      await page.locator('.dial').waitFor()
      await page.getByRole('button', { name: /候補を見る/ }).click()
      await page.locator('.rec-card').first().waitFor()
      await wait(700)
      await shot('02', 'recommend')

      // 03 一覧（フィルタ・並び替え）
      await page.getByRole('button', { name: /もっと見る/ }).click()
      await page.locator('.filters').waitFor()
      await page.evaluate(() => {
        const el = document.querySelector('.more__title')
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 40 })
      })
      await wait(300)
      // 少し上に戻す: 上スクロールで FAB が出る（BACKLOG-2 D4）
      await page.evaluate(() => window.scrollBy({ top: -24 }))
      await wait(800)
      await shot('03', 'list')

      // 04 詳細シート（フルに引き上げ）
      await page.evaluate(() => window.scrollTo({ top: 0 }))
      await page.locator('.rec-card').first().locator('.rec-card__open').click()
      const grab = page.locator('.sheet__grab')
      await grab.waitFor()
      await wait(400)
      await grab.click()
      await wait(900)
      await shot('04', 'detail')
      // 08 詳細シートの下側（片道/往復・走った！）
      await page.locator('.sheet__body').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
      await wait(300)
      await shot('08', 'detail-actions')
      await page.keyboard.press('Escape')
      await wait(300)

      // 05 ガチャ結果
      await page.locator('.fab').click()
      await page.getByRole('heading', { name: '今日はここ！' }).waitFor()
      await wait(1200)
      await shot('05', 'gacha')
      await page.getByRole('button', { name: 'やめとく' }).click()
      await wait(300)

      // 06 きろく
      await page.locator('.streak-badge').click()
      await page.locator('.records').waitFor()
      await wait(700)
      await shot('06', 'records')
      await page.keyboard.press('Escape')
      await wait(300)

      // 07 設定
      await page.getByRole('button', { name: '設定' }).click()
      await page.locator('.settings').waitFor()
      await wait(700)
      await shot('07', 'settings')

      await context.close()

      // 09 位置情報オフ（自動で東京駅を検索せず、出発地の選択を先に出す）
      if (!only || only.includes('09')) {
        const ctx = await browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          colorScheme: theme,
          locale: 'ja-JP',
          timezoneId: 'Asia/Tokyo',
          serviceWorkers: 'block',
        })
        await ctx.clock.setFixedTime(NOW)
        const p2 = await ctx.newPage()
        await p2.goto(`${url}?demo=1`)
        await p2.locator('.notice-card').waitFor()
        await wait(700)
        const path = `${outDir}09-nolocation-${theme}.png`
        await p2.screenshot({ path })
        console.log(path.replace(root, ''))
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
    stop()
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
