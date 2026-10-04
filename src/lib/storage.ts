import { DEFAULT_SPEED_PRESET, SPEED_PRESETS, type SpeedPresetId } from './reach'
import type { Category, LatLng, Place } from './types'

const PREFIX = 'choichari:v1:'
const KEYS = {
  settings: `${PREFIX}settings`,
  rides: `${PREFIX}rides`,
  favorites: `${PREFIX}favorites`,
  recentOrigins: `${PREFIX}recentOrigins`,
  lastResult: `${PREFIX}lastResult`,
  flags: `${PREFIX}flags`,
  departure: `${PREFIX}departure`,
} as const

/** localStorage を安全に取得（プライベートモード等で例外になりうる） */
function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readJson<T>(key: string, fallback: T, storage: Storage | null = getStorage()): T {
  try {
    const raw = storage?.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** 書き込みに成功したら true */
export function writeJson(key: string, value: unknown, storage: Storage | null = getStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  speedPreset: SpeedPresetId
  /** 今週の目標回数 (1〜7) */
  weeklyGoal: number
  /** 前回選んだ往復時間 (分) */
  lastMinutes: number
}

export const DEFAULT_SETTINGS: Settings = { speedPreset: DEFAULT_SPEED_PRESET, weeklyGoal: 3, lastMinutes: 45 }

export function loadSettings(storage?: Storage | null): Settings {
  const raw = readJson<unknown>(KEYS.settings, {}, storage)
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const speedPreset =
    typeof s.speedPreset === 'string' && s.speedPreset in SPEED_PRESETS ? (s.speedPreset as SpeedPresetId) : DEFAULT_SETTINGS.speedPreset
  const weeklyGoal =
    typeof s.weeklyGoal === 'number' && s.weeklyGoal >= 1 && s.weeklyGoal <= 7 ? Math.round(s.weeklyGoal) : DEFAULT_SETTINGS.weeklyGoal
  const lastMinutes = typeof s.lastMinutes === 'number' && s.lastMinutes > 0 ? s.lastMinutes : DEFAULT_SETTINGS.lastMinutes
  return { speedPreset, weeklyGoal, lastMinutes }
}

export function saveSettings(settings: Settings, storage?: Storage | null): boolean {
  return writeJson(KEYS.settings, settings, storage)
}

// ---------------------------------------------------------------------------
// Ride records
// ---------------------------------------------------------------------------

export interface RideRecord {
  /** ローカル日付 YYYY-MM-DD */
  date: string
  placeId: string
  name: string
  /** 往復時間 (分) */
  minutes: number
  /** スタンプ表示用 */
  category?: Category
}

/** Date → ローカルタイムの YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 深夜 0〜4 時のライドは前日扱い（BACKLOG G2/A7） */
export const DAY_BOUNDARY_HOUR = 4

/** ライドの記録日（0〜4 時は前日） */
export function rideDateKey(d: Date): string {
  return toDateKey(new Date(d.getTime() - DAY_BOUNDARY_HOUR * 60 * 60 * 1000))
}

/** 記録日の前日（「昨日の分として記録」用） */
export function previousDateKey(key: string): string {
  const d = parseDateKey(key)
  return d ? toDateKey(addDays(d, -1)) : key
}

/** 「今日」（記録日基準。0〜4 時は前日）を Date で */
export function rideToday(now: Date = new Date()): Date {
  return parseDateKey(rideDateKey(now))!
}

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function isRideRecord(r: unknown): r is RideRecord {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return typeof o.date === 'string' && typeof o.placeId === 'string' && typeof o.name === 'string' && typeof o.minutes === 'number'
}

export function loadRides(storage?: Storage | null): RideRecord[] {
  const v = readJson<unknown>(KEYS.rides, [], storage)
  return Array.isArray(v) ? v.filter(isRideRecord) : []
}

export function addRide(
  ride: Omit<RideRecord, 'date'> & { date?: string },
  storage?: Storage | null,
  now: Date = new Date(),
): RideRecord[] {
  const rides = [...loadRides(storage), { ...ride, date: ride.date ?? rideDateKey(now) }]
  writeJson(KEYS.rides, rides, storage)
  return rides
}

/** placeId の今日の記録を取り消す（同日の該当記録をすべて削除） */
export function removeRide(placeId: string, date: string, storage?: Storage | null): RideRecord[] {
  const rides = loadRides(storage).filter((r) => !(r.placeId === placeId && r.date === date))
  writeJson(KEYS.rides, rides, storage)
  return rides
}

/** 指定日にその場所の記録があるか（純粋関数） */
export function hasRideOn(rides: readonly Pick<RideRecord, 'placeId' | 'date'>[], placeId: string, date: string): boolean {
  return rides.some((r) => r.placeId === placeId && r.date === date)
}

/** 過去最長の連続日数（純粋関数）。longestStreak の別名あり */
export function computeBestStreak(rides: readonly Pick<RideRecord, 'date'>[]): number {
  const days = [...new Set(rides.map((r) => r.date))]
    .map(parseDateKey)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const d of days) {
    run = prev && toDateKey(addDays(prev, 1)) === toDateKey(d) ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

/** 今週（週の開始曜日から7日）の各日に走ったかどうか。未来日は null（純粋関数） */
export function weekActivity(
  rides: readonly Pick<RideRecord, 'date'>[],
  today: Date = new Date(),
  weekStartsOn = 1,
): { date: string; rode: boolean | null }[] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = addDays(t, -((t.getDay() - weekStartsOn + 7) % 7))
  const days = new Set(rides.map((r) => r.date))
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i)
    const key = toDateKey(d)
    return { date: key, rode: d > t ? null : days.has(key) }
  })
}

