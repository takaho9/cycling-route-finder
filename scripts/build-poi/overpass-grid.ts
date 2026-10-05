/**
 * Overpass フォールバック（v1.3.1）。Geofabrik / osmium が使えなかったときだけ使う。
 * 都内全域の 1 クエリは公開サーバには重すぎた（504 / 240 秒タイムアウト）ので、
 * 0.1° グリッド × カテゴリ群に分割し、間隔を空けて 1 本ずつ順に投げる。
 */
import { sleep } from '../../src/lib/http'
import { buildSelectorQuery, OVERPASS_SELECTORS, type OverpassElement, type Selector } from '../../src/lib/places/overpass'
import { pointInRings } from '../../src/lib/places/staticData'
import { MAINLAND_BBOX, OVERPASS_GRID_DEG, OVERPASS_GRID_GAP_MS, OVERPASS_GRID_TIMEOUT_S } from './config'

/** カテゴリ群（重い公園・水面と、寺社・名所、飲食を分ける） */
export function selectorGroups(selectors: readonly Selector[] = OVERPASS_SELECTORS): Selector[][] {
  const has = (s: Selector, re: RegExp) => re.test(s.filter)
  const nature = selectors.filter((s) => has(s, /"leisure"|"natural"|"tourism"="viewpoint"/))
  const food = selectors.filter((s) => !nature.includes(s) && has(s, /"amenity"="cafe"|"shop"|"ice_cream"/))
  const sights = selectors.filter((s) => !nature.includes(s) && !food.includes(s))
  return [nature, sights, food].filter((g) => g.length)
}

export interface Cell {
  s: number
  w: number
  n: number
  e: number
}

/** bbox を step 度のセルに分ける。rings があれば都内にかからないセルを除く */
export function gridCells(
  bbox: readonly [number, number, number, number] = MAINLAND_BBOX,
  step = OVERPASS_GRID_DEG,
  rings?: readonly (readonly [number, number])[][],
): Cell[] {
  const [s0, w0, n0, e0] = bbox
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  const out: Cell[] = []
  for (let s = s0; s < n0 - 1e-9; s += step) {
    for (let w = w0; w < e0 - 1e-9; w += step) {
      const c = { s: r(s), w: r(w), n: r(Math.min(s + step, n0)), e: r(Math.min(w + step, e0)) }
      if (!rings?.length || cellTouchesRings(c, rings)) out.push(c)
    }
  }
  return out
}

/** セルとリングが重なるか（セルの角・中心がリング内、またはリングの頂点がセル内） */
export function cellTouchesRings(c: Cell, rings: readonly (readonly [number, number])[][]): boolean {
  const probes = [
    { lat: c.s, lng: c.w },
    { lat: c.s, lng: c.e },
    { lat: c.n, lng: c.w },
    { lat: c.n, lng: c.e },
    { lat: (c.s + c.n) / 2, lng: (c.w + c.e) / 2 },
  ]
  if (probes.some((p) => pointInRings(p, rings))) return true
  return rings.some((ring) => ring.some(([y, x]) => y >= c.s && y <= c.n && x >= c.w && x <= c.e))
}

export function buildCellQuery(c: Cell, selectors: readonly Selector[], timeoutS = OVERPASS_GRID_TIMEOUT_S): string {
  return buildSelectorQuery(`[out:json][timeout:${timeoutS}][bbox:${c.s},${c.w},${c.n},${c.e}];`, '', [], selectors)
}

export interface GridOptions {
  cells: readonly Cell[]
  groups?: Selector[][]
  /** 1 クエリを投げる（エンドポイントの切替・再試行は呼び出し側） */
  run: (query: string) => Promise<{ elements?: OverpassElement[] }>
  gapMs?: number
  log?: (msg: string) => void
}

/** セル × カテゴリ群を順に投げ、type/id で重複を除いてまとめる。1 本でも失敗したら throw（欠けたデータを公開しない） */
export async function fetchOverpassGrid({ cells, groups = selectorGroups(), run, gapMs = OVERPASS_GRID_GAP_MS, log = () => {} }: GridOptions): Promise<OverpassElement[]> {
  const out = new Map<string, OverpassElement>()
  const total = cells.length * groups.length
  let done = 0
  for (const c of cells) {
    for (const g of groups) {
      if (done > 0 && gapMs > 0) await sleep(gapMs)
      const json = await run(buildCellQuery(c, g))
      for (const el of json.elements ?? []) {
        const k = `${el.type}/${el.id}`
        if (!out.has(k)) out.set(k, el)
      }
      done++
      if (done % 10 === 0 || done === total) log(`overpass grid: ${done}/${total} queries, ${out.size} elements`)
    }
  }
  return [...out.values()]
}
