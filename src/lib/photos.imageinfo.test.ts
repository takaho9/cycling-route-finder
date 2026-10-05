import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import { clearPhotoCache, commonsThumbUrl, fetchCommonsImageInfo, fileTitleKey, pickThumbUrl } from './photos'

/**
 * v1.3.2: 初回の本番生成（run 37286516680）で photoFiles=3468 に対し写真付き 28 件・近傍 8/300 しか取れず、
 * 付いた写真も原寸（...jpg?utm_source=...&utm_content=thumbnail_unscaled）だった不具合の再現と修正。
 * ログには通信失敗が 1 件も無く、全ファイルが「写真なし（null）」として返っていた = 応答の解釈で落としていた。
 * 旧実装は thumburl を `^https://upload.wikimedia.org/` でしか受け付けず、縮小されていない thumburl をそのまま使い、
 * imageinfo の無いページ・continue を「写真なし」と扱っていた。
 */
beforeEach(() => clearPhotoCache())

const ORIG = 'https://upload.wikimedia.org/wikipedia/commons/7/7f/%E8%92%B2%E7%94%B0%E4%B8%8D%E5%8B%95.jpg'
const UTM = '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content='
const meta = { Artist: { value: 'Yasu' }, LicenseShortName: { value: 'CC BY-SA 4.0' } }
const page = (title: string, ii: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  title,
  ...(ii ? { imageinfo: [{ descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: meta, ...ii }] } : {}),
  ...extra,
})
const respond = (...pages: object[]) => jsonResponse({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i + 1), p])) } })

describe('pickThumbUrl (which URL to embed)', () => {
  it('accepts a scaled thumburl even when protocol-relative or on another *.wikimedia.org host, and drops utm_*', () => {
    const scaled = '//upload.wikimedia.org/wikipedia/commons/thumb/7/7f/A.jpg/500px-A.jpg'
    expect(pickThumbUrl({ thumburl: scaled + UTM + 'thumbnail', url: ORIG, width: 4000 }, 500)).toBe(`https:${scaled}`)
    expect(pickThumbUrl({ thumburl: 'https://thumbs.wikimedia.org/x/500px-A.jpg', url: ORIG, width: 4000 }, 500)).toBe('https://thumbs.wikimedia.org/x/500px-A.jpg')
  })

  it('an unscaled thumburl (= original) of a large image is replaced with a real 500/960px thumbnail', () => {
    const ii = { thumburl: ORIG + UTM + 'thumbnail_unscaled', url: ORIG + UTM + 'original', width: 4032 }
    expect(pickThumbUrl(ii, 500)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/%E8%92%B2%E7%94%B0%E4%B8%8D%E5%8B%95.jpg/500px-%E8%92%B2%E7%94%B0%E4%B8%8D%E5%8B%95.jpg',
    )
    expect(pickThumbUrl(ii, 960)).toContain('/960px-')
  })

  it('a small original (≤ requested width) is used as-is, without tracking params', () => {
    expect(pickThumbUrl({ thumburl: ORIG + UTM + 'thumbnail_unscaled', url: ORIG, width: 400 }, 500)).toBe(ORIG)
  })

  it('rejects non-Wikimedia hosts', () => {
    expect(pickThumbUrl({ thumburl: 'https://example.com/a.jpg', url: 'https://example.com/a.jpg' }, 500)).toBeNull()
  })

  it('long file names use "thumbnail.<ext>" in the thumb path (MediaWiki abbreviation)', () => {
    const long = encodeURIComponent('あ'.repeat(90) + '.jpg') // 270 バイト
    expect(commonsThumbUrl(`https://upload.wikimedia.org/wikipedia/commons/a/ab/${long}`, 500)).toBe(
      `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${long}/500px-thumbnail.jpg`,
    )
  })
})

