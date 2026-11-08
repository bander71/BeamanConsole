import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext } from './toast-context.ts'

/** Shows short messages at the bottom of the screen, like the prototype's toast. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((msg: string) => {
    setMessage(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 3200)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite" hidden={!message}>
        {message}
      </div>
    </ToastContext.Provider>
  )
}
