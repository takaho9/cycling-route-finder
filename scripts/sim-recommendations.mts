/**
 * 提案品質のシミュレーション（BACKLOG-3 の受け入れ基準を自動集計）。
 *
 *   npm run sim                       # public/data/tokyo を使う
 *   npm run sim -- --data <dir>       # 別のデータ（例: 後処理を当てた一時データ）
 *   npm run sim -- --verbose          # 各シナリオのおすすめ・候補を全部表示
 *   npm run sim -- --json out.json    # 集計を JSON でも書き出す
 *
 * アプリと同じ経路（static プロバイダ → searchPlaces → selectCandidates → pickRecommendations）を通す。
 * fetch を差し替えてデータディレクトリのファイルを返すだけで、ネットワークには出ない。
 * 条件: 新宿 / 吉祥寺 / 錦糸町 / 二子玉川 / 八王子 × 30・60・90 分、16km/h、日付 2026-10-05（日替わりの固定）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: join(ROOT, 'public', 'data', 'tokyo') },
    verbose: { type: 'boolean', default: false },
    json: { type: 'string' },
    date: { type: 'string', default: '2026-10-05' },
  },
})
const DATA = resolve(args.data!)

;(globalThis as { fetch: typeof fetch }).fetch = async (url: RequestInfo | URL) => {
  const name = String(url).split('?')[0].split('/').pop()!
  try {
    return new Response(readFileSync(join(DATA, name), 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

const { searchPlaces } = await import('../src/lib/places/index.ts')
const { createStaticProvider } = await import('../src/lib/places/static.ts')
const { selectCandidates, pickRecommendations, recommendationKey } = await import('../src/lib/candidates.ts')
const { attractiveness } = await import('../src/lib/places/sampling.ts')
const { haversineKm } = await import('../src/lib/geo.ts')
const { isGenericName, isWorshipPartName, isAnimalName, isNotDestination } = await import('../src/lib/places/quality.ts')
type Place = import('../src/lib/types.ts').Place

const ORIGINS: [string, number, number][] = [
  ['新宿駅', 35.6896, 139.7006],
  ['吉祥寺駅', 35.7031, 139.5798],
  ['錦糸町駅', 35.6966, 139.814],
  ['二子玉川駅', 35.6115, 139.6267],
  ['八王子駅', 35.6556, 139.3389],
]
const MINUTES = [30, 60, 90]
const KMH = 16
const FOOD = new Set(['cafe', 'bakery', 'sweets'])

const hasPhoto = (p: Place) => !!p.photoEmbed
const fmt = (p: Place) =>
  `${p.name} [${p.category}] ${p.distanceKm.toFixed(2)}km ${p.photoEmbed ? (p.photoEmbed.nearby ? '写真(付近)' : '写真') : '-'} s=${p.score ?? attractiveness(p)}${p.tags?.wikidata ? ' ' + p.tags.wikidata : ''} (${p.id})`

/** 「出してはいけない名前」の種類 */
function badKind(p: Place): string | null {
  if (p.category === 'shrine' && isWorshipPartName(p.name)) return '付属建物名'
  if (isGenericName(p.name)) return '汎用名'
  if (!FOOD.has(p.category) && isAnimalName(p.name)) return '動物名'
  if (isNotDestination(p.name, p.tags?.wikidata)) return '目的地でない'
  return null
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
/** 50m 以内の別名の組（少なくとも一方が飲食以外。隣り合う別々の店は正当なので数えない） */
function nearPairs(ps: readonly Place[]): string[] {
  const out: string[] = []
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]
      const b = ps[j]
      if (norm(a.name) === norm(b.name) || (FOOD.has(a.category) && FOOD.has(b.category))) continue
      if (haversineKm(a, b) <= 0.05) out.push(`${a.name} ⇔ ${b.name}`)
    }
  return out
}

interface Row {
  origin: string
  minutes: number
  cands: number
  candPhoto: number
  recs: string[]
  recPhoto: number
  recScore0: number
  partialCoverage?: number
}
const rows: Row[] = []
const bad = new Map<string, { kind: string; where: Set<string> }>()
let pairCount = 0
const pairSamples = new Set<string>()
let recTotal = 0
let recPhoto = 0
let recScore0 = 0

