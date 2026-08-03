/**
 * Bridges an ISO timestamp (what the logs filter stores in the URL) and the value shape
 * a native <input type="datetime-local"> uses (YYYY-MM-DDTHH:mm, local time, no seconds,
 * no timezone). The native control gives a real calendar and time picker with no extra
 * dependency, so the logs filter stops asking a human to type an ISO string by hand.
 */
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Shift by the local offset so the wall-clock value shown matches the picker's local view.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local); // a datetime-local string is parsed as local time
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}
