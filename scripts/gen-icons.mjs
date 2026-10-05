// SVG から PWA 用 PNG アイコンを生成する（Chromium を playwright で使う。ブラウザのダウンロードはしない）。
// 使い方: npm run icons   （PLAYWRIGHT_BROWSERS_PATH に Chromium があること）
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url))
const targets = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'maskable.svg', out: 'maskable-512.png', size: 512 },
  { src: 'icon.svg', out: 'apple-touch-icon-180.png', size: 180 },
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const t of targets) {
    const svg = await readFile(dir + t.src)
    const uri = `data:image/svg+xml;base64,${svg.toString('base64')}`
    await page.setViewportSize({ width: t.size, height: t.size })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="${uri}" width="${t.size}" height="${t.size}" style="display:block"></body></html>`,
    )
    await page.waitForFunction(() => document.getElementById('i')?.complete)
    await page.screenshot({ path: dir + t.out, clip: { x: 0, y: 0, width: t.size, height: t.size }, omitBackground: true })
    console.log(`icons/${t.out} (${t.size}x${t.size})`)
  }
} finally {
  await browser.close()
}
