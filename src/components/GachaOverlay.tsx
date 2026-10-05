import { useEffect, useId, useRef, useState } from 'react'
import { pickGacha } from '../lib/candidates'
import type { TripEstimate } from '../lib/trip'
import { PlaceCard } from './PlaceCard'
import type { ViewPlace } from './types'

/** カプセルが割れて結果が出るまで (ms)。DESIGN §3.4: 0〜1150ms が演出、1150〜1600ms で結果がせり上がる */
export const GACHA_REVEAL_MS = 1150

const CONFETTI = Array.from({ length: 12 }, (_, i) => i)

/**
 * ガチャ演出（DESIGN §3.4 / BACKLOG-2 D3）。対象は現在のフィルタ適用後の候補。
 * - 演出中は「N件の中から…」。結果は未訪問なら NEW リボン
 * - 主ボタン「🚲 ここに決めて出発 →」で Google マップへ直行、その下に「くわしく見る」
 *   （実 API 失敗でデモに落ちているときは直行させず「くわしく見る」が主ボタン, C6）
 * - reduce-motion ではリール（カプセル）を省略して結果をフェード表示
 */
export function GachaOverlay({
  pool,
  tripOf,
  goHrefOf,
  canDepart,
  reduced,
  onGo,
  onDecide,
  onClose,
  rng = Math.random,
}: {
  pool: readonly ViewPlace[]
  tripOf: (p: ViewPlace) => TripEstimate
  goHrefOf: (p: ViewPlace) => string
  canDepart: boolean
  reduced: boolean
  /** Google マップへ出発（出発記録） */
  onGo: (p: ViewPlace) => void
  /** 詳細を開く */
  onDecide: (p: ViewPlace) => void
  onClose: () => void
  rng?: () => number
}) {
  const titleId = useId()
  const [pickedId, setPickedId] = useState<string | null>(() => pickGacha(pool, null, rng)?.id ?? null)
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<'spin' | 'result'>(reduced ? 'result' : 'spin')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restore = useRef<Element | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const picked = pool.find((p) => p.id === pickedId) ?? null

  useEffect(() => {
    restore.current = document.activeElement
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      ;(restore.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (reduced) {
      setPhase('result')
      return
    }
    setPhase('spin')
    try {
      navigator.vibrate?.([10, 60, 10])
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setPhase('result'), GACHA_REVEAL_MS)
    return () => clearTimeout(t)
  }, [round, reduced])

  useEffect(() => {
    if (phase === 'result') headingRef.current?.focus()
  }, [phase, pickedId])

  const again = () => {
    setPickedId(pickGacha(pool, pickedId, rng)?.id ?? null)
    setRound((r) => r + 1)
  }

  return (
    <div className={`gacha${reduced ? ' gacha--reduced' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="gacha__scrim" onClick={onClose} aria-hidden="true" />
      {phase === 'spin' ? (
        <div className="gacha__stage" key={`spin-${round}`}>
          <h2 id={titleId} className="visually-hidden">
            おまかせガチャ
          </h2>
          <div className="capsule" aria-hidden="true">
            <span className="capsule__rays" />
            <span className="capsule__top" />
            <span className="capsule__bottom" />
          </div>
          <div className="gacha__thinking" role="status">
            <p className="gacha__pool">
              <span className="num">{pool.length}</span>件の中から…
            </p>
            <p>どこにしよう…</p>
          </div>
        </div>
      ) : (
        <div className="gacha__result" key={`result-${round}`}>
          {!reduced && (
            <div className="confetti" aria-hidden="true">
              {CONFETTI.map((i) => (
                <span key={i} className={`confetti__bit confetti__bit--${i % 3}`} style={{ '--n': i } as React.CSSProperties} />
              ))}
            </div>
          )}
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="gacha__title">
            今日はここ！
          </h2>
          {picked && <PlaceCard place={picked} trip={tripOf(picked)} interactive={false} showNew />}
          <div className="gacha__actions">
            {picked &&
              (canDepart ? (
                <>
                  <a
                    className="btn btn--primary btn--block pressable"
                    href={goHrefOf(picked)}
                    target="_blank"
                    rel="noopener"
                    onClick={() => onGo(picked)}
                  >
                    🚲 ここに決めて出発 <span className="arrow">→</span>
                  </a>
                  <button type="button" className="btn btn--text gacha__link" onClick={() => onDecide(picked)}>
                    くわしく見る
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--primary btn--block pressable" onClick={() => onDecide(picked)}>
                  くわしく見る <span className="arrow">→</span>
                </button>
              ))}
            <button type="button" className="btn btn--secondary btn--block pressable" onClick={again} disabled={pool.length < 2}>
              もう1回 <span aria-hidden="true">🎲</span>
            </button>
            <button type="button" className="btn btn--text gacha__link gacha__cancel" onClick={onClose}>
              やめとく
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