describe('fileTitleKey (matching P18 / OSM tags / API titles)', () => {
  it.each([
    ['File:Foo_bar.jpg', 'File:Foo bar.jpg'],
    ['foo bar.jpg', 'File:Foo bar.jpg'],
    ['Image:Foo  bar.jpg', 'File:Foo bar.jpg'],
    ['File:%E8%92%B2%E7%94%B0.jpg', 'File:蒲田.jpg'],
    ['File:ブランコ.jpg', 'File:ブランコ.jpg'], // NFD → NFC
  ])('%s → %s', (input, key) => expect(fileTitleKey(input)).toBe(key))
})

describe('fetchCommonsImageInfo (response handling)', () => {
  it('reproduction: scaled protocol-relative thumburl used to be dropped → now resolved', async () => {
    mockFetch(() => respond(page('File:A.jpg', { thumburl: '//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg', url: '//upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg', width: 3000 })))
    const m = await fetchCommonsImageInfo(['File:A.jpg'], 500)
    expect(m.get('File:A.jpg')).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg',
      artist: 'Yasu',
      license: 'CC BY-SA 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
    })
  })

  it('keys the result by the caller’s own spelling even when the API answers with a canonical title (no "normalized" entry)', async () => {
    mockFetch(() => respond(page('File:Foo bar.jpg', { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/500px-Foo_bar.jpg', url: 'x', width: 3000 })))
    const m = await fetchCommonsImageInfo(['File:foo_bar.jpg', 'File:Foo bar.jpg'], 500)
    expect(m.get('File:foo_bar.jpg')?.url).toContain('500px-Foo_bar.jpg')
    expect(m.get('File:Foo bar.jpg')?.url).toContain('500px-Foo_bar.jpg')
  })

  it('follows file redirects (renamed files) back to the requested name', async () => {
    const f = mockFetch(() =>
      jsonResponse({
        query: {
          redirects: [{ from: 'File:Old name.jpg', to: 'File:New name.jpg' }],
          pages: { 1: page('File:New name.jpg', { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/n/nn/New_name.jpg/500px-New_name.jpg', url: 'x', width: 3000 }) },
        },
      }),
    )
    const m = await fetchCommonsImageInfo(['File:Old_name.jpg'], 500)
    expect(String(f.mock.calls[0][0])).toContain('redirects=1')
    expect(m.get('File:Old_name.jpg')?.url).toContain('500px-New_name.jpg')
  })

  it('follows "continue" when imageinfo is split over several responses', async () => {
    const f = mockFetch((url) =>
      url.includes('iicontinue')
        ? respond(page('File:A.jpg', null), page('File:B.jpg', { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/B.jpg/500px-B.jpg', url: 'x', width: 999 }))
        : jsonResponse({
            continue: { iicontinue: 'B.jpg|20200101', continue: '||' },
            query: { pages: { 1: page('File:A.jpg', { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg', url: 'x', width: 999 }), 2: page('File:B.jpg', null) } },
          }),
    )
    const m = await fetchCommonsImageInfo(['File:A.jpg', 'File:B.jpg'], 500)
    expect(f).toHaveBeenCalledTimes(2)
    expect(m.get('File:A.jpg')?.url).toContain('500px-A.jpg')
    expect(m.get('File:B.jpg')?.url).toContain('500px-B.jpg')
  })

  it('missing file → null (no photo); page without imageinfo → absent (unknown, retry later)', async () => {
    mockFetch(() => respond(page('File:Gone.jpg', null, { missing: '' }), page('File:Later.jpg', null)))
    const m = await fetchCommonsImageInfo(['File:Gone.jpg', 'File:Later.jpg'], 500)
    expect(m.get('File:Gone.jpg')).toBeNull()
    expect(m.has('File:Later.jpg')).toBe(false)
  })

  it('keeps request URLs short (Japanese file names) by splitting batches', async () => {
    const f = mockFetch(() => respond())
    const titles = Array.from({ length: 50 }, (_, i) => `File:${'東京都立公園の写真'.repeat(3)}${i}.jpg`)
    await fetchCommonsImageInfo(titles, 500)
    expect(f.mock.calls.length).toBeGreaterThan(1)
    for (const c of f.mock.calls) expect(String(c[0]).length).toBeLessThan(8_000)
  })
})
