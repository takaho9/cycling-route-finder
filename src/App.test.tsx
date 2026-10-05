import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { clearPlacesCache } from './lib/places'
import { demoServices, type Services } from './lib/services'
import { loadDeparture, loadRides, loadSettings, STORAGE_KEYS } from './lib/storage'
import { mockFetch } from './test/fetchMock'
import { mockGeolocation } from './test/geo'

/** 水曜 15:00 JST（日没前） */
const NOW = new Date('2026-10-07T15:00:00+09:00')
const now = () => NOW
const TOKYO = { lat: 35.6812, lng: 139.7671 }

/** jsdom はリンク遷移を実装していないので、外部リンクのクリックは既定動作を止める */
function preventNavigation() {
  const stop = (e: Event) => e.preventDefault()
  document.addEventListener('click', stop)
  return () => document.removeEventListener('click', stop)
}

async function openResults() {
  fireEvent.click(screen.getByRole('button', { name: /候補を見る/ }))
  await screen.findByText('今日のおすすめ')
}

beforeEach(() => {
  clearPlacesCache()
})

/** デモデータのまま、経路だけ OSRM で取れたことにする（経路距離 = 直線 × 1.25） */
const routedServices: Services = {
  ...demoServices,
  async routeDetail(origin, place) {
    const r = await demoServices.routeDetail(origin, place)
    return {
      route: { ...r.route, source: 'osrm', distanceKm: r.route.distanceKm * 1.25 },
      elevation: r.elevation && { ...r.elevation, estimated: false },
    }
  },
}

