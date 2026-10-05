import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

/**
 * 背景のスクロールを止める（BACKLOG-2 C19）。iOS Safari は body の overflow:hidden を無視するので、
 * body を position:fixed にして今のスクロール位置で固定し、解除時に元の位置へ戻す。シートが重なっても 1 回だけ。
 */
let lockCount = 0
let savedScrollY = 0
let savedStyle: Partial<CSSStyleDeclaration> = {}
export function lockBodyScroll(): () => void {
  const body = document.body
  if (lockCount++ === 0) {
    savedScrollY = window.scrollY || 0
    savedStyle = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--lockCount > 0) return
    Object.assign(body.style, savedStyle)
    window.scrollTo?.(0, savedScrollY)
  }
}

/**
 * ボトムシート（DESIGN §3.3）。スナップ 2 段（half 60% / full 95%）、下スワイプで閉じる。
 * role=dialog aria-modal、開いたら見出しへフォーカス、Esc/✕ で閉じて元の要素へフォーカスを戻す。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  titleHidden = false,
  children,
  footer,
  snap = 'half',
  className = '',
  hero,
}: {
  open: boolean
  onClose: () => void
  title: string
  titleHidden?: boolean
  children: ReactNode
  footer?: ReactNode
  snap?: 'half' | 'full'
  className?: string
  /** 見出しより上に置く要素（写真など） */
  hero?: ReactNode
}) {
  const [level, setLevel] = useState<'half' | 'full'>(snap)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restore = useRef<Element | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    setLevel(snap)
    restore.current = document.activeElement
    const t = setTimeout(() => headingRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const unlock = lockBodyScroll()
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      unlock()
      ;(restore.current as HTMLElement | null)?.focus?.()
    }
  }, [open, snap])

  if (!open) return null

  const onDown = (e: React.PointerEvent) => {
    start.current = e.clientY
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDrag(e.clientY - start.current)
  }
  const toggle = () => setLevel((l) => (l === 'half' ? 'full' : 'half'))
  const onUp = () => {
    if (start.current === null) return
    start.current = null
    if (Math.abs(drag) < 6) toggle()
    else if (drag > 120) {
      if (level === 'full' && drag < 320) setLevel('half')
      else onClose()
    } else if (drag < -60) setLevel('full')
    setDrag(0)
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className={`sheet sheet--${level} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={drag ? { transform: `translateY(${Math.max(-40, drag)}px)`, transition: 'none' } : undefined}
      >
        <div
          className="sheet__grab"
          role="button"
          tabIndex={0}
          aria-label={level === 'half' ? 'シートを広げる' : 'シートを縮める'}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          }}
        >
          <span className="sheet__grabber" aria-hidden="true" />
        </div>
        <button type="button" className="sheet__close icon-btn pressable" onClick={onClose} aria-label="閉じる">
          <CloseIcon />
        </button>
        <div className="sheet__body">
          {hero}
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className={titleHidden ? 'visually-hidden' : 'sheet__title'}>
            {title}
          </h2>
          {children}
        </div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>
  )
}
