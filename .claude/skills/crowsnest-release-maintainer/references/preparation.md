# Release preparation

Read the current source of truth before any branch or version change:
`scripts/release-prep.sh`, `.github/workflows/release.yml`,
`.github/workflows/ci.yml`, and `packaging/README.md`. For a regular release,
select the cut SHA once: use the operator's exact SHA, or fetch `origin/main`
once and record its full SHA and CI state. Work from a clean checkout of `main`,
or a `release/YYYY.M.PATCH` worktree off it. Never absorb unrelated dirty files;
`scripts/release-prep.sh` refuses a non-main branch or a dirty tree by design.

Moving main is a workflow and provenance source, not an invitation to add fixes.
Touch main before publication only for an operator-requested change or a critical
blocker owned there that cannot be proven on the release worktree. Keep that
repair bounded, use `crowsnest-pr`, then return to the release. Defer ordinary
forward-ports until after publication.

## Version and channel

crowsnest currently ships a semver-style version (`package.json` is `0.1.0`).
The proposal is to adopt CalVer `YYYY.M.PATCH` going forward, where `PATCH` is a
sequential monthly-train number, not the calendar day. This is a new adoption:
phrase it as a proposal to the operator and get explicit sign-off before the
first CalVer tag; do not silently switch the scheme. Choose the train from the
last shipped stable and prerelease tags. Prereleases use a `-beta.N` suffix on
the train (`YYYY.M.PATCH-beta.N`), never a new numeric-only suffix.

| Track      | Branch and version                              | Channel pointer                     |
| ---------- | ----------------------------------------------- | ----------------------------------- |
| Prerelease | `release/YYYY.M.PATCH`, `YYYY.M.PATCH-beta.N`    | R2 `latest.json` (single pointer today) |
| Stable     | `release/YYYY.M.PATCH`, `YYYY.M.PATCH`           | R2 `latest.json`                    |
| Nightly/alpha | isolated branch (see `crowsnest-release-nightly`) | not a buyer release              |
| Development | moving main                                     | not a release                       |

crowsnest has no separate prerelease-versus-stable registry selector today; R2
`latest.json` is the single channel pointer. TODO: wire distinct channel pointers
if prerelease and stable must be discoverable side by side.

`scripts/release-prep.sh <version>` is the prepare controller. It bumps
`package.json`, inserts a `## <version>` changelog section from `git log
--oneline` since the last tag, runs the `npm test` gate (and optionally
`npm run e2e` and `npm run verify:live` when IG code changed), then commits
`release: v<version>` and creates the `v<version>` tag. It does not push; it
prints the `git push origin main v<version>` line and stops for human review.

## Compatibility and deprecation surface

Before freezing, inspect any compatibility or deprecation surface the release
touches: the Kit installer contract in `packaging/` and any database migration
under the db scripts. A migration that ships in this release must be safe to run
forward on an installed Kit and, where it matters, reversible via backup. Record
what the release changes for an existing buyer's install.

crowsnest has no plugin-SDK API diff or `compat/registry` deprecation ledger like
the upstream project. TODO: wire a deprecation-record check if the Kit grows a
public extension contract that needs one.

Freeze the product-complete tree (approved version, fixes, and complete release
notes) as the **Code SHA**. If the notes are final, this is also the **Release
SHA**. After this point admit only confirmed product, packaging or provenance,
security, or publication-blocking defects; defer adjacent improvements.

## Changelog and release notes

Use `crowsnest-changelog-update` for the history inventory, human credit,
editorial grouping, and verification. It owns changelog content; prefer its
grouped notes over the raw `git log` dump `scripts/release-prep.sh` generates by
default. Notes live in `packaging/CHANGELOG.md` under a `## <version>` heading.
Both `scripts/release-prep.sh` and `release.yml` require that exact heading, and
the heading text must match the published tag minus its leading `v`.

When final notes were already in the qualified Code SHA, keep that same commit as
Release SHA. If notes change afterward, commit only `packaging/CHANGELOG.md`; the
complete Code-to-Release diff must be that one file, without renames or
deletions, to reuse the Code SHA product evidence. Any other delta reenters
product validation.
