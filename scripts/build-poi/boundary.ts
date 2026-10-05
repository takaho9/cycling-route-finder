/**
 * 対象範囲ポリゴン（東京都本土）。Overpass の境界ウェイ（out geom）からリングを組み立て、
 * 島しょ部（緯度 35.4 未満）を除き、Douglas-Peucker で間引く。
 */
import { MAINLAND_MIN_LAT, OVERPASS_AREA_FILTER } from './config'

export interface GeomWay {
  type: 'way'
  id: number
  geometry?: { lat: number; lon: number }[]
}

export function buildBoundaryQuery(timeoutS = 120): string {
  return `[out:json][timeout:${timeoutS}];rel${OVERPASS_AREA_FILTER}["boundary"="administrative"];way(r);out geom;`
}

type Pt = [number, number] // [lat, lng]
const key = (p: Pt) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`

/** 端点が一致するウェイをつないで閉じたリングにする（閉じられなかった断片は捨てる） */
export function assembleRings(ways: readonly GeomWay[]): Pt[][] {
  const segs: Pt[][] = ways
    .map((w) => (w.geometry ?? []).map((g) => [g.lat, g.lon] as Pt))
    .filter((s) => s.length >= 2)
  const used = new Array(segs.length).fill(false)
  const ends = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s[0]), key(s[s.length - 1])]) ends.set(k, [...(ends.get(k) ?? []), i])
  })
  const rings: Pt[][] = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = true
    const ring = [...segs[i]]
    for (let guard = 0; guard < segs.length && key(ring[0]) !== key(ring[ring.length - 1]); guard++) {
      const tail = key(ring[ring.length - 1])
      const j = (ends.get(tail) ?? []).find((x) => !used[x])
      if (j === undefined) break
      used[j] = true
      const s = segs[j]
      const forward = key(s[0]) === tail
      ring.push(...(forward ? s : [...s].reverse()).slice(1))
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring)
  }
  return rings
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const [y, x] = p
  const [y1, x1] = a
  const [y2, x2] = b
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(x - x1, y - y1)
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

/** Douglas-Peucker（度単位の許容誤差。0.0005° ≈ 50m） */
export function simplify(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length <= 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(points[i], points[a], points[b])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** 本土のリングだけ残して間引く（座標は小数 4 桁） */
export function mainlandRings(ways: readonly GeomWay[], tolerance = 0.0005): Pt[][] {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  return assembleRings(ways)
    .filter((ring) => ring.reduce((s, p) => s + p[0], 0) / ring.length >= MAINLAND_MIN_LAT)
    .map((ring) => {
      // 閉じたリングは始点=終点なので DP の両端が同じ点になる。最遠点で 2 分割して間引く
      const far = ring.reduce((best, p, i) => (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > Math.hypot(ring[best][0] - ring[0][0], ring[best][1] - ring[0][1]) ? i : best), 0)
      const a = simplify(ring.slice(0, far + 1), tolerance)
      const b = simplify(ring.slice(far), tolerance)
      return [...a, ...b.slice(1)].map(([y, x]) => [r4(y), r4(x)] as Pt)
    })
    .filter((ring) => ring.length >= 4)
}

export function ringsBbox(rings: readonly Pt[][]): [number, number, number, number] {
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (const ring of rings) {
    for (const [y, x] of ring) {
      s = Math.min(s, y)
      n = Math.max(n, y)
      w = Math.min(w, x)
      e = Math.max(e, x)
    }
  }
  return [s, w, n, e]
}
