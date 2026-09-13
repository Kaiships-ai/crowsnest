---
name: crowsnest-release-maintainer
description: Prepare, publish, recover, or verify a crowsnest Kit release through a staged prepare/validate/promote pipeline. Trigger:/crowsnest-release-maintainer
disable-model-invocation: true
---

# Crowsnest release maintainer

Use this for a release operation, not ordinary development. A release cuts a new
crowsnest Kit version: bump, changelog, gate, tag, then let the tag-triggered
workflow build the buyer bundle and publish. Read the current source of truth
before acting: `scripts/release-prep.sh`, `.github/workflows/release.yml`,
`.github/workflows/ci.yml`, and `packaging/README.md`. Ship authority for
ordinary code is not release authority.

## Choose the operation

Read only what the selected phase needs:

- Prepare and publish a normal release: the prepare, validate, publish sections
  below. Default to a prerelease if the request does not say stable; prerelease
  authorization does not authorize a later stable promotion.
- Full validation dispatch, watching, or failed-gate recovery: `crowsnest-release-ci`.
- Nightly or alpha automation on an isolated branch: `crowsnest-release-nightly`.
- Release notes: `crowsnest-changelog-update`. It owns changelog content,
  grouping, and attribution discipline.
- Published-artifact verification: `crowsnest-verify-release`.
- Human-tester feedback on an isolated build: `crowsnest-release-validation`.
- A requested announcement: `crowsnest-release-announcement`. Announcements never
  gate publication and need explicit posting authorization.

## Versioning: adopt CalVer

crowsnest currently ships a semver-style version (`package.json` is `0.1.0`).
Propose adopting CalVer `YYYY.M.PATCH` going forward as the crowsnest release
scheme, where `PATCH` is a sequential monthly-train number, not the calendar day.
This is a new adoption, so phrase it as a proposal to the operator and get
explicit sign-off before the first CalVer tag; do not silently switch the scheme.
Choose the train from the last shipped stable and prerelease tags. Prereleases
use a `-beta.N` suffix on the train (`YYYY.M.PATCH-beta.N`).

## Shared release boundaries

Explicit approval is required for version changes and irreversible publication.
A request to cut, publish, or complete a named release carries through its
validated publication and verification; do not ask again unless identity,
channel, scope, or material risk changes.

An operator's explicit approval to prepare a named release is standing authority
for the necessary preparation decisions and repairs: candidate and tooling
fixes, reviewed test alignments, isolated proof, commits, and validation
recovery. Record the decision, its evidence, and the chosen channel. Continue
independent work while resolving a blocker. This authority does not permit
hiding defects, lowering a gate to manufacture success, destructive changes to
operator state, unrelated work, or publication. A prepare-only request still
needs a separate publication instruction before releasing artifacts.

Published versions and pushed tags are immutable. Reuse successful exact-source
artifacts; do not rebuild or republish as an implicit retry. Once a beta tag is
pushed, use the next beta number rather than deleting or recreating it. The
active release is the work queue: no opportunistic moving-main fixes or
backports. Classify a failure, repair its owner, retry only the affected
surface, then reassess rather than repeating the whole release.

Required CI checks remain required. A passing sibling lane cannot waive a
failure. Report proof gaps accurately.

## SHA identities

Keep three roles in the state record; they may name the same commit.

- **Code SHA:** the product-complete tree with approved fixes and, when ready,
  final changelog notes. Freeze it once. After the freeze, apply the release
  firebreak (see `crowsnest-release-ci`): admit only confirmed product defects,
  packaging/provenance defects in the bytes to publish, security defects, or
  failures that make publication impossible.
- **Release SHA:** the exact commit whose bytes publish. When the Code SHA
  already carries final notes, Code SHA is also Release SHA and one successful
  validation run qualifies both. If notes change afterward, a changelog-only
  descendant whose only delta is `packaging/CHANGELOG.md` may reuse the Code
  SHA's product evidence while re-qualifying its changed bytes; any other delta
  returns to the Code SHA loop.
- **Tooling SHA:** the trusted commit whose scripts and workflow run. Tooling or
  infrastructure failures do not justify changing the candidate.

## State record

