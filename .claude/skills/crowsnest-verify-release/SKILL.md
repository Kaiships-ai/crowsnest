---
name: crowsnest-verify-release
description: Verify a published crowsnest release against its live artifacts, npm, GitHub release, R2 Kit distribution, and a running-app smoke. Trigger:/crowsnest-verify-release
disable-model-invocation: true
---

# Crowsnest verify release

Use this when asked whether a crowsnest release is fully published, distributed,
smoke-tested, or live-verified. This is a verification skill, not a publish
skill; use `crowsnest-release-maintainer` before changing release state.

## Rules

- Resolve a short version suffix to the concrete version from the current date
  and context, then say the resolved version.
- Verify live state. Do not trust the local checkout, the changelog, or old
  memory as current truth.
- If the checkout is dirty or divergent, use it only for scripts and reference.
  For version metadata, fetch from the git tag, the GitHub release, or the R2
  artifact rather than the working tree.
- Never print secrets. Use inherited live keys only for scoped smoke commands.
- Keep the final answer terse: `yes` or `no`, evidence bullets, caveats, cleanup.

## Checks

### 1. Git tag and GitHub release

```bash
git ls-remote --tags origin "v<VERSION>"
gh release view v<VERSION> --repo Kaiships-ai/crowsnest \
  --json tagName,name,publishedAt,isDraft,isPrerelease,url,body,assets
```

- Confirm the tag exists on `origin`.
- A stable release must not be draft or prerelease; an alpha or beta must be a
  prerelease.
- The GitHub release is part of the stated publish target but `release.yml` does
  not create one today (see `crowsnest-release-maintainer`). If `gh release view`
  returns nothing, report it as a not-yet-wired surface, not an outright
  failure, unless the operator asked to verify the GitHub release specifically.
  TODO: wire `gh release create` into the release flow, then make this check
  required.

### 2. npm

crowsnest is not published to npm today (package name `crowsnest`, distributed as
a gated Kit). The stated publish target names npm, so when it is wired:

```bash
npm view crowsnest@<VERSION> version dist-tags dist.tarball dist.integrity time.<VERSION> --json
```

Require `<VERSION>` to be published, the expected dist-tag to point at it
(`latest` for stable), and record tarball, integrity, and publish time. Until
npm publish is wired, report npm as an intentionally absent surface, not a
failure. TODO: wire the npm publish step.

### 3. R2 Kit distribution (the real distribution surface)

`.github/workflows/release.yml` uploads three objects to the
`crowsnest-releases` R2 bucket: the platform tarball, `install.sh`, and
`latest.json`. This is the live buyer distribution. Verify it through the public
gate domain (`get.crowsnest.sh`) or, with credentials, the bucket:

```bash
# latest.json advances only for a stable; an alpha/beta must not move it
curl -fsSL https://get.crowsnest.sh/latest.json
# installer is fetchable and bakes this version's sha256 + size
curl -fsSL https://get.crowsnest.sh/install.sh | grep -E 'VERSION|SHA256|SIZE'
```

- Confirm `latest.json` names `<VERSION>` for a stable release; confirm it did
  not move for an alpha or beta.
- Confirm the versioned tarball object exists
  (`releases/v<VERSION>/crowsnest-v<VERSION>-darwin-arm64.tar.gz`).
- Confirm `install.sh` bakes this version's sha256 and byte size, so a tampered
  tarball cannot verify.

### 4. Release workflow

```bash
gh run list --repo Kaiships-ai/crowsnest --workflow release.yml \
  --limit 5 --json databaseId,displayTitle,headBranch,conclusion,url
```

Confirm the `release.yml` run for `v<VERSION>` concluded success, including its
test gate, bundle build, fresh-HOME Kit smoke, and R2 upload jobs.

## Live smoke

After the distribution checks pass:

### Kit install smoke (fresh HOME)

Mirror what `release.yml` proves: install the published tarball into a throwaway
HOME and confirm the IG sidecar `/health` returns 200. In an isolated
`HOME=/tmp/crowsnest-verify/home`, extract the tarball, run the offline
sidecar-venv build the installer does, then start the sidecar and probe:

```bash
curl -s -o /dev/null -w '%{http_code}' -H "X-IG-Token: <token>" \
  http://127.0.0.1:8765/health
```

A valid smoke returns `200`. Stop the sidecar and confirm the port is no longer
listening. Do not run this against the user's real HOME or a live IG account.

### Running-app smoke

The openclaw analog probed a Gateway `/healthz`. crowsnest is a Next.js app with
no `/healthz` route today; the closest thing is the status stack-health component
(`src/components/status/stack-health.ts`). TODO: wire a `/healthz` (or
`/api/health`) route that returns a small fixed JSON so the released app has a
scriptable health endpoint. Until then, smoke the app by building and starting
it against a temp workspace:

```bash
npm run build
PORT=<free-port> npm start &
# then hit the app root and confirm it serves 200 before stopping it
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<free-port>/
```

Distinguish a real app-served 200 from a build error page. Stop the server and
confirm the port is free.

## Caveats to report

- Version caveat: state the resolved concrete version.
- Surface caveat: name each intentionally absent surface (npm, GitHub release,
  `/healthz`) as not-yet-wired rather than as a failure, unless the operator
  asked to verify it.
- `latest.json` caveat: `latest.json` is the stable release truth; an alpha or
  beta must not have moved it. Report a moved `latest.json` for a prerelease as a
  failure.
- Divergent checkout caveat: say when the local source SHA differs from the
  release tag and which live sources were used instead.
- Smoke caveat: a valid Kit smoke has the sidecar `/health` 200 plus the app
  serving 200; name which was actually run.
