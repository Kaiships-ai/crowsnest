---
name: crowsnest-release-nightly
description: Automate crowsnest nightly and alpha releases on isolated branches, promote beta from a proven alpha, and forward-port fixes to main. Trigger:/crowsnest-release-nightly
disable-model-invocation: true
---

# Crowsnest nightly release

Use this for crowsnest alpha and nightly release automation, manual alpha
triggers, beta prep from a proven alpha, release-branch repair, and the
post-release forward-port to `main`.

## Policy

- Alpha and nightly run on a schedule or by manual trigger.
- Beta is promoted from a proven alpha or release branch, never cut directly
  from a moving `main`.
- Stable and latest always need explicit human confirmation. This skill never
  promotes to stable on its own.
- Never publish from a dirty checkout or directly from `main`. Alpha work is
  isolated on its own branch so a transient main failure does not block a usable
  nightly.
- Publish only after the release-branch gate is green.
- After a successful alpha, forward-port the reusable fixes back to `main` and
  prove main CI green.
- Forward-port PRs contain only the reusable fixes needed to make the release
  checks pass. They must not carry version bumps, changelog release entries,
  tags, generated artifacts, or state-file updates.
- Keep only alpha and nightly branches from the last 3 days, plus any branch
  with an active run, open PR, or release tag.

## Identity

Nightly runs commit under the standard crowsnest machine identity so the history
is clearly automated and gated by CI. Keep the attribution lines this repo uses
on every commit:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Add a human `Co-authored-by` only when a human supplied the patch or exact commit
text. Avoid direct pushes to protected `main`; forward-port by PR unless repo
policy explicitly allows the bot to push after green checks.

## Branch shape

- Branch prefix: `nightly/alpha/`
- Branch name: `nightly/alpha/YYYY-MM-DD-HHMMZ`
- Base: the current `origin/main` SHA at trigger time.
- Release tag: `vYYYY.M.PATCH-alpha.N` (CalVer; see `crowsnest-release-maintainer`
  for the CalVer adoption note).

`PATCH` is the sequential monthly release-train number, never the calendar day.
Determine the alpha train from the stable and beta releases; ignore alpha-only
patch numbers when choosing the next train. Use one greater than the highest
stable or beta patch for the month, then increment only `alpha.N` for repeated
nightlies on that train. If a beta already exists on that patch, move alpha to
the next train.

Do not reuse an old alpha branch for a new run. If re-running the same base SHA,
create a fresh timestamped branch and record why.

## Start

1. Work in a clean checkout, not a dirty worktree.
2. Fetch first, then branch from the pinned base:

```bash
git fetch origin main --tags --prune
git switch main
git merge --ff-only origin/main
BASE_SHA="$(git rev-parse origin/main)"
BRANCH="nightly/alpha/$(date -u +%Y-%m-%d-%H%MZ)"
git switch -c "$BRANCH" "$BASE_SHA"
```

3. Read the release source of truth before changing anything: `AGENTS.md`,
   `scripts/release-prep.sh`, `.github/workflows/release.yml`,
   `.github/workflows/ci.yml`, and `packaging/README.md`.
4. Compare `$BASE_SHA` with the last successful alpha and the current git tags.
   If that base already shipped an alpha, report skip and do not publish.

crowsnest already has `.github/workflows/nightly-autofix.yml`, which pulls the
top backlog item and fixes it in a worktree. That is a code-maintenance job, not
a release job. TODO: wire a scheduled nightly release trigger (workflow
`schedule:` or an operator dispatch) if crowsnest wants unattended nightlies;
until then this skill runs from a manual trigger.

## Reuse prior fixes

Before running the gate, mine recent alpha branches for fixes already made:

1. List recent alpha branches from the last 3 days plus the last successful one:

```bash
git for-each-ref refs/remotes/origin/nightly/alpha --format='%(refname:short) %(committerdate:iso-strict)'
```

2. For each candidate, inspect commits not already in `origin/main`:

```bash
git log --no-merges --reverse --format='%H%x09%s' origin/main..origin/nightly/alpha/YYYY-MM-DD-HHMMZ
```

3. Cherry-pick only real stabilization fixes that still apply. Skip version
   bumps, changelog release entries, tags, generated release notes, and one-off
   debug instrumentation.
4. If a cherry-pick conflicts, check whether current `main` already carries an
   equivalent fix; if not, resolve minimally and keep the message clear.
5. Record reused commit SHAs separately from newly authored fix SHAs.

Use `git cherry` and `git range-diff` to avoid duplicating fixes already on
`main`. A clean cherry-pick is triage evidence, not automatic approval.

