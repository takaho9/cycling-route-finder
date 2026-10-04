import { beforeEach, describe, expect, it } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../test/fetchMock'
import { clearPhotoCache, commonsFileFromTags, fetchWikidataP18, normalizeFileTitle, resolvePhotos } from './photos'

beforeEach(() => clearPhotoCache())

const thumb = (name: string) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/500px-${name}`
function imageinfo(titles: string[], extra: Record<string, unknown> = {}) {
  return {
    query: {
      pages: Object.fromEntries(
        titles.map((t, i) => [
          String(-i - 1),
          {
            title: t,
            imageinfo: [
              {
                thumburl: thumb(t.replace(/^File:/, '').replace(/ /g, '_')),
                descriptionurl: `https://commons.wikimedia.org/wiki/${t}`,
                extmetadata: { Artist: { value: '<a href="x">山田 太郎</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
              },
            ],
            ...extra,
          },
        ]),
      ),
    },
  }
}
const base = { lat: 35.68, lng: 139.76 }

describe('commonsFileFromTags (Commons only)', () => {
  it.each([
    [{ wikimedia_commons: 'File:Foo_bar.jpg' }, 'File:Foo bar.jpg'],
    [{ wikimedia_commons: 'Category:Parks' }, null],
    [{ image: 'File:X.jpg' }, 'File:X.jpg'],
    [{ image: 'https://commons.wikimedia.org/wiki/File:Y%20Z.jpg' }, 'File:Y Z.jpg'],
    [{ image: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Tokyo_Tower.jpg' }, 'File:Tokyo Tower.jpg'],
    [{ image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/T.jpg/320px-T.jpg' }, 'File:T.jpg'],
    [{ image: 'https://example.com/a.jpg' }, null],
    [{ image: 'http://shop.example/photo.png' }, null],
    [{}, null],
  ])('%o → %s', (tags, expected) => {
    expect(commonsFileFromTags(tags as Record<string, string>)).toBe(expected)
  })
  it('normalizeFileTitle', () => {
    expect(normalizeFileTitle('Image:A_b.jpg')).toBe('File:A b.jpg')
  })
})

describe('fetchWikidataP18', () => {
  it('batches up to 50 ids per request', async () => {
    const f = mockFetch((url) => {
      const ids = new URL(url).searchParams.get('ids')!.split('|')
      return jsonResponse({
        entities: Object.fromEntries(ids.map((q) => [q, { claims: q === 'Q2' ? {} : { P18: [{ mainsnak: { datavalue: { value: `${q} pic.jpg` } } }] } }])),
      })
    })
    const qids = Array.from({ length: 60 }, (_, i) => `Q${i + 1}`)
    const m = await fetchWikidataP18([...qids, 'q1', 'bogus'])
    expect(f).toHaveBeenCalledTimes(2)
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('origin')).toBe('*')
    expect(m.get('Q1')).toBe('File:Q1 pic.jpg')
    expect(m.get('Q2')).toBeNull()
    expect(m.size).toBe(60)
  })
})

describe('resolvePhotos', () => {
  it('explicit photoUrl first, without network', async () => {
    const f = mockFetch(() => jsonResponse({}))
    const m = await resolvePhotos([{ id: 'a', ...base, photoUrl: 'https://upload.wikimedia.org/x.jpg' }])
    expect(m.get('a')).toEqual({ url: 'https://upload.wikimedia.org/x.jpg' })
    expect(f).not.toHaveBeenCalled()
  })

  it('OSM commons tag → wikidata P18 → nearby; batches and keeps credits', async () => {
    const f = mockFetch((url) => {
      const u = new URL(url)
      if (u.host === 'www.wikidata.org') {
        return jsonResponse({ entities: { Q9: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Wd photo.jpg' } } }] } } } })
      }
      if (u.searchParams.get('generator') === 'geosearch') return jsonResponse(imageinfo(['File:Near.jpg']))
      const titles = u.searchParams.get('titles')!.split('|')
      return jsonResponse(imageinfo(titles))
    })
    const m = await resolvePhotos(
      [
        { id: 'a', ...base, tags: { wikimedia_commons: 'File:Tag_photo.jpg' } },
        { id: 'b', ...base, tags: { wikidata: 'Q9' } },
        { id: 'c', ...base, tags: { image: 'https://example.com/not-allowed.jpg' } },
      ],
      { width: 500 },
    )
    expect(m.get('a')).toMatchObject({ url: thumb('Tag_photo.jpg'), artist: '山田 太郎', license: 'CC BY-SA 4.0' })
    expect(m.get('b')?.url).toBe(thumb('Wd_photo.jpg'))
    expect(m.get('c')?.url).toBe(thumb('Near.jpg'))
    const imageinfoCalls = f.mock.calls.filter(([u]) => new URL(String(u)).searchParams.has('titles'))
    expect(imageinfoCalls).toHaveLength(1) // a + b in one batch
    expect(new URL(String(imageinfoCalls[0][0])).searchParams.get('iiurlwidth')).toBe('500')
    const geo = f.mock.calls.find(([u]) => new URL(String(u)).searchParams.get('generator') === 'geosearch')!
    expect(new URL(String(geo[0])).searchParams.get('ggsradius')).toBe('100')
    expect(new URL(String(geo[0])).searchParams.get('ggsnamespace')).toBe('6')
  })

  it('null when nothing found; caches the miss', async () => {
    const f = mockFetch(() => jsonResponse({ query: { pages: {} } }))
    expect((await resolvePhotos([{ id: 'z', ...base }])).get('z')).toBeNull()
    await resolvePhotos([{ id: 'z', ...base }])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('network failures degrade to null', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect((await resolvePhotos([{ id: 'y', ...base, tags: { wikidata: 'Q1' } }])).get('y')).toBeNull()
  })

  it('caller abort propagates', async () => {
    mockFetch(hangingFetch)
    const ac = new AbortController()
    const p = resolvePhotos([{ id: 'x', ...base, tags: { wikidata: 'Q1' } }], { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
