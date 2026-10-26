const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatBoardTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}
