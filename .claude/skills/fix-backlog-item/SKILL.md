---
name: fix-backlog-item
description: Use to take one open bug row from a component backlog board through a branch, a failing test, a root caused fix, and a pull request, gated by a blast radius guardrail that keeps risky surfaces in human review instead of merging on autopilot. Trigger:/fix-backlog-item
disable-model-invocation: true
---

# fix-backlog-item

This is an orchestrator skill. It does not reimplement worktree setup, debugging, or
verification; it picks one row off a backlog board and delegates the build to the ship-*
skills that already exist in this repo. Its own job is the parts specific to this repo: picking
the row, reading the architecture doc for the seam, and the blast radius guardrail that decides
whether a fix is safe to hand off as a normal PR or needs a human's eyes first.

It never merges a PR. Every path through this skill ends with an open PR and a status flip on
the backlog row, nothing more.

## Composition

| Step | Owned by | Skill called |
| --- | --- | --- |
| Pick the row | this skill | `scripts/next-bug.sh` |
| Read the seam | this skill | none |
| Isolate the workspace | reuse | `ship:using-git-worktrees` |
| Root cause, failing test first, fix | reuse | `ship:systematic-debugging` |
| Verify | reuse | `ship:verification-before-completion` |
| Blast radius guardrail, PR, row status | this skill | none |

## Step 1: pick the row

Run `bash scripts/next-bug.sh`. It prints every open, Type=bug row across every component's
`05-backlog-to-enhance.md`, sorted blocker first. Take the top line unless the human partner
named a specific ID, in which case find that row instead.

Each line is: `component ID severity verify source title`. Keep all six fields; every later step
reads from them.

## Step 2: read the seam

Before touching a worktree, read two things:

- The row's Source cell. It usually names where the bug was found: `bug-triage`,
  `observed-bugs`, a live test note, or a specific file.
- The component's `documents/architect/core-components/<component>/02-architecture.md` module
  structure table. It names the file that actually owns the behavior the title describes.

Also skim the component's `04-test-cases.md` for an existing case that already covers this row;
extend it rather than writing a duplicate. The seam identified here is what the failing test in
Step 4 targets, and what Step 7's file list is checked against.

## Step 3: isolate the workspace

Call `ship:using-git-worktrees`. Branch name: `fix/<component>-<id>`, lowercased, for example
`fix/feed-b-05`.

## Step 4: root cause, failing test first, fix

Call `ship:systematic-debugging`. Complete Phase 1 (root cause investigation) and Phase 2
(pattern analysis) before writing any fix code; the Iron Law in that skill applies here without
exception.

Then, per that skill's Phase 4, write the failing test before the fix:

- **verify=vitest rows** (server, lib, route, or action bugs): a vitest test next to the owning
  file, or in its existing test file, that reproduces the row's title as a failing assertion.
- **verify=browse rows** (UI bugs, a `.tsx` source or a title about what something shows,
  renders, or overlays): a browser journey script under `scripts/e2e/`, driven by `data-testid`,
  that reproduces the failure end to end.

Confirm the test fails for the reason named in the row's title, not for an unrelated reason,
before starting the fix.

Fix the root cause found in Phase 1, one change, no riding refactor. If the fix touches three
files or fewer, skip `ship:writing-plans` and go straight from the failing test to the fix. Only
reach for `ship:writing-plans` if the seam turns out to span more than that.

## Step 5: verify

Call `ship:verification-before-completion`. Then run the project-wide gates and read their
output before claiming anything:

```bash
npm test && npm run typecheck
```

A claim of "fixed" needs the fresh test output backing it, not a memory of an earlier run.

## Step 6: the blast radius guardrail

This is the gate between a fix that can ship itself and one that needs a human first. Compute it
from the actual diff, never from a guess about what the fix probably touched:

```bash
git diff --stat <base-branch>...HEAD
```

**Auto-eligible.** Every one of these must hold:

- the backlog row's Type is `bug`, not `enhancement`
- the diff is small: five files or fewer, roughly 150 changed lines or fewer
- every changed file sits under one of `src/lib`, `src/server/queries`, `src/components`, or
  `src/app`
- the diff includes a test file (the one written in Step 4)

**Needs human.** Any of these routes the row here instead, no partial credit:

- the diff touches `src/cli`, `packaging`, `src/server/db`, `services/ig`, any `.env*` file, or
  `src/cli/service-darwin.ts`
- the backlog row's Type is `enhancement`
- the diff fails any auto-eligible condition above (too large, outside the allowed
  directories, no test, or Type mismatch)

A single row touching one file under `src/server/db` still needs human, even if every other
condition is auto-eligible; the surface list overrides the size and directory checks.

## Step 7: open the PR, flip the row, never merge

Push the branch:

```bash
git push -u origin fix/<component>-<id>
```

**Auto-eligible path:**

```bash
gh pr create --title "fix(<component>): <title>" --label auto-fix --body "..."
```

Body includes the backlog row ID, the root cause found in Step 4, and the verification output
from Step 5. If the `auto-fix` label does not exist yet, create it first with
`gh label create auto-fix` before the `gh pr create` call. Flip the row's Status cell to `done`
in `05-backlog-to-enhance.md`.

**Needs human path:**

```bash
gh pr create --draft --title "fix(<component>): <title>" --label needs-human --body "..."
```

Same body content, plus a line naming which guardrail condition tripped it into this path
(surface touched, or Type=enhancement). If the `needs-human` label does not exist yet, create it
first with `gh label create needs-human`. Flip the row's Status cell to `in-review`, never
`done`; a draft PR still awaiting review is not finished work.

Either path stops at the open PR. Merging, and moving a row from `in-review` to `done`, is a
human decision this skill does not make.

## Error handling

- `scripts/next-bug.sh` prints nothing: no open bugs anywhere, report that and stop, nothing to
  fix.
- The failing test in Step 4 does not fail, or fails for a different reason than the row's
  title: return to `ship:systematic-debugging` Phase 1, the seam identified in Step 2 was
  probably wrong.
- `npm test` or `npm run typecheck` fails after the fix: stop, do not open a PR, return to
  `ship:systematic-debugging` Phase 3 with the new failure as evidence.
- The guardrail computation in Step 6 is ambiguous, for example a changed file's path does not
  cleanly match an allowed prefix: treat it as needs-human. The guardrail's job is to keep risky
  surfaces out of autopilot, so an unclear case defaults to the safer path.
- `gh` is unavailable: report the branch is pushed and ready, give the PR creation URL the push
  printed, and ask the human partner to open it; never fall back to merging locally as a
  substitute for a PR.

## Quick reference

| Step | Gate | Delegated skill | Key output |
| --- | --- | --- | --- |
| 1: pick the row | no | none, `scripts/next-bug.sh` | one backlog row selected |
| 2: read the seam | no | none | owning file identified |
| 3: isolate the workspace | no | `ship:using-git-worktrees` | branch `fix/<component>-<id>` |
| 4: root cause, test, fix | no | `ship:systematic-debugging` | failing test, then a fix |
| 5: verify | no | `ship:verification-before-completion` | fresh `npm test` and `npm run typecheck` output |
| 6: blast radius guardrail | no | none | auto-eligible or needs-human decided |
| 7: PR, row status | no | none | PR open (normal or draft), row `done` or `in-review`, never merged |
