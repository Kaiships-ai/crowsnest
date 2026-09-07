/**
 * Instagram handle normalization — pure, dependency-free, so it can be imported from
 * both server code (`sync-engine.ts`, which re-exports it) and client components (the
 * first-run sources step) without dragging the server-only sync engine into a client
 * bundle. Single source of truth: nothing else re-implements this format check.
 *
 * Rejects the URL-as-handle mistake that put `@https://www.instagram.com/hormozi/` in
 * the live database.
 */
const INSTAGRAM_URL_PATTERN = /instagram\.com\/([A-Za-z0-9._]+)/i;

export function normalizeHandle(input: string): string {
  let h = input.trim();
  const urlMatch = h.match(INSTAGRAM_URL_PATTERN);
  if (urlMatch) h = urlMatch[1];
  if (h.startsWith("@")) h = h.slice(1);
  h = h.replace(/\/+$/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) {
    throw new Error(`Invalid Instagram handle: ${JSON.stringify(input)}`);
  }
  return `@${h}`;
}

/**
 * True when raw input is a pasted Instagram URL rather than a bare handle.
 * `normalizeHandle` above tolerates and extracts from this shape on purpose — onboarding's
 * paste-many-handles box (`sources-step.tsx`) and the sync engine's own URL parsing
 * (`importReelByUrl`) both want a pasted URL to just work. The add-channel dialog's "By
 * handle" field wants the opposite: BEH-01 found it silently turning
 * `https://www.instagram.com/creator/` into the handle "creator" and submitting that,
 * instead of naming the paste as a typo. This lets a caller that wants the strict
 * behavior check the input shape itself, without normalizeHandle changing for everyone.
 */
export function looksLikeInstagramUrl(input: string): boolean {
  return INSTAGRAM_URL_PATTERN.test(input.trim());
}
