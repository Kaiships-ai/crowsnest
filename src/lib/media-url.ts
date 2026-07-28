/**
 * The one place a media URL is constructed, and the reason it lives in `src/lib` rather
 * than `src/server`: client components need it, so it must not drag `config`/`db` (and
 * therefore `better-sqlite3`) into a browser bundle.
 *
 * Assets are served by our own route handler from our own disk. Instagram CDN URLs are
 * signed and expire within hours, so no component may ever build a media URL any other
 * way — that regression is exactly what this rebuild removed.
 */
export function assetUrl(assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  return `/api/media/${assetId}`;
}
