import { useEffect } from 'react'

export interface ToastMsg {
  id: number
  text: string
}

export function Toast({ toast, onDone }: { toast: ToastMsg | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [toast, onDone])
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}
    </div>
  )
}
