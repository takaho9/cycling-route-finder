import { DEFAULT_SPEED_PRESET, SPEED_PRESETS, type SpeedPresetId } from './reach'
import type { Category, Place } from './types'

const PREFIX = 'choichari:v1:'
const KEYS = {
  settings: `${PREFIX}settings`,
  rides: `${PREFIX}rides`,
  favorites: `${PREFIX}favorites`,
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
}

export const DEFAULT_SETTINGS: Settings = { speedPreset: DEFAULT_SPEED_PRESET }

export function loadSettings(storage?: Storage | null): Settings {
  const s = readJson<Partial<Settings>>(KEYS.settings, {}, storage)
  const speedPreset = s && typeof s === 'object' && s.speedPreset && s.speedPreset in SPEED_PRESETS ? s.speedPreset : DEFAULT_SETTINGS.speedPreset
  return { ...DEFAULT_SETTINGS, speedPreset }
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
}

/** Date → ローカルタイムの YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
  const rides = [...loadRides(storage), { ...ride, date: ride.date ?? toDateKey(now) }]
  writeJson(KEYS.rides, rides, storage)
  return rides
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

export const STORAGE_KEYS = KEYS
