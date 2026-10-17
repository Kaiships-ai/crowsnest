/**
 * Shared discriminated-union result shape and error-to-string helper for Server
 * Actions.
 *
 * Not every action module can use this: some deliberately omit the `code` field
 * (fleet-actions.ts, secrets-actions.ts, media-actions.ts...), some need a wider
 * or narrower `code` type (graph-actions.ts's `GraphErrorCode`, ig-actions.ts's
 * `Failure` with `retryable`/`needsUserAction`), and some wrap a different error
 * message entirely (analyze-actions.ts). Those stay local — this file only replaces the copies that were
 * genuinely identical to the shape below.
 */

export type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

// Not ActionResult<Record<string, never>> for no-payload actions: an object literal's
// `ok: true` can't simultaneously satisfy Record<string, never>'s index signature.
export type SimpleResult = { ok: true } | { ok: false; error: string; code?: string };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
