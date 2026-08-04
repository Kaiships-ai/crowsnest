/**
 * Typed errors for the Instagram acquisition path (design brief §7).
 *
 * Every failure that crosses the sidecar boundary arrives as
 * `{error: {code, message, retryable, detail}}` and is rehydrated into an `IgError`
 * here, so callers branch on a stable `code` rather than on message substrings — the
 * old sync engine decided retryability by regex-matching "429" out of an error string.
 */

export const IG_ERROR_CODES = [
  "IG_AUTH_REQUIRED",
  "IG_BAD_CREDENTIALS",
  "IG_TWO_FACTOR",
  "IG_CHALLENGE",
  "IG_RATE_LIMITED",
  "IG_NOT_FOUND",
  /** We called a path the sidecar does not serve, which in practice means the running
   *  sidecar is older than the app calling it. Deliberately NOT `IG_NOT_FOUND`: both are
   *  HTTP 404, but that one is a fact about Instagram a caller may reasonably skip past,
   *  while this one will fail identically on every subsequent call and needs a restart.
   *
   *  Conflating them is not hypothetical. The view count enrichment pass ran against a
   *  sidecar started two days before its endpoint existed, read every routing 404 as
   *  "that post is gone", skipped its way through the batch, and reported a blocked
   *  account. Restarting the sidecar was the fix; nothing in the logs said so. */
  "IG_ROUTE_NOT_FOUND",
  "IG_PRIVATE",
  "IG_PROXY_BLOCKED",
  "IG_NETWORK",
  "IG_ASSET_DOWNLOAD",
  "IG_DRIFT",
  "IG_SERVICE_DOWN",
  /** The sidecar rejected our shared secret. A configuration fault on our side — not an
   *  Instagram problem — and it must not be confused with an expired IG session. */
  "IG_SERVICE_UNAUTHORIZED",
  "IG_UNKNOWN",
] as const;

export type IgErrorCode = (typeof IG_ERROR_CODES)[number];

/** Codes worth trying again on their own; everything else needs a human or a code fix. */
const RETRYABLE: ReadonlySet<IgErrorCode> = new Set<IgErrorCode>([
  "IG_RATE_LIMITED",
  "IG_NETWORK",
  "IG_ASSET_DOWNLOAD",
  "IG_SERVICE_DOWN",
]);

/** Codes that mean "a human must do something in Settings before sync can work". */
const NEEDS_USER_ACTION: ReadonlySet<IgErrorCode> = new Set<IgErrorCode>([
  "IG_AUTH_REQUIRED",
  "IG_BAD_CREDENTIALS",
  "IG_TWO_FACTOR",
  "IG_CHALLENGE",
  "IG_PROXY_BLOCKED",
]);

export class IgError extends Error {
  readonly code: IgErrorCode;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown>;

  constructor(code: IgErrorCode, message: string, opts: { retryable?: boolean; detail?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "IgError";
    this.code = code;
    this.retryable = opts.retryable ?? RETRYABLE.has(code);
    this.detail = opts.detail ?? {};
  }

  get needsUserAction(): boolean {
    return NEEDS_USER_ACTION.has(this.code);
  }

  /** Message shown in the UI. Deliberately plain about what the user must do — a sync
   *  that silently produced zero rows was the failure mode this replaces. */
  get userMessage(): string {
    switch (this.code) {
      case "IG_AUTH_REQUIRED":
        return "Instagram session expired — reconnect the account in Settings.";
      case "IG_BAD_CREDENTIALS":
        return "Instagram rejected the saved credentials.";
      case "IG_TWO_FACTOR":
        return "Instagram needs a two-factor code — enter it in Settings.";
      case "IG_CHALLENGE":
        return "Instagram issued a security challenge — resolve it in Settings.";
      case "IG_RATE_LIMITED":
        return "Instagram is rate-limiting us. Sync will back off and retry.";
      case "IG_NOT_FOUND":
        return "That account or post no longer exists on Instagram.";
      case "IG_ROUTE_NOT_FOUND":
        return "The Instagram service is out of date and doesn't have this feature yet. Restart it.";
      case "IG_PRIVATE":
        return "That account is private — its posts can't be synced.";
      case "IG_PROXY_BLOCKED":
        return "The configured proxy is blocked by Instagram.";
      case "IG_NETWORK":
        return "Network error talking to Instagram.";
      case "IG_ASSET_DOWNLOAD":
        return "An image or video failed to download.";
      case "IG_DRIFT":
        return "Instagram's response no longer matches what we expect — the mapper needs updating.";
      case "IG_SERVICE_DOWN":
        return "The Instagram service isn't running. Start it with `npm run ig:service`.";
      case "IG_SERVICE_UNAUTHORIZED":
        return "The app and the Instagram service disagree about IG_SERVICE_TOKEN — check .env.local.";
      default:
        return this.message;
    }
  }
}

export function isIgErrorCode(v: unknown): v is IgErrorCode {
  return typeof v === "string" && (IG_ERROR_CODES as readonly string[]).includes(v);
}

/** Rebuilds an IgError from the sidecar's JSON error envelope. Anything that doesn't
 *  match the contract becomes IG_UNKNOWN rather than being silently discarded. */
export function fromEnvelope(body: unknown, fallbackMessage: string): IgError {
  const envelope = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof envelope !== "object" || envelope === null) {
    return new IgError("IG_UNKNOWN", fallbackMessage, { detail: { body } });
  }
  const e = envelope as { code?: unknown; message?: unknown; retryable?: unknown; detail?: unknown };
  const code = isIgErrorCode(e.code) ? e.code : "IG_UNKNOWN";
  const message = typeof e.message === "string" && e.message.length > 0 ? e.message : fallbackMessage;
  return new IgError(code, message, {
    retryable: typeof e.retryable === "boolean" ? e.retryable : undefined,
    detail: typeof e.detail === "object" && e.detail !== null ? (e.detail as Record<string, unknown>) : {},
  });
}

/** Raised when a second sync of the same channel loses the race for the DB lock. */
export class SyncAlreadyRunningError extends Error {
  readonly code = "SYNC_ALREADY_RUNNING" as const;
  constructor(readonly channelId: string | null) {
    super(channelId ? `A sync is already running for channel ${channelId}` : "A sync is already running");
    this.name = "SyncAlreadyRunningError";
  }
}
