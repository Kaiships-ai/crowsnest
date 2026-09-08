# Learnings

One append-only log of what the build loop learned, so the next fix starts from the last
one instead of from zero. This is the project's memory between fixes: the thing that turns
"we keep breaking the same seam" from a feeling into a row you can read.

It is deliberately not a retro process, a template, or a fifth doc. It is one table. Two
skills touch it and nothing else does:

- **`fix-backlog-item`** appends one row when it opens a PR (Step 8), and reads this file
  for the component it is about to touch during seam-read (Step 2), so a repeated root
  cause is seen before the fix, not after.
- **`crowsnest-component`** appends one row per shipped component at the Phase 5 doc-sync,
  for anything the build taught that the five docs do not already carry.

Keep each row to one line. If a learning needs a paragraph, it is a doc change (fold it
into the component's `02-architecture.md`), not a learning. A learning is the short,
cross-cutting thing no single doc owns: "this seam keeps breaking for this reason", "the
guardrail mis-routed this class", "this test shape kept passing against broken code".

## What keeps breaking

| Date | Component | Class | Root cause (one line) | Fix | Guardrail note |
| --- | --- | --- | --- | --- | --- |

Columns:

- **Date**: `YYYY-MM-DD` the fix shipped.
- **Component**: the backlog board it came from, or the component shipped.
- **Class**: the corner-case taxonomy key it maps to (`empty`, `failure`, `boundary`,
  `invalid`, `concurrency`, `auth`, `stale`, `network`, `repeat`), or `logic` /
  `security` / `test` / `docs` when it is none of those.
- **Root cause**: the actual cause from systematic-debugging Phase 1, one line, not the
  symptom.
- **Fix**: the one-line fix, and the file it landed in.
- **Guardrail note**: did `fix-backlog-item`'s blast-radius guardrail route this right
  (auto vs needs-human), or did it over/under-flag? This is what lets the guardrail's
  thresholds (`5 files / 150 lines`, the surface list) be tuned from evidence instead of
  guessed. Leave `ok` when it routed correctly.

Example row (do not treat as real data): `2026-09-08 | feed | stale | keep button read the
optimistic cache before the re-read landed | await the re-read in save-post-actions.ts |
ok`.

## How to read it before a fix

At `fix-backlog-item` Step 2, grep this file for the component you are about to touch. Two
or more rows of the same Class on one component is the signal that the real fix is a shared
guard at the seam, not another per-caller patch (the ponytail root-cause rule): fix it once
where the callers route through, and say so in the new row.
