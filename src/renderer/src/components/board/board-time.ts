const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatBoardTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** HH:MM, for a time later today such as a retry time. */
export function formatClock(iso: string): string {
  return clockFormat.format(new Date(iso))
}
