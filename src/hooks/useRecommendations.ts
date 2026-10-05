import { useMemo, useRef } from 'react'
import { pickRecommendations } from '../lib/candidates'
import type { Place } from '../lib/types'

/**
 * 今日のおすすめ 3 件を「キー（日付+時間+出発地+速度）」で固定する（BACKLOG-2 C7）。
 * キーが同じあいだは、標高・写真の到着や「走った」記録で並びを変えない（候補から消えたときだけ選び直す）。
 */
export function useStableRecommendations(candidates: readonly Place[], key: string, visited: ReadonlySet<string>): string[] {
  const fixed = useRef<{ key: string; ids: string[] } | null>(null)
  return useMemo(() => {
    const present = new Set(candidates.map((p) => p.id))
    const cur = fixed.current
    if (cur && cur.key === key && cur.ids.length > 0 && cur.ids.every((id) => present.has(id))) return cur.ids
    const ids = pickRecommendations(candidates, { key, visited }).map((p) => p.id)
    fixed.current = { key, ids }
    return ids
  }, [candidates, key, visited])
}
