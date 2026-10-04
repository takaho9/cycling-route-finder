import { useState } from 'react'
import type { PhotoInfo } from '../lib/photos'
import type { Category } from '../lib/types'
import { PhotoFallback } from './PhotoFallback'

/**
 * 写真（Commons）。未取得・失敗時はフォールバックを下に敷き、届いたらクロスフェード。
 * referrerpolicy=no-referrer / loading=lazy（BACKLOG Y5）、作者・ライセンスを小さく表示（A4）。
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
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const show = photo && !failed
  return (
    <div className="place-photo">
      <PhotoFallback category={category} id={id} />
      {show && (
        <img
          key={photo.url}
          className={`place-photo__img${loaded ? ' is-loaded' : ''}`}
          src={photo.url}
          alt={`${name}の写真`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {show && loaded && showCredit && (photo.artist || photo.license) && (
        <span className="place-photo__credit">
          📷 {[photo.artist, photo.license].filter(Boolean).join(' / ')} · Wikimedia Commons
        </span>
      )}
    </div>
  )
}
