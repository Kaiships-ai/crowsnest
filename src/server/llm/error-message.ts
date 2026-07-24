import Anthropic from "@anthropic-ai/sdk";

/**
 * Maps the typed `@anthropic-ai/sdk` error hierarchy to a friendly, user-facing
 * string — shared by every server action that calls into `LlmClient`
 * (analyze-actions.ts, remix-actions.ts) so this translation lives in exactly one
 * place (phase-3 review finding M1) instead of being reimplemented per action file.
 *
 * Checked most-specific-first per the plan's Global Constraints. `NoApiKeyError` is
 * deliberately NOT handled here — it's this app's own error, not an SDK class, and
 * every call site already gives it a feature-specific "enable X in Settings" message
 * before falling back to this helper for everything else.
 *
 * Note on the TS SDK's hierarchy (verified against
 * node_modules/@anthropic-ai/sdk/src/core/error.ts): unlike some other Anthropic
 * SDKs, there is no `APIStatusError` class here. Every HTTP-status error
 * (400/401/404/429/500/etc.) is a direct subclass of the single `Anthropic.APIError`
 * base, which itself carries `.status`/`.type`. `AuthenticationError` and
 * `RateLimitError` are two such subclasses (checked first, for the two friendliest
 * messages); `APIConnectionError` also extends `APIError` directly but carries no
 * HTTP status (it's a transport failure, not a response). The generic `APIError`
 * check below — necessarily last, since all three of the above are `instanceof` it
 * too — stands in for what the finding called "APIStatusError".
 */
export function llmErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API key invalid or revoked — check Settings";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited — retry in a moment";
  if (err instanceof Anthropic.APIConnectionError) return "Network error reaching Claude";
  if (err instanceof Anthropic.APIError) {
    return `Claude API error: ${String(err.status ?? "unknown status")} (${String(err.type ?? "unknown type")})`;
  }
  return err instanceof Error ? err.message : String(err);
}
