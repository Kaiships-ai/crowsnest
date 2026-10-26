import { useSyncExternalStore } from 'react'

// CP2 prototype only: throwaway variant switches, never merged.
export const CP2_DECISIONS = {
  sidebar: { label: 'Sidebar', options: ['A', 'B', 'C'] },
  gate: { label: 'Gate 1', options: ['A', 'B', 'C'] },
  mod: { label: 'Edited line', options: ['red+green', 'yellow'] },
  data: { label: 'Data states', options: ['A', 'B', 'C'] },
  chip: { label: 'Month chip', options: ['A', 'B', 'C'] },
  vault: { label: 'Sources pane', options: ['A', 'B'] }
} as const
export type Cp2Key = keyof typeof CP2_DECISIONS

const KEY = 'cp2-variants'
const listeners = new Set<() => void>()
let state: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
})()

export function setCp2(key: Cp2Key, value: string): void {
  state = { ...state, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* prototype */
  }
  listeners.forEach((l) => l())
}

export function useCp2(key: Cp2Key): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state[key] ?? CP2_DECISIONS[key].options[0]
  )
}
