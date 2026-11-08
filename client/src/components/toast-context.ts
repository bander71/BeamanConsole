import { createContext, useContext } from 'react'

export const ToastContext = createContext<(message: string) => void>(() => {})

/** Returns a function that shows a short message at the bottom of the screen. */
export const useToast = () => useContext(ToastContext)
