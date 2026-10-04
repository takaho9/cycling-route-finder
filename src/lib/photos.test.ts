import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import { clearPhotoCache, commonsFilePathUrl, commonsTagToUrl, fetchWikidataImageUrl, imageTagToUrl, resolvePhotoUrl } from './photos'

beforeEach(() => clearPhotoCache())

const FP = 'https://commons.wikimedia.org/wiki/Special:FilePath/'

describe('photo URL helpers', () => {
  it('commonsFilePathUrl strips prefix, underscores spaces, encodes', () => {
    expect(commonsFilePathUrl('File:Tokyo Tower 2020.jpg')).toBe(`${FP}Tokyo_Tower_2020.jpg?width=800`)
    expect(commonsFilePathUrl('皇居 外苑.jpg', 400)).toBe(`${FP}${encodeURIComponent('皇居_外苑.jpg')}?width=400`)
    expect(commonsFilePathUrl('A&B?.jpg')).toBe(`${FP}A%26B%3F.jpg?width=800`)
  })
  it('imageTagToUrl', () => {
    expect(imageTagToUrl(undefined)).toBeNull()
    expect(imageTagToUrl('https://e.test/a.jpg')).toBe('https://e.test/a.jpg')
    expect(imageTagToUrl('http://e.test/a.jpg')).toBe('https://e.test/a.jpg')
    expect(imageTagToUrl('File:X.jpg')).toBe(`${FP}X.jpg?width=800`)
    expect(imageTagToUrl('https://commons.wikimedia.org/wiki/File:Y%20Z.jpg')).toBe(`${FP}Y_Z.jpg?width=800`)
    expect(imageTagToUrl('not a url')).toBeNull()
  })
  it('commonsTagToUrl ignores categories', () => {
    expect(commonsTagToUrl('File:A.jpg')).toBe(`${FP}A.jpg?width=800`)
    expect(commonsTagToUrl('Category:Parks in Tokyo')).toBeNull()
  })
})

describe('fetchWikidataImageUrl', () => {
  const entity = (qid: string, file?: string) =>
    jsonResponse({ entities: { [qid]: { claims: file ? { P18: [{ mainsnak: { datavalue: { value: file } } }] } : {} } } })

  it('resolves P18 and caches', async () => {
    const f = mockFetch(() => entity('Q42', 'Some Photo.jpg'))
    expect(await fetchWikidataImageUrl('Q42')).toBe(`${FP}Some_Photo.jpg?width=800`)
    expect(await fetchWikidataImageUrl('q42')).toBe(`${FP}Some_Photo.jpg?width=800`)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('https://www.wikidata.org/wiki/Special:EntityData/Q42.json')
  })
  it('returns null when no P18, invalid id, or failure', async () => {
    mockFetch(() => entity('Q1'))
    expect(await fetchWikidataImageUrl('Q1')).toBeNull()
    expect(await fetchWikidataImageUrl('foo')).toBeNull()
    mockFetch(() => jsonResponse({}, 500))
    expect(await fetchWikidataImageUrl('Q2')).toBeNull()
  })
})

describe('resolvePhotoUrl priority', () => {
  it('explicit photoUrl first', async () => {
    const f = mockFetch(() => jsonResponse({}))
    expect(await resolvePhotoUrl({ photoUrl: 'https://g.test/p', tags: { image: 'https://e.test/a.jpg' } })).toBe('https://g.test/p')
    expect(f).not.toHaveBeenCalled()
  })
  it('then OSM image, then wikimedia_commons, without network', async () => {
    const f = mockFetch(() => jsonResponse({}))
    expect(await resolvePhotoUrl({ tags: { image: 'https://e.test/a.jpg', wikimedia_commons: 'File:B.jpg', wikidata: 'Q1' } })).toBe('https://e.test/a.jpg')
    expect(await resolvePhotoUrl({ tags: { wikimedia_commons: 'File:B.jpg', wikidata: 'Q1' } })).toBe(`${FP}B.jpg?width=800`)
    expect(f).not.toHaveBeenCalled()
  })
  it('then wikidata P18', async () => {
    mockFetch(() => jsonResponse({ entities: { Q7: { claims: { P18: [{ mainsnak: { datavalue: { value: 'C.jpg' } } }] } } } }))
    expect(await resolvePhotoUrl({ tags: { wikidata: 'Q7' } })).toBe(`${FP}C.jpg?width=800`)
  })
  it('else null', async () => {
    expect(await resolvePhotoUrl({ tags: {} })).toBeNull()
    expect(await resolvePhotoUrl({})).toBeNull()
  })
})
