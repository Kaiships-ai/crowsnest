# Release handoff

Use this compact record to start or resume one release session. Replace every
placeholder with current live state. Omit completed detail already captured by a
durable run or artifact URL.

## Goal

Ship `<version>` on `<channel: prerelease | stable>` and stop when
`<terminal success criteria>`. After compaction or resume, replace this section
with the latest explicit operator steering. Do not preserve superseded scope.

## Immutable state

- track: `<prerelease | stable>`
- branch: `<release/YYYY.M.PATCH>`
- cut SHA: `<full sha>`
- Code SHA: `<product-complete full sha>`
- Tooling SHA: `<trusted workflow full sha>`
- Release SHA: `<full sha; same as Code SHA when notes are final>`
- tag: `v<version>`
- version scheme: `<semver 0.x today | proposed CalVer YYYY.M.PATCH, operator sign-off state>`
- publication surfaces: `<R2 latest.json + tarball + install.sh; npm and gh-release are TODO>`
- approved changes: `<none or exact PRs/commits>`
- admitted release blockers: `<confirmed product/packaging/provenance/security blockers only>`

## Active evidence

- CI gate run: `<run id / attempt / URL or none>` (typecheck, lint, test, testid-audit, skill-lint)
- release workflow run: `<run id / attempt / URL or none>` (build, Kit bundle, fresh-HOME smoke, R2 upload)
- fresh-HOME Kit smoke: `<pass/fail, evidence>`
- R2 readback: `<latest.json + tarball verified, or none>`
- verify-release result: `<pass/fail or none>`

## Publication surfaces

One row per selected surface, with its evidence, state, and next action. Remove
unselected rows rather than reporting them as passed.

| Surface                | Evidence and state                                   | Next action or blocker |
| ---------------------- | ---------------------------------------------------- | ---------------------- |
| Cloudflare R2 (latest.json, tarball, install.sh) | `<version, object identity, run/attempt>` | `<action>` |
| npm                    | `TODO: not wired in release.yml today`               | `<action or defer>`    |
| GitHub release         | `TODO: not wired in release.yml today`               | `<action or defer>`    |
| Main closeout          | `<PR, shipped version/changelog on main>`            | `<action>`             |

## Phase

- conceptual phase: `<prepare | validate | publish | postpublish-confidence | main-closeout>`
- completed: `<phases that stay complete>`
- current: `<one phase>`
- next action: `<one concrete action>`
- retry budget: `<one diagnosis/fix/narrow retry, then reassess>`

## Failure policy

- confirmed product failure: fix the release branch, freeze a new Code SHA,
  invalidate downstream product evidence
- changelog-only failure: change only `packaging/CHANGELOG.md`, freeze a new
  Release SHA, reuse green Code SHA evidence after proving the single-file delta
- tooling or provenance failure: keep the Code SHA, change the Tooling SHA only
  when needed, recover the smallest owning surface
- infrastructure or credential failure: keep both SHAs and repair the external
  prerequisite (for example an R2 upload retry against already-built bytes)
- postpublish-confidence failure: do not retroactively unpublish; admit a
  confirmed product fix to the next version
- external approval or permission blocker: pause that surface with the exact job,
  URL, rule, and required owner action; continue independent authorized work

Do not scan moving `main`, add optional backports, or repeat completed phases
unless a named invalidating event requires it.

## Stop conditions

- success: `<exact published and verified state>`
- blocked: `<one precise external action only the operator can complete>`
