import { useCallback, useEffect, useState } from 'react'
import type { EngineResult } from '../../../../preload/api/crowsnest-api'

export type BoardLoadState<Row> =
  | { status: 'loading' }
  | { status: 'ready'; rows: Row[] }
  | { status: 'error'; message: string }

/** `load` must be stable (module-level): a new function each render reloads forever. */
export function useBoardLoad<Row>(load: () => Promise<EngineResult<Row[]>>): {
  state: BoardLoadState<Row>
  retry: () => void
} {
  const [state, setState] = useState<BoardLoadState<Row>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    load()
      .then((result) => {
        if (cancelled) {
          return
        }
        setState(
          result.ok
            ? { status: 'ready', rows: result.value }
            : { status: 'error', message: result.error.message }
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [load, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { state, retry }
}
