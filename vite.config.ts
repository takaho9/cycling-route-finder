/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// NOTE: name / colors / icons are placeholders until docs/DESIGN.md is finalized.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'ちょいチャリ - Cycling Route Finder',
        short_name: 'ちょいチャリ',
        description: '時間を選ぶだけで、ちょうどいいサイクリング目的地を提案',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          // TODO: add icons/icon-192.png and icons/icon-512.png (required by some platforms, e.g. iOS / older Android)
        ],
      },
      workbox: {
        // App shell only. External API responses are not cached by the SW (session cache lives in JS).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    env: { TZ: 'Asia/Tokyo' },
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
