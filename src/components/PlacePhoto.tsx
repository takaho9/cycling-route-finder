import { useState } from 'react'
import type { PhotoInfo } from '../lib/photos'
import type { Category } from '../lib/types'
import { PhotoFallback } from './PhotoFallback'

/**
 * 写真（Commons）。未取得・失敗時はフォールバックを下に敷き、届いたらクロスフェード。
 * referrerpolicy=no-referrer / loading=lazy（BACKLOG Y5）、作者・ライセンスを小さく表示（A4）。
 * 近傍検索で見つけた写真は「付近の写真」と明記する（BACKLOG-2 C11）。
 */
export function PlacePhoto({
  id,
  name,
  category,
  photo,
  showCredit = true,
}: {
  id: string
  name: string
  category: Category
  photo: PhotoInfo | null | undefined
  showCredit?: boolean
}) {
  return (
    <div className="place-photo">
      <PhotoFallback category={category} id={id} />
      {/* 読み込み状態は写真ごと。URL が変わったら key で作り直してリセットする（C18） */}
      {photo && <PhotoImage key={photo.url} photo={photo} name={name} showCredit={showCredit} />}
    </div>
  )
}

function PhotoImage({ photo, name, showCredit }: { photo: PhotoInfo; name: string; showCredit: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const credit = [photo.artist, photo.license].filter(Boolean).join(' / ')
  return (
    <>
      <img
        className={`place-photo__img${loaded ? ' is-loaded' : ''}`}
        src={photo.url}
        alt={photo.nearby ? `${name}の付近の写真` : `${name}の写真`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {loaded && (photo.nearby || (showCredit && credit)) && (
        <span className="place-photo__credit">
          {photo.nearby && <span className="place-photo__nearby">付近の写真</span>}
          {showCredit && credit && <span>📷 {credit} · Wikimedia Commons</span>}
        </span>
      )}
    </>
  )
}