## Repair loop

Use the branch as a release-candidate repair surface:

1. Run narrow local checks first: the changed tests, then the CI gate
   (`npm run typecheck`, `npm run lint`, `npm test`, `bash scripts/testid-audit.sh`).
2. If a check fails, fix it on the alpha branch with minimal commits.
3. Commit each coherent fix, then re-run the failed check.
4. Do not hide a failure by editing baselines, expected-failure lists, or ignore
   files unless the release docs explicitly require it and the diff is justified.
5. If a failure is flaky, re-run once; if still red, treat it as real.
6. Keep fixes small and forward-portable. Avoid broad refactors during
   stabilization.

```bash
git add <files>
git commit -m "fix: stabilize nightly release gate"
git push -u origin "$BRANCH"
```

## Release gate and publish

After local proof:

1. Compute the next `vYYYY.M.PATCH-alpha.N` from existing tags and releases.
   Select `PATCH` from the stable and beta trains, not the date or the highest
   alpha-only patch.
2. Set the alpha branch `package.json` version and add its
   `packaging/CHANGELOG.md` section (see `crowsnest-changelog-update`), commit,
   and push the branch.
3. Run the full release gate against the exact branch head via
   `crowsnest-release-ci` (CI gate plus the `release.yml` Kit-bundle build and
   fresh-HOME Kit smoke). Fix failures on the alpha branch.
4. Publish only after the gate is green. Push the alpha tag from the exact
   proven commit:

```bash
SHA="$(git rev-parse HEAD)"
TAG="v$(node -p "require('./package.json').version")"
git tag -a "$TAG" "$SHA" -m "crowsnest ${TAG#v}"
git push origin "$TAG"
```

The `v*` tag push triggers `.github/workflows/release.yml`, which builds the Kit
bundle, runs the fresh-HOME smoke, and uploads the tarball, `install.sh`, and
`latest.json` to R2.

The openclaw lineage published an `alpha` npm dist-tag and a GitHub prerelease.
crowsnest does not publish to npm today, and `release.yml` does not create a
GitHub release. TODO: wire an `alpha` npm dist-tag and a `gh release create
--prerelease` step if alpha needs a distinct distribution channel; until then an
alpha ships as an R2 artifact under its alpha version. Do not publish from the
local host by hand; let the tag-triggered workflow do it.

## Verify published alpha

The alpha is not done until all are true:

- The git tag exists on `origin`.
- `release.yml` succeeded for that tag and the R2 objects for that version exist
  (`latest.json` should only advance for a stable, not an alpha; confirm the
  alpha tarball and `install.sh` uploaded without moving `latest.json`).
- The fresh-HOME Kit smoke passed in that run.
- A state note records version, tag, base SHA, branch, fix commit SHAs, the
  workflow run id, and timestamp.

Run `crowsnest-verify-release` against the alpha version for the live check.

## Forward-port

After a successful alpha, raise a fixes-only PR back to `main`:

```bash
git fetch origin main --prune
git switch -c "nightly/forward-port/$(date -u +%Y-%m-%d-%H%MZ)" origin/main
```

1. Cherry-pick only the real fixes needed to make the release checks pass.
2. Exclude alpha version bumps, changelog release entries, tags, generated
   assets, and any commit whose only purpose was publishing the alpha.
3. If a commit mixes a real fix with release changes, split it: replay only the
   fix hunks into a new commit.
4. Resolve conflicts in favor of the minimal main-compatible fix.
5. Run the CI gate, push, and open a PR. Wait for required main CI to go green;
   never self-merge (the repo policy is no self-merge).
6. Report the PR SHA and any commits intentionally not forward-ported.

If `origin/main` is independently red before the forward-port, document the
unrelated failing check and keep the forward-port PR green against its own head.

## Branch retention

Before and after each run, prune old alpha branches:

1. List `origin/nightly/alpha/*`.
2. Keep branches within the last 3 days UTC.
3. Keep branches referenced by a live run, open PR, release tag, or state file.
4. Delete only nightly-owned alpha branches:

```bash
git push origin --delete nightly/alpha/YYYY-MM-DD-HHMMZ
```

Never delete human branches, beta branches, or unknown prefixes.

## Stop conditions

Stop and report clearly if: the release docs and scripts disagree on versioning
or publish path; required secrets or auth are unavailable; the release workflow
cannot be dispatched or observed; a required gate stays red after a real fix
attempt; R2 or git state disagrees after publish; or the forward-port cannot be
made green without a larger product decision.