/** スタンプ帳: 場所ごとに最初に訪れた記録（純粋関数、新しい順） */
export function stampsFromRides(rides: readonly RideRecord[]): RideRecord[] {
  const first = new Map<string, RideRecord>()
  for (const r of rides) {
    const prev = first.get(r.placeId)
    if (!prev || r.date < prev.date) first.set(r.placeId, r)
  }
  return [...first.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/**
 * 連続日数ストリーク（純粋関数）。
 * 今日走っていれば今日から、今日まだでも昨日走っていれば昨日から遡って数える（今日のうちは途切れない）。
 */
export function computeStreak(rides: readonly Pick<RideRecord, 'date'>[], today: Date = new Date()): number {
  const days = new Set(rides.map((r) => r.date))
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!days.has(toDateKey(cursor))) {
    cursor = addDays(cursor, -1)
    if (!days.has(toDateKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(toDateKey(cursor))) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

/**
 * 今週の走行回数（純粋関数）。週の開始曜日は weekStartsOn (0=日, 1=月; 既定 月曜)。
 * 1 日に複数回記録があればそれぞれ数える（countDistinctDays=true で日数）。
 */
export function countThisWeek(
  rides: readonly Pick<RideRecord, 'date'>[],
  today: Date = new Date(),
  { weekStartsOn = 1, countDistinctDays = false }: { weekStartsOn?: number; countDistinctDays?: boolean } = {},
): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = (t.getDay() - weekStartsOn + 7) % 7
  const start = addDays(t, -diff)
  const end = addDays(start, 7)
  const inWeek = rides.filter((r) => {
    const d = parseDateKey(r.date)
    return d !== null && d >= start && d < end
  })
  return countDistinctDays ? new Set(inWeek.map((r) => r.date)).size : inWeek.length
}

/** 訪問済み placeId 集合（純粋関数） */
export function visitedPlaceIds(rides: readonly Pick<RideRecord, 'placeId'>[]): Set<string> {
  return new Set(rides.map((r) => r.placeId))
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export interface FavoritePlace {
  id: string
  name: string
  lat: number
  lng: number
  category: Category
}

function isFavorite(v: unknown): v is FavoritePlace {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.lat === 'number' && typeof o.lng === 'number'
}

export function loadFavorites(storage?: Storage | null): FavoritePlace[] {
  const v = readJson<unknown>(KEYS.favorites, [], storage)
  return Array.isArray(v) ? v.filter(isFavorite) : []
}

/** お気に入りをトグル。トグル後の一覧を返す */
export function toggleFavorite(place: Pick<Place, 'id' | 'name' | 'lat' | 'lng' | 'category'>, storage?: Storage | null): FavoritePlace[] {
  const favs = loadFavorites(storage)
  const next = favs.some((f) => f.id === place.id)
    ? favs.filter((f) => f.id !== place.id)
    : [...favs, { id: place.id, name: place.name, lat: place.lat, lng: place.lng, category: place.category }]
  writeJson(KEYS.favorites, next, storage)
  return next
}

export const longestStreak = computeBestStreak

// ---------------------------------------------------------------------------
// Departure record → 「行ってきた？」カード（BACKLOG R7）
// ---------------------------------------------------------------------------

export interface Departure {
  placeId: string
  name: string
  category?: Category
  /** 出発（Google マップを開いた）時刻 ISO */
  at: string
  /** 予定の往復分 */
  plannedMin: number
}

export const RETURN_PROMPT_MIN_RATIO = 0.5
export const RETURN_PROMPT_MAX_HOURS = 12

export function saveDeparture(d: Departure, storage?: Storage | null): boolean {
  return writeJson(KEYS.departure, d, storage)
}

export function loadDeparture(storage?: Storage | null): Departure | null {
  const v = readJson<Departure | null>(KEYS.departure, null, storage)
  return v && typeof v.placeId === 'string' && typeof v.at === 'string' && typeof v.plannedMin === 'number' ? v : null
}

export function clearDeparture(storage?: Storage | null): void {
  try {
    ;(storage === undefined ? safeStorage() : storage)?.removeItem(KEYS.departure)
  } catch {
    /* ignore */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * 「行ってきた？」を出すか（純粋関数）: 出発から (予定分 × 0.5) 〜 12 時間。
 */
export function shouldAskReturn(d: Departure | null, now: Date = new Date()): boolean {
  if (!d) return false
  const t = Date.parse(d.at)
  if (Number.isNaN(t)) return false
  const elapsedMin = (now.getTime() - t) / 60000
  return elapsedMin >= d.plannedMin * RETURN_PROMPT_MIN_RATIO && elapsedMin <= RETURN_PROMPT_MAX_HOURS * 60
}

/** 期限切れ（12 時間超）なら true（クリーンアップ用） */
export function isDepartureExpired(d: Departure | null, now: Date = new Date()): boolean {
  if (!d) return false
  const t = Date.parse(d.at)
  return Number.isNaN(t) || now.getTime() - t > RETURN_PROMPT_MAX_HOURS * 3600_000
}

// ---------------------------------------------------------------------------
// Recent origins / last result / one-time flags
// ---------------------------------------------------------------------------

export interface SavedOrigin extends LatLng {
  label: string
}

export function loadRecentOrigins(storage?: Storage | null): SavedOrigin[] {
  const v = readJson<unknown>(KEYS.recentOrigins, [], storage)
  return Array.isArray(v)
    ? v.filter((o): o is SavedOrigin => !!o && typeof o.lat === 'number' && typeof o.lng === 'number' && typeof o.label === 'string')
    : []
}

/** 最近使った地点の先頭に追加（同一地点は重複排除、最大3件） */
export function pushRecentOrigin(origin: SavedOrigin, storage?: Storage | null): SavedOrigin[] {
  const same = (o: LatLng) => Math.abs(o.lat - origin.lat) < 1e-4 && Math.abs(o.lng - origin.lng) < 1e-4
  const next = [origin, ...loadRecentOrigins(storage).filter((o) => !same(o))].slice(0, 3)
  writeJson(KEYS.recentOrigins, next, storage)
  return next
}

/** オフライン表示用の最後の検索結果（BACKLOG Y8） */
export interface LastResult {
  origin: LatLng
  places: Place[]
  source: Place['source']
  savedAt: string
}

export function loadLastResult(storage?: Storage | null): LastResult | null {
  const v = readJson<LastResult | null>(KEYS.lastResult, null, storage)
  return v && Array.isArray(v.places) ? v : null
}

export function saveLastResult(r: LastResult, storage?: Storage | null): boolean {
  return writeJson(KEYS.lastResult, r, storage)
}

export function loadFlag(name: string, storage?: Storage | null): boolean {
  const v = readJson<Record<string, boolean>>(KEYS.flags, {}, storage)
  return !!(v && typeof v === 'object' && v[name])
}

export function setFlag(name: string, value = true, storage?: Storage | null): void {
  const v = readJson<Record<string, boolean>>(KEYS.flags, {}, storage)
  writeJson(KEYS.flags, { ...(v && typeof v === 'object' ? v : {}), [name]: value }, storage)
}

export const STORAGE_KEYS = KEYS
