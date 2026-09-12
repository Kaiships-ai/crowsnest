---
name: fix-backlog-item
description: Use to take one open bug row from a component backlog board through a branch, a failing test, a root caused fix, and a pull request, gated by a blast radius guardrail that keeps risky surfaces in human review instead of merging on autopilot. Trigger:/fix-backlog-item
disable-model-invocation: true
---

# fix-backlog-item

Orchestrator. Pick one open bug row, delegate the fix to the ship-* skills, and add the
repo-specific parts: the row pick, the seam read, a self-review, and the blast-radius guardrail.

Never merge. Every path ends at an open PR and a backlog row status flip, nothing more.

## Composition

| Step | Owned by | Skill called |
| --- | --- | --- |
| Pick the row | this skill | `scripts/next-bug.sh` |
| Read the seam | this skill | none |
| Isolate the workspace | reuse | `ship:using-git-worktrees` |
| Root cause, failing test first, fix | reuse | `ship:systematic-debugging` |
| Verify | reuse | `ship:verification-before-completion` |
| Self-review the diff | this skill | `caveman:cavecrew-reviewer` (sub-agent) |
| Blast radius guardrail, PR, row status | this skill | none |

## Step 1: pick the row

Select the next bug to fix.

- Run `bash scripts/next-bug.sh`. Take the top line, unless the human named a specific ID.
- Each line has six fields: `component ID severity verify source title`. Keep all six; later steps read them.

## Step 2: read the seam

Find the file that owns the bug before opening a worktree.

- Read the row's Source cell. It names where the bug was found: `bug-triage`, `observed-bugs`, a test note, or a file.
- Read the component's `02-architecture.md` module table for the file that owns the behavior.
- Skim `04-test-cases.md` for an existing case to extend, not duplicate.
- Grep `documents/learnings.md` for this component. Two or more rows of the same Class means fix the shared seam once, not per caller.

**Output:** the owning file. The Step 4 test targets it; the Step 7 file list is checked against it.

## Step 3: isolate the workspace

Work in an isolated branch.

- Call `ship:using-git-worktrees`. Branch `fix/<component>-<id>`, lowercased, for example `fix/feed-b-05`.

## Step 4: root cause, failing test first, fix

Find the root cause, prove it with a failing test, then fix only that.

- Call `ship:systematic-debugging`. Finish Phase 1 and Phase 2 before any fix code. Its Iron Law holds here without exception.
- Write the failing test first, picked by the row's verify method (table below).
- Confirm the test fails for the reason in the row's title, not an unrelated one.
- Fix the root cause from Phase 1. One change, no riding refactor.
- Three files or fewer: skip `ship:writing-plans`, go test to fix. More than that: call `ship:writing-plans`.

| verify | Write |
| --- | --- |
| `vitest` (server, lib, route, action) | a vitest test by the owning file that reproduces the title as a failing assertion |
| `browse` (UI, a `.tsx` source, or a title about what shows/renders/overlays) | a `scripts/e2e/` journey driven by `data-testid` that reproduces the failure end to end |

## Step 5: verify

Prove the fix with fresh output.

- Call `ship:verification-before-completion`.
- Run `npm test && npm run typecheck` and read the output.
- Claim "fixed" only with that fresh output, never a memory of an earlier run.

## Step 6: self-review the diff

A second agent reviews the diff, so the human receives a verdict to spot-check, not a cold diff to audit.

- Spawn a fresh `caveman:cavecrew-reviewer` sub-agent (fallback `general-purpose`). Do not review your own work in the context that wrote it.
- Give it `git diff <base-branch>...HEAD`, the row (ID, title, source), and the root cause from Step 4.
- Ask one pass across four lenses (table below). Collect the findings verbatim.
- Handle the findings by severity (second table below).

| Lens | Ask |
| --- | --- |
| correctness | does it fix the row's root cause and only that? any corner path the new test misses? |
| over-fix | a riding refactor, an unrelated rename, or scope past the one row |
| security | an unvalidated trust-boundary input, a logged secret or token, raw SQL or shell built from untrusted data |
| test quality | does the test fail for the row's reason and assert the symptom, or is it a tautology that passes against the unfixed code? |

