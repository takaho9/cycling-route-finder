/**
 * 既存の public/data/tokyo（生成済みタイル）に、v1.4 の品質ルールのうち「後処理で当てられるもの」を当てて
 * 別ディレクトリに書き出す（受け入れ基準を再生成前に見積もるための開発用ツール）。
 *
 *   npx tsx scripts/reapply-quality.mts --out /tmp/tokyo-v14
 *   npm run sim -- --data /tmp/tokyo-v14
 *
 * 当てられるもの（タイルに残っている情報だけで判定できるもの）:
 *   Q1 の一部（付属建物名の除外。ラベル置換・市区町村名は不可）、Q2 の一部（動物名 = attraction=animal の近似）、
 *   Q3、Q6（60m の類似名統合・公園内の吸収は size_m からの近似範囲）、Q9、Q11、Q12、Q13、Q14（商店街のみ）
 * 当てられないもの: Q1 のラベル置換・市区町村名、Q4、Q5、Q15、Q14 の shop/amenity 優先、Q2 の動物園範囲での吸収
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isAnimalName, isShoppingStreetName, isWorshipPartName } from '../src/lib/places/quality.ts'
import { photoFromStatic, type StaticIndex, type StaticRecord } from '../src/lib/places/staticData.ts'
import type { PoiDraft } from './build-poi/merge.ts'
import { buildIndex, buildTiles, writeOutput } from './build-poi/output.ts'
import { applyQualityRules, dropWeakForeignNames, mergeNearSimilar } from './build-poi/quality.ts'

const ROOT = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { data: { type: 'string', default: join(ROOT, 'public', 'data', 'tokyo') }, out: { type: 'string' } } })
if (!values.out) throw new Error('--out <dir> が必要です')
const src = resolve(values.data!)
const index = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8')) as StaticIndex
const records: StaticRecord[] = readdirSync(src)
  .filter((f) => /^t_.*\.json$/.test(f))
  .flatMap((f) => (JSON.parse(readFileSync(join(src, f), 'utf8')) as { p: StaticRecord[] }).p)

const M_PER_DEG_LAT = 111_320
const drafts: PoiDraft[] = records.map((r) => {
  const tags: Record<string, string> = { ...(r.t ?? {}) }
  let category = r.c
  if (isShoppingStreetName(r.n)) category = 'attraction' // Q14（商店街）
  const d: PoiDraft = { id: r.i, name: r.n, lat: r.y, lng: r.x, category, tags, score: r.s, ...(r.w ? { sitelinks: r.w } : {}), ...(r.p ? { photo: photoFromStatic(r.p) } : {}) }
  // Q6 の公園内吸収: タイルには leisure と範囲が無いので、公園は size_m（bbox の対角）から近似範囲を作る
  const size = Number(tags.size_m)
  if (category === 'park' && size > 0 && !r.i.startsWith('osm:node/')) {
    tags.leisure = 'park'
    const half = size / 2 / Math.SQRT2 / M_PER_DEG_LAT
    d.extent = { minlat: r.y - half, maxlat: r.y + half, minlon: r.x - half / 0.81, maxlon: r.x + half / 0.81 }
  }
  return d
})

const stats: Record<string, number> = { before: drafts.length }
let pois = drafts.filter((d) => {
  // Q1 の一部: 付属建物名（ラベル置換はできないので除外だけ）
  if (d.category === 'shrine' && isWorshipPartName(d.name, { strict: !!d.tags.wikidata })) return (stats.q1_parts = (stats.q1_parts ?? 0) + 1), false
  // Q2 の一部: 動物（attraction=animal の近似）
  if (d.category === 'attraction' && !d.tags.wikidata && isAnimalName(d.name)) return (stats.q2_animals = (stats.q2_animals ?? 0) + 1), false
  // Q12: Wikidata だけの橋は sitelinks 4 以上（タイルに heritage が無ければ）
  if (d.id.startsWith('wd:') && /橋$/.test(d.name) && (d.sitelinks ?? 0) < 4 && !d.tags.heritage) return (stats.q12_bridges = (stats.q12_bridges ?? 0) + 1), false
  return true
})
const q = applyQualityRules(pois)
pois = q.pois
Object.assign(stats, { q3_not_destination: q.stats.notDestination, q11_small_monument: q.stats.smallMonument, q13_chain: q.stats.chainByName + q.stats.chainAuto, q6_absorbed: q.stats.absorbed })
const f = dropWeakForeignNames(pois)
pois = f.pois
stats.q9_foreign = f.dropped
const m = mergeNearSimilar(pois)
pois = m.pois
stats.q6_near_merged = m.merged
stats.after = pois.length

const tiles = buildTiles(pois)
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const next = buildIndex({ tiles, coverage: index.coverage, generatedAt: index.generatedAt, sample: index.sample, osm: index.osm, stats: { ...(index.stats ?? {}), ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [`reapply_${k}`, v])) } })
writeOutput(out, tiles, next)
const cats = (ps: { category: string }[]) => ps.reduce<Record<string, number>>((a, p) => ((a[p.category] = (a[p.category] ?? 0) + 1), a), {})
console.log(JSON.stringify(stats))
console.log('before', JSON.stringify(cats(records.map((r) => ({ category: r.c })))))
console.log('after ', JSON.stringify(cats(pois)))
console.log(`→ ${out}`)
