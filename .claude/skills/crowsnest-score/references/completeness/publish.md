# publish completeness

Use this rubric when scoring Completeness for the `publish` surface: the schedule-and-
auto-publish machinery behind a planned post on `/mine`, posting to the creator's real own
Instagram channel through the official Graph API.

## Category scope

- Schedule surface: attach an mp4, write a caption, pick a schedule time, and either
  schedule or publish now.
- Lifecycle states: publishing and failed added on top of the draft, scheduled, published
  states, with missed derived on read only.
- Atomic claim: a single conditional update transitions scheduled to publishing, so a
  zero-row result means another tick already claimed it and no double publish is possible.
- Claimed-flag safety: only a row that just won the claim is acted on; a stale publishing
  row from a dead process no-ops rather than risking a second post.
- Transport separation: the Graph API against the creator's own account, kept on separate
  credentials, transport, and error hierarchy from the instagrapi burner sidecar.
- Storage provider: a public-URL storage provider is required for the Graph fetch, and the
  uploaded object is deleted again after the container consumes it, on success, failure, or
  dry run.
- Honesty rule: with storage or the Graph token missing, the surface saves the video and
  caption but names what is missing and refuses to offer schedule or publish now; outside
  production the whole real path runs but skips only the final publish call.

## Completeness questions

- Can a user attach a video, write a caption, and either schedule or publish now?
- Are the publishing and failed states written correctly, with missed staying
  derived-only and never re-derived from a stored publishing or failed row?
- Does the atomic claim guarantee no double publish across a scheduler tick and a manual
  publish now?
- Does a stale publishing row from a dead process no-op instead of posting twice?
- Is the own-account Graph publish path kept fully separate from the burner instagrapi
  sidecar, in credentials, transport, and errors?
- Does the storage provider handle the public-URL fetch and delete the object afterward in
  every outcome, including dry run?
- Does the honesty rule hold: no faked publish, a clear refusal when storage or the token
  is missing, and a dry-run path that skips only the final call?
- Are the seam-only or unbuilt paths (instagrapi fallback, launchd hardening) marked as
  gaps rather than assumed done?

## Evidence

- Workflow: `publish/01-concept-brief.md`, `publish/03-feature-description.md`; the
  planned-post model in `mine/`, `documents/architect/shared/background-jobs.md`.
- Known gaps: `publish/05-backlog-to-enhance.md`; the `01` status line flags the
  instagrapi fallback as a seam only and launchd hardening as not built.
- Coverage: `publish/04-test-cases.md`, vitest for the claim and lifecycle,
  `scripts/e2e-coverage.sh`.
