import { useEffect } from 'react'

export interface ToastMsg {
  id: number
  text: string
  /** ボタン付きトースト（例: SW 更新「更新する」）。action があるときは自動で消さない */
  action?: { label: string; onClick: () => void }
}

export function Toast({ toast, onDone }: { toast: ToastMsg | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast || toast.action) return
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [toast, onDone])
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast${toast.action ? ' toast--action' : ''}`}>
          {toast.text}
          {toast.action && (
            <button type="button" className="toast__action pressable" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
