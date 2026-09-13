---
name: crowsnest-release-maintainer
description: Prepare, publish, recover, or verify a crowsnest Kit release through a staged prepare/validate/promote pipeline. Trigger:/crowsnest-release-maintainer
disable-model-invocation: true
---

# Crowsnest release maintainer

Use this for a release operation, not ordinary development. A release cuts a new
crowsnest Kit version: bump, changelog, gate, tag, then let the tag-triggered
workflow build the buyer bundle and publish it to Cloudflare R2. Read the current
source of truth before acting: `scripts/release-prep.sh`,
`.github/workflows/release.yml`, `.github/workflows/ci.yml`, and
`packaging/README.md`. Ship authority for ordinary code is not release authority.

## Choose the operation

Read only what the selected phase needs.

| Read this reference | When |
| --- | --- |
| [regular-release](references/regular-release.md) | Prepare and publish a normal prerelease or stable release, end to end. Default to prerelease unless stable is authorized. |
| [preparation](references/preparation.md) | Before any branch or version change: cut SHA, versioning, channel, compatibility surface, changelog. |
| [validation](references/validation.md) | Select phase gates, run source and release-only proofs, or recover a failed lane (with `crowsnest-release-ci`). |
| [publication-recovery](references/publication-recovery.md) | An interrupted publish, a failed R2 upload, credential failure, or a channel readback mismatch. |
| [stable-main-closeout](references/stable-main-closeout.md) | After a stable publish: bring `main` to the shipped version and changelog. |
| [release-handoff-template](references/release-handoff-template.md) | Start or resume a session: the one compact state record to keep. |
| [first-package](references/first-package.md) | The release publishes to a distribution surface (R2, or future npm/gh-release) for the first time. |
| [backport-discovery](references/backport-discovery.md) | Stub: not wired for crowsnest (single release line off `main`). |
| [extended-stable-backports](references/extended-stable-backports.md) | Stub: not wired for crowsnest (no maintenance line). |
| [extended-stable-publish](references/extended-stable-publish.md) | Stub: not wired for crowsnest (single channel pointer). |
| [platform-publication](references/platform-publication.md) | Stub: not wired for crowsnest (Kit tarball only, no signed native app). |

Related skills: full validation dispatch and firebreak, `crowsnest-release-ci`;
nightly/alpha automation, `crowsnest-release-nightly`; changelog content,
`crowsnest-changelog-update`; published-artifact verification,
`crowsnest-verify-release`; human-tester feedback, `crowsnest-release-validation`;
a requested announcement, `crowsnest-release-announcement` (never gates
publication, needs explicit posting authorization).

## Versioning: adopt CalVer

crowsnest currently ships a semver-style version (`package.json` is `0.1.0`).
Propose adopting CalVer `YYYY.M.PATCH` going forward as the crowsnest release
scheme, where `PATCH` is a sequential monthly-train number, not the calendar day.
This is a new adoption, so phrase it as a proposal to the operator and get
explicit sign-off before the first CalVer tag; do not silently switch the scheme.
Choose the train from the last shipped stable and prerelease tags. Prereleases
use a `-beta.N` suffix on the train (`YYYY.M.PATCH-beta.N`).

## Shared release boundaries

Explicit approval is required for version changes and irreversible publication. A
request to cut, publish, or complete a named release carries through its
validated publication and verification; do not ask again unless identity,
channel, scope, or material risk changes.

An operator's explicit approval to prepare a named release is standing authority
for the necessary preparation decisions and repairs: candidate and tooling fixes,
reviewed test alignments, isolated proof, commits, and validation recovery.
Record the decision, its evidence, and the chosen channel. Continue independent
work while resolving a blocker. This authority does not permit hiding defects,
lowering a gate to manufacture success, destructive changes to operator state,
unrelated work, or publication. A prepare-only request still needs a separate
publication instruction before releasing artifacts.

Published versions and pushed tags are immutable. Reuse successful exact-source
artifacts; do not rebuild or republish as an implicit retry. Once a beta tag is
pushed, use the next beta number rather than deleting or recreating it. The
active release is the work queue: no opportunistic moving-main fixes or
backports. Classify a failure, repair its owner, retry only the affected surface,
then reassess rather than repeating the whole release. Required CI checks remain
required; a passing sibling lane cannot waive a failure. Report proof gaps
accurately.

## SHA identities

Keep three roles in the state record; they may name the same commit.

- **Code SHA:** the product-complete tree with approved fixes and, when ready,
  final changelog notes. Freeze it once. After the freeze, apply the release
  firebreak (see `crowsnest-release-ci`): admit only confirmed product defects,
  packaging or provenance defects in the bytes to publish, security defects, or
  failures that make publication impossible.
- **Release SHA:** the exact commit whose bytes publish. When the Code SHA
  already carries final notes, Code SHA is also Release SHA and one successful
  validation run qualifies both. If notes change afterward, a
  `packaging/CHANGELOG.md`-only descendant may reuse the Code SHA's product
  evidence while re-qualifying its changed bytes; any other delta returns to the
  Code SHA loop.
- **Tooling SHA:** the trusted commit whose scripts and workflow run. Tooling or
  infrastructure failures do not justify changing the candidate.

## State record

Keep one compact handoff using
[release-handoff-template](references/release-handoff-template.md): effective
goal, version/tag/branch, cut/Code/Release/Tooling SHAs, active validation run,
approved changes, current phase, and next action. Latest operator steering
replaces superseded scope. Completed evidence stays complete until a named change
invalidates it.

## Stop conditions

Stop and report clearly if: the prepare script and workflow disagree on version
or path; a required secret or auth is unavailable; the release workflow cannot be
observed; a required gate stays red after a real fix attempt; or R2 state
disagrees after publish.
