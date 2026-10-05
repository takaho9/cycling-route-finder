/**
 * Service Worker の更新通知（BACKLOG-2 C16: prompt 型）。main.tsx が新しい SW を見つけたら apply を登録し、
 * App はホーム表示中なら即時適用、それ以外は「新しいバージョンがあります」トーストを出す。
 */
type Apply = () => void
let pending: Apply | null = null
const listeners = new Set<() => void>()

export function setUpdateReady(apply: Apply | null): void {
  pending = apply
  listeners.forEach((l) => l())
}

export function getUpdateReady(): Apply | null {
  return pending
}

export function subscribeUpdate(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
