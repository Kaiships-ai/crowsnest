# Release validation and confidence

Use `crowsnest-release-ci` for workflow dispatch, immutable execution plans, and
failed-lane recovery. Select the phase below; a deferred or omitted check is not
passed. Every selected lane needs terminal evidence, and a required failure
cannot be waived by success on another surface.

## Source gates

These mirror `.github/workflows/ci.yml` and run on the exact Code SHA:

```bash
npm run typecheck
npm run lint
npm test
bash scripts/testid-audit.sh
bash scripts/skill-lint.sh
```

Reuse existing exact-SHA evidence; do not repeat a successful check solely
because this list mentions it. Code SHA and Release SHA may be the same commit
when it carries final notes; the same successful run qualifies that source and
its exact publication bytes. Only a later `packaging/CHANGELOG.md`-only
descendant may reuse earlier product evidence, and it still re-qualifies its
changed bytes.

## Release-only proofs

Beyond CI, `release.yml` runs the proofs that only matter when building the buyer
bundle. Run their local equivalents before tagging when possible:

```bash
npm run build
# Kit bundle build (darwin-arm64) and install.sh bake: see packaging/README.md and release.yml
# fresh-HOME Kit smoke: install the tarball into a throwaway HOME, assert the IG sidecar /health returns 200
```

The Kit bundle build and fresh-HOME smoke are defined inside `release.yml`.
crowsnest has no single `npm run` alias for the whole Kit smoke today. TODO: wire
a `release:smoke` script if this needs to run outside the workflow. The smoke is
the real install proof; a successful `npm run build` alone does not prove a
fresh-HOME install.

Credentialed lanes: `npm run verify:live` exercises the live IG path and runs
only when IG code changed. The IG sidecar authenticates from a session file, so a
blank password is by design; a 401 means a stale token row, not a missing
credential. Never print secret values.

## Prerelease publish

For a prerelease, the required source gates plus `npm run build` and the
fresh-HOME Kit smoke are the blocking set. Broad human-tester coverage and any
live end-to-end beyond `verify:live` move to confidence and are run through
`crowsnest-release-validation` after the build exists. For a prepare-only
request, stop here with the candidate, evidence, limitations, and the printed
next command. Do not push the tag or announce.

## Postpublish confidence

Target the exact published version:

- Run `crowsnest-verify-release` to confirm the R2 `latest.json`, tarball, and
  `install.sh` exist for the version and that a fresh install smoke-passes.
- Route human-tester feedback on the isolated build through
  `crowsnest-release-validation`.

A confidence failure does not retroactively unpublish a version. Classify it and
admit a confirmed product fix only to a new operator-approved candidate.

## Stable publish and bounded execution

Stable reuses matching prerelease confidence when still applicable; that supports
a lighter promotion roster but does not waive a required gate. Bound long local
lanes (the fresh-HOME Kit smoke, any live IG lane) and inspect an affected lane
on timeout instead of leaving it running. Serialize build and package mutations
so a concurrent build cannot remove `dist` mid-pack.

Fix a required failure at its owner and rerun only the affected evidence. For PR
preparation or hosted-runner stalls, use `crowsnest-pr` and `crowsnest-ci-limits`.
Record an unrelated main failure instead of adopting it into release scope.