describe('App — home', () => {
  it('shows the time dial, location, sunset and the CTA', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={now} />)
    const dial = screen.getByRole('slider', { name: '往復の時間' })
    expect(dial.getAttribute('aria-valuenow')).toBe('2') // 初回は 45 分
    expect(dial.getAttribute('aria-valuetext')).toBe('45分、片道約6.0km')
    expect(screen.getByRole('heading', { name: '今日は どこまで行く？' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /現在地/ })).toBeTruthy()
    expect(screen.getByText(/日没まであと/).textContent).toMatch(/日没まであと2時間\d+分/)
    expect(screen.getByRole('button', { name: /候補を見る/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'きろく' })).toBeTruthy() // ストリーク 0 → 🚲
  })

  it('remembers the selected time (localStorage) and updates the reach text', () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={now} />)
    const dial = screen.getByRole('slider', { name: '往復の時間' })
    fireEvent.keyDown(dial, { key: 'ArrowRight' })
    expect(dial.getAttribute('aria-valuetext')).toBe('1時間、片道約8.0km')
    expect(loadSettings().lastMinutes).toBe(60)
  })

  it('location denied: does not search Tokyo automatically, offers origin choice and a demo start (Y6)', async () => {
    mockGeolocation('denied')
    render(<App services={demoServices} now={now} />)
    expect(screen.getByText('位置情報がオフみたい。出発地をえらぼう')).toBeTruthy()
    expect(screen.queryByText(/日没まで/)).toBeNull()

    // 出発地が無いときの CTA は「出発地をえらぶ →」（D15）→ 出発地シート
    expect(screen.queryByRole('button', { name: /候補を見る/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /出発地をえらぶ →/ }))
    expect(screen.getByRole('dialog', { name: '出発地をえらぶ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    fireEvent.click(screen.getByRole('button', { name: 'デモで試す（東京駅）' }))
    expect(screen.getByRole('button', { name: /東京駅（仮の出発地）/ })).toBeTruthy()
    await openResults()

    // 仮の出発地では往復 URL を使わない（A6）: 片道・origin 省略・dir_action=navigate
    const go = screen.getAllByRole('link', { name: /Googleマップで出発/ })
    expect(go).toHaveLength(3)
    for (const a of go as HTMLAnchorElement[]) {
      const u = new URL(a.href)
      expect(u.searchParams.has('origin')).toBe(false)
      expect(u.searchParams.has('waypoints')).toBe(false)
      expect(u.searchParams.get('dir_action')).toBe('navigate')
      expect(a.target).toBe('_blank')
      expect(a.rel).toContain('noopener')
    }
  })
})

describe('App — results', () => {
  it('falls back to demo data when every provider fails: demo pill once, retry, no direct departure from cards (R2/C6)', async () => {
    const f = mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    mockGeolocation(TOKYO)
    render(<App now={now} />)
    await openResults()
    expect(screen.getAllByRole('button', { name: /デモデータ/ })).toHaveLength(1) // 件数行に 1 か所だけ（D9）
    expect(screen.getByText(/件の行き先/).textContent).toMatch(/^\d+件の行き先$/)
    // カードから直接は出発させない。詳細から（注意書き付きで）
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    expect(within(recs).queryAllByRole('link', { name: /Googleマップで出発/ })).toHaveLength(0)
    fireEvent.click(within(recs).getAllByRole('button', { name: /くわしく見る/ })[0])
    const dialog = await screen.findByRole('dialog')
    const u = new URL((within(dialog).getByRole('link', { name: /Googleマップで出発/ }) as HTMLAnchorElement).href)
    // GPS の出発地なら既定は往復（origin 省略・destination=出発地・waypoints=目的地）
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.get('destination')).toBe('35.6812,139.7671')
    expect(u.searchParams.get('waypoints')).toMatch(/^\d+\.\d{6},\d+\.\d{6}$/)
    expect(within(dialog).getByText(/デモの架空の場所/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    // 再試行ボタン
    const before = f.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '実データでさがし直す' }))
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(before))
  })

  it('recommends 3 places and lets you depart straight from a card (records the departure, R7)', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={now} />)
    await openResults()
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    const cards = within(recs).getAllByRole('article')
    expect(cards).toHaveLength(3)
    const title = within(cards[0]).getByRole('heading').textContent
    const restore = preventNavigation()
    fireEvent.click(within(cards[0]).getByRole('link', { name: /Googleマップで出発/ }))
    restore()
    const d = loadDeparture()
    expect(d?.name).toBe(title)
    expect(d?.at).toBe(NOW.toISOString())
    expect(d?.plannedMin).toBeGreaterThan(0)
  })

  it('"もっと見る" shows the full list; elevation and category filters narrow it, reset restores it (M7)', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={now} />)
    await openResults()
    fireEvent.click(screen.getByRole('button', { name: /もっと見る/ }))
    const more = screen.getByRole('heading', { name: 'ぜんぶの行き先' }).closest('section')!
    const count = () => within(more).getAllByRole('article').length
    const total = count()
    expect(total).toBeGreaterThanOrEqual(20)

    fireEvent.click(within(more).getByRole('radio', { name: /平坦/ }))
    const flat = count()
    expect(flat).toBeLessThan(total)
    for (const badge of more.querySelectorAll('.card .elev-badge')) expect(badge.textContent).toContain('平坦')

    const firstCat = within(within(more).getByRole('group', { name: 'カテゴリ' })).getAllByRole('button')[0]
    fireEvent.click(firstCat)
    expect(firstCat.getAttribute('aria-pressed')).toBe('true')
    expect(count()).toBeLessThanOrEqual(flat)

    fireEvent.click(within(more).getByRole('button', { name: 'リセット' }))
    expect(count()).toBe(total)
  })

  it('opens the detail sheet from a card with a Google Maps link and a walking link', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={now} />)
    await openResults()
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    const card = within(recs).getAllByRole('article')[0]
    fireEvent.click(within(within(card).getByRole('heading')).getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /Googleマップで出発/ })).toBeTruthy()
    const walk = within(dialog).getByRole('link', { name: '徒歩で開く' }) as HTMLAnchorElement
    expect(new URL(walk.href).searchParams.get('travelmode')).toBe('walking')
    expect(within(dialog).getByRole('radio', { name: '往復でまわる' }).getAttribute('aria-checked')).toBe('true')
  })
  it('route-based elevation from the detail replaces the estimated label on the card (R3/A8)', async () => {
    mockGeolocation(TOKYO)
    render(<App services={routedServices} now={now} />)
    await openResults()
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    const card = within(recs).getAllByRole('article')[0]
    expect(card.querySelector('.elev-badge')?.textContent).toContain('≈')
    fireEvent.click(within(within(card).getByRole('heading')).getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/最大勾配/)
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(card.querySelector('.elev-badge')?.textContent).not.toContain('≈')
  })
})

