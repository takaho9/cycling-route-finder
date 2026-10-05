import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-800.css'
import './styles/index.css'
import App from './App'
import { setUpdateReady } from './lib/swUpdate'

// 更新は prompt 型（BACKLOG-2 C16）: 新しい SW が待機したら App に知らせ、ホーム表示中なら即時、それ以外はトーストで適用
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    setUpdateReady(() => void updateSW(true))
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/** index.html のインライン・スプラッシュを React マウント後にフェードアウト（DESIGN §7） */
function hideSplash() {
  const el = document.getElementById('splash')
  if (!el) return
  const reduced = matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    el.remove()
    return
  }
  el.classList.add('is-hidden')
  setTimeout(() => el.remove(), 400)
}
requestAnimationFrame(() => requestAnimationFrame(hideSplash))
