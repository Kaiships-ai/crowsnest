---
name: crowsnest-changelog-update
description: Regenerate the crowsnest Kit changelog from a git-history manifest, preserving every PR ref and human thanks and rejecting non-editorial PRs from the prose. Trigger:/crowsnest-changelog-update
disable-model-invocation: true
---

# Crowsnest changelog update

Use this to rewrite the release section of `packaging/CHANGELOG.md` and to source
the GitHub release-note text before publishing a release. Run it during
preparation so the notes are final before the Code SHA freezes; the Code SHA can
then also serve as the Release SHA. Use it with `crowsnest-release-maintainer`;
this skill owns changelog content, ordering, grouping, and attribution.

## Goal

Rebuild the target `## <version>` section of `packaging/CHANGELOG.md` from a
complete git-history manifest, not stale draft notes. Produce grouped,
user-facing release notes sorted by user interest, preserving every relevant
issue and PR reference and every human `Thanks @author` attribution.

`packaging/CHANGELOG.md` is the single changelog file. Each release is one
`## <version>` section (version without the leading `v`). Both
`scripts/release-prep.sh` and `.github/workflows/release.yml` require that exact
heading to exist for the version being cut, so the heading text must match the
tag minus its `v`. `scripts/release-prep.sh` auto-inserts a section built from a
raw `git log --oneline` dump; this skill replaces that dump with grouped,
attributed prose. There is no split changelog layout and no records directory,
so keep everything in the one file.

## Inputs

- Target version: the CalVer `YYYY.M.PATCH` (or semver, during the transition),
  without any beta suffix in the heading.
- Base tag: the last shipped release tag, and an ancestor of the target. A newer
  but divergent tag is not a valid history boundary.
- Target ref: the exact product-complete commit being documented. Include any
  later fixes before finalizing notes.
- Canonical main ref: current `origin/main`, fetched before verification, for
  resolving the original merged PR when a fix was carried by a backport.

## Workflow

1. Confirm the branch and exact history target:
   - `git fetch --tags origin`
   - confirm a clean `git status -sb`
   - record `git rev-parse HEAD` as the history target
2. Audit the history, including direct commits:
   - `git log --topo-order --date=iso-strict --pretty=format:'%h%x09%ad%x09%s' <base-tag>..<target-ref>`
   - `git log --topo-order --grep='(#' --date=short --pretty=format:'%h%x09%ad%x09%s' <base-tag>..<target-ref>`
   - Include every commit reachable from the target but not the base, including
     merged side branches. Resolve PR associations before deduplicating.
   - Exclude reverted work from the shipped notes.
3. Build the manifest before writing prose. There is no bundled verifier script
   in crowsnest today. TODO: wire a `scripts/verify-release-notes.mjs` (or
   similar) that resolves every referenced PR, eligible contributor credit,
   inline issue context, and an editorial-eligibility classification, then
   validates the rendered section. Until it exists, build the manifest by hand:
   for each commit resolve its PR and author with `gh`:
   ```bash
   gh pr list --repo Kaiships-ai/crowsnest --state merged --search "<sha>" \
     --json number,title,author,url
   gh api repos/Kaiships-ai/crowsnest/commits/<sha>/pulls --jq '.[].number'
   ```
   The manifest is the required input to the rewrite, not an after-the-fact
   audit: it must contain every referenced PR, eligible contributor credit,
   inline issue context, every direct commit, and an eligibility flag per PR and
   direct commit. Inspect linked PRs, issues, or diffs for ambiguous commits;
   infer a direct commit's user outcome from its subject, body, touched files,
   tests, and nearby commits.
4. Rewrite one section only:
   - use `## <version>` (the stable base version, no beta-specific heading)
   - do not leave a stale unreleased section above the target release; fold any
     release-bound unreleased notes into the target section rather than deleting
     them
