# Worksheet and human testing

Only when readiness is verified, copy
[the worksheet asset](../assets/validation-worksheet.md) to
`.artifacts/crowsnest-release-validation/<version>-<timestamp>.md`. Fill its run
identity: the candidate version and full SHA, the isolation mode, the source
version and commit, the campaign issue URL when one exists, and the build result.

Seed the surface table with the release's relevant crowsnest surfaces. For each,
give a one-line "what changed" and one concrete manual check with an observable
pass condition:

- Dashboard and first-run onboarding.
- Instagram account connect and session auth (session-file auth; a blank sidecar
  password is by design, so a 401 usually means a stale token row).
- Transcription and the MCP transcribe tool.
- Kit installer and `kai kit init`.
- Database migration and backup.

Replace `{{CROWSNEST}}` with the command that invokes the candidate build from
`$work` (for example, the candidate's CLI entrypoint or dev server run under the
isolated `HOME`), and `{{RESTART}}` with the candidate's restart command for the
run. No placeholder may remain.

Resolve the worksheet's absolute path and open it with the platform command:
`open '<path>'` on macOS, `xdg-open '<path>'` on Linux, or `start "" "<path>"` on
Windows. If opening fails, report the error and continue. After opening, print
only:

```text
Testing worksheet: /absolute/path/to/worksheet.md
```

Then orient the tester briefly:

- **What it is:** their private run record and the source for the final report,
  not another task to complete.
- **How to use each surface:** **What changed** summarizes the change, and
  **Recommended testing** gives one concrete manual exercise and pass condition.
- **How to leave feedback:** as they test, they simply tell you their notes and
  name the surface (for example, `IG connect: session persisted after restart`),
  and you add those notes to that surface's **Testing notes** cell. They do not
  edit the file themselves.

Finish with the exit instruction: they can stop after any amount of testing and
reply exactly `finish validation` when ready to wrap up. Then ask which surface
they want to test first.

## Human testing

The tester drives the interactive surfaces (the dashboard UI, onboarding,
account connect, approvals). Give the command or URL and say what to look for,
then wait for their result. Take control only when explicitly asked. Do not turn
the checklist into an automated scenario runner.

A surface counts as tested only when tester-authored text appears in its
**Testing notes** cell. Empty cells are untouched. Escape table pipes and use
`<br>` between notes. If the tester picks a surface not in the seed table, add a
row under **Additional surfaces tested** with one concrete check.

## Investigate each problem immediately

When the tester reports a problem, record it under the named surface, then search
open and closed `Kaiships-ai/crowsnest` issues with bounded, specific queries.
Inspect plausible matches and the linked fix or PR; do not classify from a search
snippet alone. Choose exactly one disposition and draft it privately beside the
worksheet:

- **Comment on existing issue:** a related issue is open. Draft a concise
  corroborating comment with the tested version and SHA, reproduction, expected
  and observed behavior, and sanitized evidence.
- **Create issue:** no open match and no confirmed fix. Draft a complete issue
  with the same identity and evidence, plus a `release-validation-finding` label.
- **Found but fixed:** a concrete fix is confirmed in the tested SHA or a newer
  build. Record the fix URL locally; do not post it.

A closed duplicate, stale issue, or unclear change is not a confirmed fix. Keep
searching or draft a new issue. Sanitize every draft: no local paths, no
credentials, no IG session tokens or account handles, no user identifiers, no
raw logs, and no setup or cleanup detail. Tell the tester the draft is queued for
review; do not post it yet.
