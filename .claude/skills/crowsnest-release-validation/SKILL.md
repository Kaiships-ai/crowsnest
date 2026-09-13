---
name: crowsnest-release-validation
description: Guide a human tester through a crowsnest release candidate on an isolated build, collect their feedback, and produce a reviewable report. Trigger:/crowsnest-release-validation
disable-model-invocation: true
---

# Crowsnest release validation

Help a human test an isolated crowsnest release candidate against a disposable
copy of their state. Automate preparation, triage, and reporting; the human
drives the interactive surfaces and judges quality. This skill collects
feedback, not a release go/no-go decision.

## Modes

- **Validate release:** the default human-testing workflow below.
- **Update campaign:** when the operator asks to refresh the validation
  campaign for a specific tag. crowsnest has no campaign-issue runner workflow
  today. TODO: wire a `release-validation-skill-runner` workflow and a canonical
  campaign issue if unattended campaign tracking is wanted; until then, track
  the campaign in a single GitHub issue by hand.

## Human validation

1. Introduce the run briefly: pick the candidate build, protect the tester's
   state with an isolated copy, prepare the build, then test and review feedback.
2. Prepare an isolated build. Do not use the caller's active checkout or the
   tester's real workspace. Create a run-owned worktree or clone at the exact
   candidate SHA and prove it did not move:

   ```bash
   candidate_sha="<exact-candidate-sha>"
   work="$(mktemp -d "${TMPDIR:-/tmp}/crowsnest-validation.XXXXXX")"
   git -C "$work" init -q
   git -C "$work" remote add origin https://github.com/Kaiships-ai/crowsnest.git
   git -C "$work" fetch --depth 1 origin "$candidate_sha"
   git -C "$work" checkout --detach -q FETCH_HEAD
   test "$(git -C "$work" rev-parse HEAD)" = "$candidate_sha"
   ```

   Build it with `npm ci` then `npm run build`, and run it against an isolated
   `HOME` and a disposable data directory, never the tester's own state. Copy the
   tester's state only into that disposable location, and only with their
   explicit approval. If isolation cannot be proven (a real data path or a live
   credential would leak into the candidate), stop and report the containment
   blocker; do not fall back to manual copying.
3. Only after the build is ready, create the worksheet (below) and guide one
   chosen surface at a time.
4. On `finish validation`, do cleanup and report approval (below).

Before readiness is confirmed, show only the candidate identity and prep
progress or errors. Do not expose testing instructions or create a worksheet for
a build that never became ready.

## Worksheet and human testing

When the build is ready, create a private worksheet at
`.artifacts/crowsnest-release-validation/<version>-<timestamp>.md` with: the run
identity, the candidate version and SHA, the isolation mode, and a surface table.
Seed the table with the release's relevant crowsnest surfaces (for example: the
dashboard and first-run onboarding, Instagram account connect and session auth,
transcription and the MCP transcribe tool, the Kit installer and `kai kit init`,
db migration and backup). For each surface give a one-line "what changed" and a
concrete manual check with a pass condition.

Open the worksheet for the tester and print only:

```text
Testing worksheet: /absolute/path/to/worksheet.md
```

Then orient them briefly: the worksheet is their private run record and the
source for the final report, not another task to complete; they test one surface
at a time in any order; they leave feedback by simply telling you their notes and
naming the surface (for example, `IG connect: session persisted after restart`),
and you add those notes to that surface's cell. Finish with the exit line: they
can stop after any amount of testing and reply exactly `finish validation` when
ready to wrap up. Then ask what they want to test first.

The tester drives the interactive surfaces (the dashboard UI, onboarding,
account connect, approvals). Give the command or URL and say what to look for,
then wait for their result. Take control only when explicitly asked. Do not turn
the checklist into an automated scenario runner.

A surface counts as tested only when tester-authored text appears in its notes
cell. Empty cells are untouched. Escape table pipes and use `<br>` between notes.

### Investigate each problem immediately

When the tester reports a problem, record it under the named surface, then
search open and closed `Kaiships-ai/crowsnest` issues with bounded, specific
queries. Inspect plausible matches and the linked fix or PR; do not classify
from a search snippet alone. Choose one disposition and draft it privately
beside the worksheet:

- **Comment on existing issue:** a related issue is open. Draft a concise
  corroborating comment with the tested version and SHA, reproduction, expected
  and observed behavior, and sanitized evidence.
- **Create issue:** no open match and no confirmed fix. Draft a complete issue
  with the same identity and evidence.
- **Found but fixed:** a concrete fix is confirmed in the tested SHA or a newer
  build. Record the fix URL locally; do not post it.

A closed duplicate, stale issue, or unclear change is not a confirmed fix. Keep
searching or draft a new issue. Sanitize every draft: no local paths, no
credentials, no IG session tokens or account handles, no user identifiers, no raw
logs, and no setup or cleanup detail. Tell the tester the draft is queued for
review; do not post it yet.

## Cleanup and report approval

On `finish validation`:

1. Read the worksheet and ask only for a missing final feedback note or a
   promotion vote.
2. Collect a small test-environment profile for the visible report: OS name and
   version, CPU architecture, logical core count, and memory rounded to the
   nearest GiB. Read each value with a narrow command; omit an unavailable value
   rather than collecting a broader system profile. Never read the hostname,
   username, device serial, network addresses, or raw command output.
3. Tear down the isolated build and its disposable data and `HOME`. Never mutate
   the tester's real state. Remove the run-owned worktree or clone once no
   command is using it.
4. Assign exactly one terminal result, in this precedence:
   - **Candidate failed**: any functional or readiness failure.
   - **Candidate passed, but cleanup failed**: behavior passed but teardown did
     not complete (record the detail privately, not in the public report).
   - **Candidate passed with presentation warnings**: behavior and cleanup
     passed, but a non-blocking visual, wording, or output-format warning was
     reported.
   - **Fully clean completion**: behavior passed, cleanup completed, no warnings.
   If there is neither a readiness failure nor a tester-authored surface result,
   say `Candidate not evaluated, no tester-authored result`, assign no terminal
   result, and stop after cleanup without a report or posting batch.
5. Complete each finding draft with the final sanitized evidence.
6. Synthesize one final report draft from the version and SHA, tested surfaces
   with non-empty notes, findings, tester feedback, and the promotion vote.
   Begin with:

   ```md
   - Version: <version>
   - Tested commit: <full SHA>
   - Terminal result: <exact terminal result label>

   ## Test environment

   - OS: <name and version>
   - CPU: <architecture>, <logical core count> logical cores
   - Memory: <whole GiB> GiB
   ```

7. Open the report and every issue or comment draft together and say:

   ```text
   I opened every proposed GitHub post for review. Nothing has been sent.
   Reply exactly `approve validation posts` to publish this batch, or tell me what to change.
   ```

   On edits, revise and reopen the same files. Never write to GitHub from
   `finish validation` alone.
8. On `approve validation posts`, re-read and privacy-check every file, publish
   each issue and comment, read each write back, insert the resulting URLs into
   the report, and post or update the campaign report comment. Return the report
   URL and every finding URL.

## Boundaries

An isolated build must keep every candidate-writable path inside the disposable
location; do not bypass a failed containment check with manual copying. Copying
the tester's IG session or credentials into the candidate needs explicit
authorization and a restoration plan, because a candidate can invalidate a live
session-file token. Only tester-authored results count as tested. Public
feedback excludes raw logs, paths, account handles, identifiers, credentials, and
setup or cleanup detail. `finish validation` does not authorize posts; explicit
batch approval does. This skill collects release feedback; it does not make the
go/no-go decision.