5. Section shape:
   - `### Highlights`: 5 to 8 bullets, broad user wins first. Include only a
     clear user-visible capability, a material reliability or data-safety fix, a
     broad cross-surface improvement, or a release-defining milestone. Every
     highlight says what changed for a user in one sentence, one user story per
     bullet, its supporting PRs grouped. Exclude tests, CI, refactors, docs, and
     implementation detail unless the outcome is a material install/update,
     data-safety, or widely visible improvement.
   - `### Changes`: new capabilities and behavior changes.
   - `### Fixes`: user-facing fixes first, grouped by impact and surface.
   - Group related changes and fixes by surface and user impact; avoid one bullet
     per tiny commit when several commits tell one user-facing story.
6. Preserve attribution:
   - keep `#issue`, `(#PR)`, `Fixes #...`, and `Thanks @...`
   - every human-authored merged PR represented by a user-facing entry needs its
     PR ref and `Thanks @author`, even when the PR had no linked issue
   - every human issue reporter for a represented `Fixes #...` needs
     `Thanks @reporter` unless already thanked in that bullet
   - every human `Co-authored-by` on represented work needs `Thanks @handle`
     when a GitHub handle is known
   - when grouping multiple PRs or issues in one bullet, include every relevant
     ref and every human contributor handle in that same bullet; multiple
     `Thanks @...` in one bullet are expected, do not collapse credit
   - direct commits inform the grouped prose but are never rendered as a public
     direct-commit dump; add direct-commit credit to a grouped bullet only when
     it shares an explicit closing issue reference or at least two distinctive
     subject terms
   - reject ordinary `docs`, `test`, `refactor`, `ci`, `build`, `chore`, and
     `style` PRs from Highlights, Changes, and Fixes. An explicit Conventional
     Commits `!` breaking-change marker makes any type eligible; include its
     verified user-facing breaking change and migration guidance with the PR ref
     and credit. Classify titles from their declared type and scope, not
     incidental words in the description.
   - never thank bots. crowsnest commits are co-authored by Claude; do not thank
     `@claude` or automation accounts in the changelog. Do not use GitHub's
     contributor count as the source of truth; carry the complete human credit
     set in the changelog itself.
7. Sorting preference: security and data-loss fixes; Instagram delivery and
   session correctness; the dashboard and Kit install/update path reliability;
   performance and observability; docs and internal detail last or omitted.
8. Keep bullets single-line unless the existing file style forces otherwise.
   Avoid internal release-process noise unless it changes install or update
   safety.

## Validate and ship

- Re-audit the rendered section against the manifest before committing: every
  `#NNN` in the section and in release history must resolve, no reverted work is
  presented as shipped, no source PR is missing, no non-editorial PR appears in
  the grouped prose, and no eligible PR author or known co-author is missing from
  that PR's `Thanks @...`. `### Highlights` must have 5 to 8 top-level bullets.
- Unqualified `#NNN` resolves against `Kaiships-ai/crowsnest`; a cross-repository
  reference such as `owner/other#141` stays literal text and must not be
  rewritten as a local link.
- `git diff --check`.
- Stage `packaging/CHANGELOG.md` and commit:
  `git commit -m "docs(changelog): refresh <version> notes"`.
- Push the release branch without rebasing it onto moving `main`.
- When all fixes and final notes are committed before validation, that commit is
  both Code SHA and Release SHA. If notes change after Code qualification, make a
  descendant whose only delta is `packaging/CHANGELOG.md`, reuse the Code SHA
  product evidence, and re-qualify the changed bytes (see
  `crowsnest-release-ci`). Any other changed path requires fresh product
  qualification.

## GitHub release body

The stated publish target includes a GitHub release on `Kaiships-ai/crowsnest`.
`release.yml` does not create one today (see `crowsnest-release-maintainer`).
When wired, source the release body from the exact `## <version>` section of
`packaging/CHANGELOG.md`:

```bash
gh release create v<version> --repo Kaiships-ai/crowsnest \
  --title "crowsnest <version>" --notes-file <extracted-section.md>
```

After publishing, read the release page back and confirm its body matches the
committed section. Do not add security advisory IDs to the changelog or release
body unless explicitly requested.
