# Regular prerelease and stable release

The end-to-end sequence for a normal crowsnest Kit release. Prerelease is the
default; stable authorization is separate.

## Freeze and validate code

Read [preparation](preparation.md) before any branch or version change. Record
the approved version, the cut SHA, the release branch, and the product-complete
Code SHA (including final notes when they are ready). Code SHA may also be the
Release SHA. Use [validation](validation.md) to pick the phase gates and
`crowsnest-release-ci` for dispatch and failed-lane recovery.

Freeze the exact Code SHA, then validate it. crowsnest has no
`full-release-validation-at-sha` helper today; validation runs against the Code
SHA through CI plus the release-only proofs listed in [validation](validation.md).
TODO: wire a single at-SHA validation entry point if the release grows enough
lanes to need one.

A confirmed code defect creates a new Code SHA. Tooling, credential, or
infrastructure failure keeps the candidate and recovers only the failed surface.
Use [publication recovery](publication-recovery.md) for classification.

Early performance or soak confidence is optional for a prerelease. crowsnest has
no dedicated performance workflow wired into release today. TODO: wire an
optional perf run if one becomes worth blocking on.

## Qualify publication bytes

If the Code SHA already contains final notes in `packaging/CHANGELOG.md`, the
same successful validation run qualifies both Code and Release roles. No second
commit or run is needed solely to name a Release SHA.

If notes change after Code qualification, use `crowsnest-changelog-update` to
regenerate the `## <version>` section, then commit a changelog-only descendant
whose complete Code-to-Release delta is `packaging/CHANGELOG.md` and nothing
else. That descendant may reuse the Code SHA product evidence while re-qualifying
its changed bytes. Any other source change returns to fresh product
qualification.

Confirm the version is not already published. Read the live `latest.json` from
Cloudflare R2 and confirm no tarball for this version exists. A prepare-only
request does not authorize pushing the publication tag.

## Publish and verify

With publication authority and a green gate, push the reviewed commit and tag:

```bash
git push origin main v<version>
```

The `v*` tag push triggers `.github/workflows/release.yml`, which re-runs the
test gate (`npm ci`, `npm run typecheck`, `npm test`), builds the `darwin-arm64`
Kit bundle, bakes `install.sh`, runs the fresh-HOME Kit smoke (installs the
tarball into a throwaway HOME and asserts the IG sidecar `/health` returns 200),
and uploads the tarball, `install.sh`, and `latest.json` to Cloudflare R2. R2 is
the real buyer distribution surface; installed Kits read `latest.json` to
discover a new version.

The stated publish target also names npm and a GitHub release on
`Kaiships-ai/crowsnest`. `release.yml` does neither today. TODO: wire an npm
publish step and a `gh release create v<version>` step (body from
`packaging/CHANGELOG.md`) into `release.yml`, or drive them from this skill after
the R2 upload succeeds. Do not report them as published until they exist.

Reuse successful immutable artifacts on recovery; never rebuild or republish a
successful version. After publication, run `crowsnest-verify-release` against the
exact version to confirm the live R2 artifacts exist and smoke-pass. Do not call
a release done on the strength of a green workflow alone; verify the live
surfaces.

## Confidence and promotion

A prerelease request ends after verification and any requested announcement
(`crowsnest-release-announcement`; announcements never gate publication and need
explicit posting authorization). Human-tester confidence on the isolated build
belongs to `crowsnest-release-validation` and is not a publish blocker.

Stable promotion is a separate authorization. crowsnest does not maintain a
registry dist-tag selector like `latest` versus `beta` today; the R2
`latest.json` is the single channel pointer. TODO: wire a channel model (for
example separate `latest.json` files, or a channel field) if prerelease and
stable need distinct pointers. Until then, promotion means publishing the stable
version and updating `latest.json`, then verifying the readback.

Complete [main closeout](stable-main-closeout.md) once the shipped version,
changelog, and R2 evidence are ready.
