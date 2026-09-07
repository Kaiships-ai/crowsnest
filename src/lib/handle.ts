/**
 * Instagram handle normalization — pure, dependency-free, so it can be imported from
 * both server code (`sync-engine.ts`, which re-exports it) and client components (the
 * first-run sources step) without dragging the server-only sync engine into a client
 * bundle. Single source of truth: nothing else re-implements this format check.
 *
 * Rejects the URL-as-handle mistake that put `@https://www.instagram.com/hormozi/` in
 * the live database.
 */
export function normalizeHandle(input: string): string {
  let h = input.trim();
  const urlMatch = h.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (urlMatch) h = urlMatch[1];
  if (h.startsWith("@")) h = h.slice(1);
  h = h.replace(/\/+$/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) {
    throw new Error(`Invalid Instagram handle: ${JSON.stringify(input)}`);
  }
  return `@${h}`;
}