for (const [name, lat, lng] of ORIGINS) {
  const origin = { lat, lng }
  const res = await searchPlaces(origin, { providers: [createStaticProvider({ baseUrl: '/data/tokyo/' })], useCache: false, speedKmh: KMH })
  if (args.verbose) console.log(`\n######## ${name} (all in search radius: ${res.places.length}, source=${res.source})`)
  for (const m of MINUTES) {
    const cands = selectCandidates(res.places, m, KMH, undefined, { dateKey: args.date })
    const key = recommendationKey({ dateKey: args.date!, minutes: m, origin, speedKmh: KMH })
    const recs = pickRecommendations(cands, { key, visited: new Set() })
    for (const p of cands) {
      const k = badKind(p)
      if (!k) continue
      const e = bad.get(`${p.name}|${p.id}`) ?? { kind: k, where: new Set<string>() }
      e.where.add(recs.includes(p) ? `${name}${m}分(おすすめ)` : `${name}${m}分`)
      bad.set(`${p.name}|${p.id}`, e)
    }
    const pairs = nearPairs(cands)
    pairCount += pairs.length
    pairs.forEach((p) => pairSamples.add(p))
    recTotal += recs.length
    recPhoto += recs.filter(hasPhoto).length
    recScore0 += recs.filter((p) => attractiveness(p) <= 0).length
    rows.push({
      origin: name,
      minutes: m,
      cands: cands.length,
      candPhoto: cands.filter(hasPhoto).length,
      recs: recs.map((p) => p.name),
      recPhoto: recs.filter(hasPhoto).length,
      recScore0: recs.filter((p) => attractiveness(p) <= 0).length,
      partialCoverage: res.partialCoverage,
    })
    if (args.verbose) {
      console.log(`\n=== ${name} ${m}分  cands=${cands.length} photo=${cands.filter(hasPhoto).length}`)
      console.log('  RECS:')
      for (const p of recs) console.log('   * ' + fmt(p))
      console.log('  CANDS:')
      for (const p of cands) console.log('     . ' + fmt(p))
    }
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : '-')
console.log(`\nデータ: ${DATA}`)
console.log('\n| 出発地 | 分 | 候補 | 候補の写真 | おすすめ | 写真 | スコア0 |')
console.log('|---|---|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.origin} | ${r.minutes} | ${r.cands} | ${r.candPhoto} | ${r.recs.join(' / ')} | ${r.recPhoto}/3 | ${r.recScore0} |`)

const badList = [...bad.entries()]
const badInRecs = badList.filter(([, v]) => [...v.where].some((w) => w.includes('おすすめ')))
const criteria = [
  { name: 'おすすめ3件の写真付き率', value: pct(recPhoto, recTotal), target: '90%以上', ok: recPhoto / recTotal >= 0.9 },
  { name: 'おすすめにスコア0が出る率', value: pct(recScore0, recTotal), target: '0%', ok: recScore0 === 0 },
  { name: '汎用名・付属建物名・動物名・立入不可（候補）', value: `${badList.length}件（うちおすすめ ${badInRecs.length}）`, target: '0件', ok: badList.length === 0 },
  { name: '50m 以内の別名重複（飲食どうしを除く、全シナリオ合計）', value: `${pairCount}組`, target: '5組以下', ok: pairCount <= 5 },
]
console.log('\n## 受け入れ基準（BACKLOG-3）')
console.log('| 基準 | 結果 | 目標 | 判定 |')
console.log('|---|---|---|---|')
for (const c of criteria) console.log(`| ${c.name} | ${c.value} | ${c.target} | ${c.ok ? 'OK' : 'NG'} |`)
if (badList.length) {
  console.log('\n出してはいけない名前:')
  for (const [k, v] of badList) console.log(`  - [${v.kind}] ${k.split('|')[0]} … ${[...v.where].join(', ')}`)
}
if (pairSamples.size) {
  console.log('\n50m 以内の別名重複:')
  for (const p of pairSamples) console.log(`  - ${p}`)
}
const partial = rows.filter((r) => (r.partialCoverage ?? 0) >= 0.3)
if (partial.length) console.log(`\n都外が 30% 以上の出発地: ${[...new Set(partial.map((r) => r.origin))].join(', ')}`)
if (args.json) writeFileSync(args.json, JSON.stringify({ data: DATA, rows, criteria, bad: badList.map(([k, v]) => ({ name: k, kind: v.kind, where: [...v.where] })), pairs: [...pairSamples] }, null, 1))
