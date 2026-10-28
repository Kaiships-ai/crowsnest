/**
 * What one pull from an outside source (Instagram Graph, the instagrapi sidecar) brought
 * back. A pull is every call that together answers one question: a channel's profile and
 * all its media pages, one post's insights, the account's breakdown batch.
 *
 * A writer that stores a pull as current numbers (the figures boards and screens show)
 * takes `CompletePull<T>`, so handing it a partial or failed pull is a compile error. A
 * partial pull may still be logged or kept as a raw record marked failed, never as current.
 */
export type PullResult<T, R = string> =
  | { kind: "complete"; rows: T }
  /** Some calls landed, then one did not. `missing` names what never came back. */
  | { kind: "partial"; rows: T; missing: string; reason: R }
  | { kind: "failed"; reason: R };

export type CompletePull<T> = { kind: "complete"; rows: T };

/** A pull or test that failed because the source did not answer at all (down, wrong address), not because it refused. */
export class SourceDownError extends Error {}
