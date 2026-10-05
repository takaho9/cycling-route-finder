import { useId, useState } from 'react'
import { PRESET_ORIGINS, type GeocodeHit } from '../lib/geocode'
import type { Services } from '../lib/services'
import { loadRecentOrigins } from '../lib/storage'
import { BottomSheet } from './BottomSheet'
import type { Origin } from './types'

/**
 * 出発地の手動変更（DESIGN §3.6, BACKLOG R8）。
 * Nominatim は「確定（送信）時のみ」検索（入力補完はしない・1 秒 1 件はライブラリ側で制御）。
 */
export function OriginSheet({
  open,
  onClose,
  services,
  canLocate,
  onLocate,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  services: Services
  canLocate: boolean
  onLocate: () => void
  onChoose: (o: Origin) => void
}) {
  const inputId = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GeocodeHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const recents = open ? loadRecentOrigins() : []

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim() || busy) return
    setBusy(true)
    setFailed(false)
    try {
      setHits(await services.geocode(q))
    } catch {
      setFailed(true)
      setHits(null)
    } finally {
      setBusy(false)
    }
  }

  const pick = (h: GeocodeHit, kind: Origin['kind'] = 'manual') => {
    onChoose({ lat: h.lat, lng: h.lng, label: h.label, kind })
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="出発地をえらぶ" snap="full" className="origin">
      <form className="origin__search" role="search" onSubmit={submit}>
        <label htmlFor={inputId} className="visually-hidden">
          住所・駅名
        </label>
        <input
          id={inputId}
          type="search"
          enterKeyHint="search"
          placeholder="住所・駅名（例: 二子玉川駅）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--accent pressable" disabled={busy || !q.trim()}>
          {busy ? 'さがし中…' : 'さがす'}
        </button>
      </form>
      {failed && <p className="origin__msg">うまく探せなかった。下の駅から選ぶか、少し待ってもう一度どうぞ</p>}
      {hits && hits.length === 0 && <p className="origin__msg">見つからなかった。別の言い方でためしてみて</p>}
      {hits && hits.length > 0 && (
        <ul className="origin__list" aria-label="検索結果">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`}>
              <button type="button" className="origin__item pressable" onClick={() => pick(h)}>
                📍 {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="origin__quick">
        {canLocate && (
          <button
            type="button"
            className="origin__item pressable"
            onClick={() => {
              onLocate()
              onClose()
            }}
          >
            🎯 現在地を使う
          </button>
        )}
        <button type="button" className="origin__item pressable" onClick={() => pick(PRESET_ORIGINS[0], 'demo')}>
          🚉 東京駅（デモ）
        </button>
      </div>

      {recents.length > 0 && (
        <>
          <h3 className="origin__heading">最近つかった地点</h3>
          <ul className="origin__list">
            {recents.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button type="button" className="origin__item pressable" onClick={() => pick(r)}>
                  🕘 {r.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="origin__heading">主な駅</h3>
      <ul className="origin__list origin__list--grid">
        {PRESET_ORIGINS.map((r) => (
          <li key={r.label}>
            <button type="button" className="origin__item pressable" onClick={() => pick(r)}>
              {r.label}
            </button>
          </li>
        ))}
      </ul>
      <p className="origin__credit">地名検索: Nominatim / © OpenStreetMap contributors</p>
    </BottomSheet>
  )
}
