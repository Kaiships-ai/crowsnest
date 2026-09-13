# Publication recovery

An interrupted or failed publication. Classify the failure before changing any
git or R2 state, repair the smallest owning surface, retry only that surface,
then reassess. Do not rerun all phases or scan moving main automatically.

## Credentials

The release workflow authenticates to Cloudflare R2 from CI secrets. Resolve
credential locators through the operator's secret store; never print secret
values or invent a login procedure in this skill. crowsnest does not use npm
OIDC trusted publishing or an environment approval gate today. TODO: wire an
approval environment and a credential contract if npm or a GitHub release is
added to `release.yml`.

## Classify the failure

- **Product defect:** repair the release branch, freeze a new Code SHA, and
  invalidate downstream product evidence. After the tag is published, move to the
  next version rather than mutating the shipped one.
- **Changelog-only defect:** replace the Release SHA with a
  `packaging/CHANGELOG.md`-only descendant, reuse the Code SHA product evidence,
  and re-qualify the changed bytes. Prove the exact single-file delta first.
- **Tooling, credential, or infrastructure failure:** keep the candidate, repair
  the smallest owning surface, retry only the failed lane. Change the Tooling SHA
  only when needed and record the invalidated evidence.

After one diagnosis, fix, and narrow retry, reassess. An operator-authorized
attempt cap counts admitted product attempts, not infrastructure retries.

## Published version, failed workflow

A `v*` tag push is immutable, and R2 objects for a published version are the
shipped bytes. Once a beta tag is pushed, use the next beta number rather than
deleting or recreating it, even before the R2 upload succeeds. Routine release
authority does not authorize destructive tag rewrites; an exceptional operator
request must name its exact scope.

An R2 upload can fail after a good build. Re-run only the upload step against the
already-built, already-smoked bytes; never rebuild a shipped version as an
implicit retry. crowsnest has no standalone "upload only" entry point today.
TODO: wire a re-upload step (or a manual `wrangler`/R2 put path) so a failed
upload does not force a rebuild. Until then, recover by re-running the upload job
of the same workflow run if possible, and confirm object identity before and
after.

## Verify the channel readback

CDN propagation can lag briefly; use bounded reads. Confirm the live surfaces
directly rather than trusting a green workflow:

```bash
# Read the published channel pointer and the tarball it names.
curl -fsSL https://<r2-public-host>/latest.json
```

The exact public R2 host is defined by `release.yml` and `packaging/`. TODO:
record the canonical public base URL here once it is fixed. `crowsnest-verify-release`
owns the full readback and smoke; prefer it over ad-hoc curls for the final call.

An existing published version may receive verification-only checks after publish;
that does not authorize republishing.