Keep one compact handoff: effective goal, version/tag/branch, cut/Code/Release/
Tooling SHAs, active validation run, approved changes, current phase, and next
action. Latest operator steering replaces superseded scope. Completed evidence
stays complete until a named change invalidates it.

## Prepare

1. Start from a clean checkout of `main` (or a `release/YYYY.M.PATCH` worktree
   off it). Never absorb unrelated dirty files. `scripts/release-prep.sh`
   refuses a non-main branch or a dirty tree by design.
2. Freeze the version and record the cut SHA and Code SHA.
3. Draft release notes with `crowsnest-changelog-update` into
   `packaging/CHANGELOG.md` under a `## <version>` heading. Both
   `scripts/release-prep.sh` and `release.yml` require that exact heading; the
   heading text must match the published tag minus its leading `v`.
4. Inspect any compatibility or deprecation surface the release touches (Kit
   installer contract in `packaging/`, migrations under the db scripts) before
   freezing.

`scripts/release-prep.sh <version>` is the prepare controller: it bumps
`package.json`, inserts a `## <version>` changelog section from `git log
--oneline` since the last tag, runs the `npm test` gate (and optionally
`npm run e2e` and `npm run verify:live` when IG code changed), then commits
`release: v<version>` and creates the `v<version>` tag. It does not push; it
prints the `git push origin main v<version>` line and stops for human review.
Prefer letting `crowsnest-changelog-update` produce the grouped notes rather than
shipping the raw `git log` dump the script generates by default.

## Validate

Use `crowsnest-release-ci` to run and watch the full validation gate against the
exact Code SHA and recover any failed lane. Do not push the tag until the gate
is green. Required gates mirror CI (`npm run typecheck`, `npm run lint`,
`npm test`, `bash scripts/testid-audit.sh`) plus the release-only proofs
(`npm run build`, the Kit bundle build, and the fresh-HOME Kit smoke that
`release.yml` runs). For a prepare-only request, stop here with the candidate,
evidence, limitations, and the printed next command. Do not push the tag or
announce.

## Publish and verify

With publication authority and a green gate, push the reviewed commit and tag:

```bash
git push origin main v<version>
```

The `v*` tag push triggers `.github/workflows/release.yml`, which re-runs the
test gate (`npm ci`, `npm run typecheck`, `npm test`), builds the
`darwin-arm64` Kit bundle, bakes `install.sh`, runs the fresh-HOME Kit smoke
(installs the tarball into a throwaway HOME and asserts the IG sidecar
`/health` returns 200), and uploads the tarball, `install.sh`, and `latest.json`
to Cloudflare R2. That R2 publish is the real buyer distribution surface;
`latest.json` is what installed Kits read to discover a new version.

The stated publish target also includes npm and a GitHub release on
`Kaiships-ai/crowsnest` via `gh`. `release.yml` does not do either today.
TODO: wire an npm publish step (crowsnest is not currently published to npm) and
a `gh release create v<version>` step (from `packaging/CHANGELOG.md`) into
`release.yml`, or drive them from this skill after the R2 upload succeeds.

After publication, run `crowsnest-verify-release` against the exact version to
confirm the live artifacts exist and smoke-pass. Do not call a release done on
the strength of a green workflow alone; verify the live surfaces.

## Recover

Classify a failure before changing git state:

- Product defect: repair the release branch, freeze a new Code SHA, invalidate
  downstream product evidence. After the tag is published, move to the next
  version rather than mutating the shipped one.
- Changelog-only defect: replace the Release SHA with a `packaging/CHANGELOG.md`
  only descendant, reuse the Code SHA product evidence, re-qualify the changed
  bytes.
- Tooling, credential, or infrastructure failure: keep the candidate, repair the
  smallest owning surface, retry only the failed lane.

An R2 upload can fail after a good build. Re-run the upload step against the
already-built, already-smoked bytes; never rebuild a shipped version as an
implicit retry. Registry or CDN propagation can lag briefly; use bounded reads.

## Stop conditions

Stop and report clearly if: the prepare script and workflow disagree on version
or path; a required secret or auth is unavailable; the release workflow cannot
be observed; a required gate stays red after a real fix attempt; or R2, npm, or
GitHub state disagrees after publish.
