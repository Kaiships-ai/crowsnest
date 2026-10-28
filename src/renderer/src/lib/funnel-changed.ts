import { useEffect } from 'react'

const FUNNEL_CHANGED = 'lead-studio:funnel-changed'

/** Tells a mounted Funnel board that a pull stored new numbers, so it loads them again. */
export function notifyFunnelChanged(): void {
  window.dispatchEvent(new Event(FUNNEL_CHANGED))
}

export function useOnFunnelChanged(reload: () => void): void {
  useEffect(() => {
    window.addEventListener(FUNNEL_CHANGED, reload)
    return () => window.removeEventListener(FUNNEL_CHANGED, reload)
  }, [reload])
}
