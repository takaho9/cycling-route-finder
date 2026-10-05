/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// テストは常に Asia/Tokyo（BACKLOG G2）。ワーカーは親プロセスの環境を引き継ぐ
process.env.TZ = 'Asia/Tokyo'
const live = process.env.LIVE === '1'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * GitHub Pages などサブパス配信用に base を BASE_PATH で切り替える（BACKLOG A5）。
 * 例: BASE_PATH=/cycling-route-finder/ npm run build
 */
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim()
  if (!raw) return '/'
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')
}

export default defineConfig({
  base: basePath(),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // 更新は prompt 型: 新しい版はユーザーの操作（またはホーム表示中）で適用（BACKLOG-2 C16）
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        id: './',
        name: 'ちょいチャリ — 時間でえらぶサイクリング',
        short_name: 'ちょいチャリ',
        description: '時間をえらぶだけで、ちょうどいいサイクリングの行き先を提案。Googleマップでそのまま出発。',
        lang: 'ja',
        dir: 'ltr',
        // 相対指定にして、どの base でも動くようにする（A5）
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#FF5A1F',
        background_color: '#FBF8F3',
        categories: ['health', 'sports', 'travel'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // アプリシェルのみ。外部 API の結果は JS 側（IndexedDB/localStorage）でキャッシュする。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    env: { TZ: 'Asia/Tokyo' },
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // `npm run test:live` だけ実 API スモーク（CI では実行しない, BACKLOG G3）
    include: live ? ['src/**/*.live.test.ts'] : ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: live ? [] : ['src/**/*.live.test.ts', 'node_modules/**'],
    testTimeout: live ? 60_000 : 5_000,
  },
})
