import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-800.css'
import './styles/index.css'
import App from './App'

registerSW({ immediate: true })

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