describe('App — habits', () => {
  const departure = (minutesAgo: number) =>
    localStorage.setItem(
      STORAGE_KEYS.departure,
      JSON.stringify({
        placeId: 'osm:node/1',
        name: '晴海ふ頭公園',
        category: 'seaside',
        at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
        plannedMin: 45,
      }),
    )

  it('"行ってきた？" → ✓走った records the ride, gives a stamp and clears the card (R7)', async () => {
    mockGeolocation(TOKYO)
    departure(60)
    render(<App services={demoServices} now={now} />)
    expect(screen.getByRole('heading', { name: '晴海ふ頭公園、行ってきた？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '✓ 走った' }))
    expect(await screen.findByText('新しいスタンプ GET！ 晴海ふ頭公園')).toBeTruthy()
    expect(screen.queryByText(/行ってきた？/)).toBeNull()
    expect(loadRides()).toEqual([expect.objectContaining({ placeId: 'osm:node/1', date: '2026-10-07', minutes: 45 })])
    expect(loadDeparture()).toBeNull()
    expect(screen.getByRole('button', { name: 'きろく。1日連続' })).toBeTruthy()
  })

  it('"行かなかった" clears the card without recording', () => {
    mockGeolocation(TOKYO)
    departure(60)
    render(<App services={demoServices} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: '行かなかった' }))
    expect(screen.queryByText(/行ってきた？/)).toBeNull()
    expect(loadRides()).toEqual([])
    expect(loadDeparture()).toBeNull()
  })

  it('does not ask too early (before planned × 0.5)', () => {
    mockGeolocation(TOKYO)
    departure(10)
    render(<App services={demoServices} now={now} />)
    expect(screen.queryByText(/行ってきた？/)).toBeNull()
  })

  it('records sheet shows streak, this week vs goal and stamps; settings change speed and goal', () => {
    mockGeolocation(TOKYO)
    localStorage.setItem(
      STORAGE_KEYS.rides,
      JSON.stringify([
        { date: '2026-10-05', placeId: 'a', name: '等々力渓谷', minutes: 60, category: 'park' },
        { date: '2026-10-06', placeId: 'b', name: '湯島天満宮', minutes: 45, category: 'shrine' },
      ]),
    )
    render(<App services={demoServices} now={now} />)
    fireEvent.click(screen.getByRole('button', { name: 'きろく。2日連続' }))
    const rec = screen.getByRole('dialog', { name: 'きろく' })
    expect(within(rec).getByText('日連続！')).toBeTruthy()
    expect(within(rec).getByText(/今週/, { selector: '.goal' }).textContent).toMatch(/今週\s*2\s*回 \/ 目標\s*3\s*回/)
    const stamps = within(rec).getByRole('region', { name: /スタンプ帳/ })
    expect(within(stamps).getByText('等々力渓谷')).toBeTruthy()
    expect(within(stamps).getByText('湯島天満宮')).toBeTruthy()
    fireEvent.click(within(rec).getByRole('button', { name: '閉じる' }))

    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    const set = screen.getByRole('dialog', { name: '設定' })
    expect(within(set).getByRole('link', { name: '© OpenStreetMap contributors (ODbL)' })).toBeTruthy()
    expect(within(set).getByText(/Open-Meteo \(CC BY 4.0\)/)).toBeTruthy()
    expect(within(set).getByText(/広告・課金なし/)).toBeTruthy()
    fireEvent.click(within(set).getByRole('radio', { name: /速め/ }))
    fireEvent.click(within(set).getByRole('button', { name: '目標を1回ふやす' }))
    expect(loadSettings()).toMatchObject({ speedPreset: 'fast', weeklyGoal: 4 })
    act(() => {
      fireEvent.click(within(set).getByRole('button', { name: '閉じる' }))
    })
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('45分、片道約7.5km')
  })
})
