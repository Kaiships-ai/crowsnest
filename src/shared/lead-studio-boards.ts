export const LEAD_STUDIO_BOARDS = [
  { id: 'today', label: 'Today' },
  { id: 'funnel', label: 'Funnel' },
  { id: 'own', label: 'My channel' },
  { id: 'rivals', label: 'Rivals' },
  { id: 'plan', label: 'Plan' },
  { id: 'vault', label: 'Sources' },
  { id: 'agents', label: 'Agents' },
  { id: 'cp2gate', label: 'Gate 1 (proto)' },
  { id: 'cp2data', label: 'Data states (proto)' }
] as const

export type BoardId = (typeof LEAD_STUDIO_BOARDS)[number]['id']

export function isBoardId(value: unknown): value is BoardId {
  return LEAD_STUDIO_BOARDS.some((board) => board.id === value)
}