| Finding | Action |
| --- | --- |
| blocker or high | not shippable. Return to `ship:systematic-debugging`, fix, re-run Step 5, re-review |
| medium or low | does not block. Write each into the PR body self-review section (Step 8) |
| clean | state it clean in the PR body, with the reviewer's summary line |

The verdict never overrides Step 7: a clean review still routes to needs-human if it touches a guarded surface.

## Step 7: the blast radius guardrail

Decide auto-PR versus human-review, computed from the real diff.

- Run `git diff --stat <base-branch>...HEAD`. Decide from it, never from a guess.

| Route | When |
| --- | --- |
| auto-eligible | ALL hold: Type is `bug`; five files or fewer and roughly 150 lines or fewer; every changed file under `src/lib`, `src/server/queries`, `src/components`, or `src/app`; the diff includes the Step 4 test file |
| needs-human | ANY holds: the diff touches `src/cli`, `packaging`, `src/server/db`, `services/ig`, any `.env*`, or `src/cli/service-darwin.ts`; Type is `enhancement`; or it fails any auto-eligible condition |

The surface list overrides size and directory. One file under `src/server/db` is needs-human even when everything else is auto-eligible.

## Step 8: open the PR, flip the row, never merge

Open the PR the human reads, flip the row, then stop.

- Push: `git push -u origin fix/<component>-<id>`.
- Open the PR by route (table below). If the label does not exist yet, create it first with `gh label create <label>`.
- Write the four-section body (below).
- Append one `documents/learnings.md` row (below).
- Stop at the open PR. Merging, and the `in-review` to `done` move, are the human's decision.

| Route | Command | Row status | Body extra |
| --- | --- | --- | --- |
| auto-eligible | `gh pr create --title "fix(<component>): <title>" --label auto-fix` | `done` | none |
| needs-human | `gh pr create --draft --title "fix(<component>): <title>" --label needs-human` | `in-review` | one line naming which guardrail condition tripped |

Body, four sections in order:

1. **Row**: the ID, title, and source.
2. **Root cause**: the cause from Step 4 (one paragraph) and the one-line fix.
3. **Self-review**: the Step 6 verdict, `clean` or each medium/low finding verbatim with its severity tag; say so if any was fixed and re-reviewed.
4. **Verification**: the fresh `npm test` and `npm run typecheck` output from Step 5, and the `test-shots/` path for a browse row (embed the image if the row is UI).

Learnings row: date, this component, the Class, the one-line root cause, the one-line fix and its file, and the guardrail note (`ok`, or how it over/under-flagged). One line only; a learning that needs a paragraph is a change to `02-architecture.md`.

## If something goes wrong

| If | Do |
| --- | --- |
| `scripts/next-bug.sh` prints nothing | no open bugs anywhere; report it and stop |
| the Step 4 test does not fail, or fails for another reason | return to `ship:systematic-debugging` Phase 1; the Step 2 seam was probably wrong |
| `npm test` or `npm run typecheck` fails after the fix | do not open a PR; return to `ship:systematic-debugging` Phase 3 with the failure as evidence |
| the reviewer raises a blocker or high | do not open a non-draft PR; fix, re-run Step 5, re-review |
| the reviewer sub-agent type is unavailable | use `general-purpose` with the same prompt; never skip the review and go straight to the PR |
| the Step 7 route is ambiguous | treat it as needs-human |
| `gh` is unavailable | report the branch pushed with the PR URL the push printed; never merge locally as a substitute |

## Quick reference

| Step | Gate | Delegated skill | Key output |
| --- | --- | --- | --- |
| 1: pick the row | no | none, `scripts/next-bug.sh` | one backlog row selected |
| 2: read the seam | no | none | owning file identified |
| 3: isolate the workspace | no | `ship:using-git-worktrees` | branch `fix/<component>-<id>` |
| 4: root cause, test, fix | no | `ship:systematic-debugging` | failing test, then a fix |
| 5: verify | no | `ship:verification-before-completion` | fresh `npm test` and `npm run typecheck` output |
| 6: self-review the diff | blocker/high blocks | `caveman:cavecrew-reviewer` (sub-agent) | verdict + medium/low findings for the PR body |
| 7: blast radius guardrail | no | none | auto-eligible or needs-human decided |
| 8: PR, row status | no | none | PR open (normal or draft), row `done` or `in-review`, never merged |
