export const LEAD_STUDIO_BOARDS = [
  { id: 'channels', label: 'Channels' },
  { id: 'vault', label: 'Vault' },
  { id: 'agents', label: 'Agents' }
] as const

export type BoardId = (typeof LEAD_STUDIO_BOARDS)[number]['id']

export function isBoardId(value: unknown): value is BoardId {
  return LEAD_STUDIO_BOARDS.some((board) => board.id === value)
}
