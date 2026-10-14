# Learnings

One append-only log of what the build loop learned, so the next fix starts from the last
one instead of from zero. This is the project's memory between fixes: the thing that turns
"we keep breaking the same seam" from a feeling into a row you can read.

It is deliberately not a retro process, a template, or a fifth doc. It is one table. Append
one row when a fix PR opens or a component ships, and grep it for the component you are
about to touch before a fix, so a repeated root cause is seen before the fix, not after.

Keep each row to one line. If a learning needs a paragraph, it is a doc change (fold it
into the component's `02-architecture.md`), not a learning. A learning is the short,
cross-cutting thing no single doc owns: "this seam keeps breaking for this reason", "the
guardrail mis-routed this class", "this test shape kept passing against broken code".

## What keeps breaking

| Date | Component | Class | Root cause (one line) | Fix | Guardrail note |
| --- | --- | --- | --- | --- | --- |
| 2026-09-29 | mine | auth | Meta tags nearly every Graph error `type: OAuthException` (an unsupported metric is code 100, a refusal code 10), so keying auth on the type ended a measurement run before the core-set fallback | classify by HTTP 401 or code 190/102, rate limit (429, 4/17/32/613) checked first, in `src/server/graph/client.ts` | n/a, found in Phase 4 build |
| 2026-09-29 | mine | logic | `loading.tsx` streams its segment, so `redirect()` in a page under `(loaded)` arrived as a 200 with a meta refresh, not a 307 | `/mine` became a route handler, `src/app/(shell)/(loaded)/mine/route.ts`; assert the HTTP status, not the final URL | n/a, found in Phase 4 build |
| 2026-09-29 | mine | test | Browse-e2e rows sat 🟡 "would mutate the seeded db" because they were driven against a real database | per-journey seed variants in `scripts/e2e/mine-seed.ts` over a temp DB copy on a spare-port production server made every offline row runnable | n/a, Phase 4b |

Columns:

- **Date**: `YYYY-MM-DD` the fix shipped.
- **Component**: the backlog board it came from, or the component shipped.
- **Class**: the corner-case taxonomy key it maps to (`empty`, `failure`, `boundary`,
  `invalid`, `concurrency`, `auth`, `stale`, `network`, `repeat`), or `logic` /
  `security` / `test` / `docs` when it is none of those.
- **Root cause**: the actual cause, one line, not the
  symptom.
- **Fix**: the one-line fix, and the file it landed in.
- **Guardrail note**: did the review route this right (auto vs needs-human), or did it
  over/under-flag? Leave `ok` when it routed correctly.

Example row (do not treat as real data): `2026-09-08 | feed | stale | keep button read the
optimistic cache before the re-read landed | await the re-read in save-post-actions.ts |
ok`.

## How to read it before a fix

Before a fix, grep this file for the component you are about to touch. Two
or more rows of the same Class on one component is the signal that the real fix is a shared
guard at the seam, not another per-caller patch (the ponytail root-cause rule): fix it once
where the callers route through, and say so in the new row.
