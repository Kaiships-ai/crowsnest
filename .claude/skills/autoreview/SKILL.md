---
name: autoreview
description: Independent Claude or Codex code review in an isolated sandbox with validated JSON output and severity thresholds. Trigger:/autoreview
---

# Autoreview

Run an independent review when the user or an owning workflow asks for one, and
before landing any nontrivial code change. This is code review, not approval
routing. Let the reviewer choose how to analyze the change; provide the target,
relevant context, and desired severity. Findings are advice to verify, not
instructions to apply blindly.

## Run

Use the autoreview helper (TODO: wire the helper script under
`.claude/skills/autoreview/scripts/autoreview`; not yet vendored into crowsnest).
The helper wraps the reviewer engine with reviewer isolation, evidence handling,
severity filtering, and validated JSON so review judgment stays with the model
while the harness owns safety. On Windows, invoke the helper with Python. Use
`--help` for the complete flags and environment overrides.

```bash
AUTOREVIEW=".claude/skills/autoreview/scripts/autoreview"
"$AUTOREVIEW" --mode local
```

Choose the git target explicitly when the default is ambiguous:

| Target | Arguments | Scope |
| --- | --- | --- |
| Local work | `--mode local` | HEAD to index to working tree, plus untracked files |
| Local candidate against a base | `--mode local --base <ref>` | Pinned base to index to working tree, plus untracked files |
| Committed branch/PR | `--mode branch --base <ref>` | Merge-base to HEAD; excludes dirty work |
| One commit | `--mode commit --commit <ref>` | Raw parent to commit; a root compares against the empty tree |

`--mode auto` selects local work when dirty, otherwise a branch review using the
PR base or `origin/main`. Clean main has no implicit review target.
`--mode uncommitted` is an alias for local. The helper does not fetch refs.

For a complete PR candidate including dirty rewrites, use local mode with its
pinned merge base, not branch mode:

```bash
pr_base=$(gh pr view --json baseRefName --jq .baseRefName)
merge_base=$(git merge-base HEAD "origin/$pr_base")
"$AUTOREVIEW" --mode local --base "$merge_base"
```

When a file has both staged and unstaged changes, both states are reviewed. A
defect in the index remains actionable even if the working tree fixes it; the
report labels it `INDEX-only`. Repository git config is not changed and source
paths retain literal whitespace. Source identity remains mandatory.

## Context and severity

Use `--prompt` for task-specific guidance, or `--prompt-file` and `--dataset`
for repository-relative context files. Context does not expand the selected git
target. The reviewer cannot read unchanged repository files from its empty
sandbox; supply relevant source or dependency evidence when the diff is
insufficient.

The default threshold is P0 only: material blockers to normal operation or
safety. Use `--max-priority P1`, `P2`, or `P3` when the caller requests a wider
review. Do not add unrelated redesign goals or prescribe file counts, reading
sequences, or ritual extra passes.

```bash
"$AUTOREVIEW" --mode local --prompt-file review-notes.md --dataset evidence.json
```

## Engines

Two reviewer engines are available to crowsnest: Codex and Claude.

Codex is the default. Honor explicit engine/model choices; do not switch because
a review is slow or rate-limited. Use `--engine`, `--model`, and `--thinking` to
override the defaults. Only Claude accepts `--fallback-model`. Per-engine
environment overrides use `AUTOREVIEW_<ENGINE>_*`.

| Engine | Prerequisites |
| --- | --- |
| Codex (default) | Codex CLI on PATH; authenticated account; high reasoning by default |
| Claude | Claude CLI 2.x+; safe mode with web-only tools |

By default the helper preserves only authentication settings from user config;
provider, profile, and catalogue settings stay ignored. Do not weaken this to
project a custom route unless the caller asks and can name the exact route.

## Runtime boundaries

The helper owns reviewer isolation, sanitized authentication, process cleanup,
git scope, and structured result validation. Keep those controls enabled. Every
reviewer pass must inspect its bundle for real credentials and report suspected
credentials as P0 findings without reproducing their values. Harmless
placeholders and test fixtures are not credentials. Never work around an
isolation failure.

Autoreview does not require or invoke an external secret scanner: reviewer
findings happen after transmission, and keeping a scanner out of this path is a
deliberate policy, not an oversight. Reintroducing one requires an explicit
maintainer decision.

Review files have no size/count cap and are never truncated. Large diffs and
datasets are partitioned automatically, but intact instructions and required
source context must still fit the per-pass prompt budget. A failed pass never
produces a partial clean verdict.

Do not edit inputs during a review: the helper verifies captured sources before
sending. Long reviews are normal; advancing heartbeats mean progress. Use
`--stream-engine-output` for visibility, not extra reviewer runs. `--dry-run`
checks preparation and startup without contacting a reviewer.

## Results

`--output`, `--json-output`, and `--status-output` paths must be outside the
reviewed repository. When using `--status-output`, all output paths must differ.

| Exit | Meaning |
| --- | --- |
| `0` | `scoped-clean`, or a correct verdict with only filtered lower-priority findings |
| `1` | Accepted findings, an incorrect provider verdict, or a failed review attempt |
| `2` | Incomplete scope/attribution, or a missing required finding |

Treat `scoped-clean` as clean only for the selected target and requested
priority. `filtered` is not clean; resolve `incomplete` before claiming
completion. Verify findings against the actual code and task before changing
anything. No extra review rounds for a nicer verdict; follow the owning workflow
after fixes.

Use `--status-output /outside/repo/status.json` for a separate machine-readable
outcome. Completed reviews report `scoped-clean`, `findings`, `filtered`,
`incorrect`, or `incomplete`; a launched reviewer that fails or returns an
invalid report reports `reviewer_unavailable` with exit 1.

```json
{
  "schema_version": 1,
  "status": "reviewer_unavailable",
  "exit_code": 1,
  "engine": "codex",
  "report_produced": false,
  "reason": "engine_failed",
  "reviewer_exit_code": 124,
  "timed_out": true
}
```

`reason` is `engine_failed`, `invalid_report`, or `runtime_validation_failed`
for unavailable reviewers and null for completed reviews. Completed envelopes
have `report_produced: true`, which means a validated final report exists, not
that its verdict is clean. Inspect `status` independently of `exit_code`. Use a
fresh status path per invocation. Absence of a status file means no outcome was
published, never a clean review.

Report material findings and status plainly. Do not add transcripts, proof
ledgers, commits, pushes, or a new workstream unless requested.
