# First publication preparation

Use before tagging when the release publishes to a distribution surface for the
first time, or changes which surface it publishes to. The upstream concern was a
newly publishable npm or ClawHub package; for crowsnest the equivalent is making
sure the Cloudflare R2 target and the (future) npm and GitHub-release targets are
provisioned and owned before the tag push, not discovered from a failing publish
job.

## Cloudflare R2 (the live buyer surface)

Before tagging, confirm the publish path can actually write and be read:

- The R2 bucket and its public host exist and the release workflow has write
  credentials. Resolve locators through the operator's secret store; never print
  secret values.
- The channel pointer object name is fixed (`latest.json`) and its public URL is
  the one installed Kits read. Confirm a buyer install reads that exact URL.
- The tarball and `install.sh` object naming for the new version does not collide
  with an existing published object. A published object for this version is a
  blocker to discover before publish, not after.

crowsnest has no scripted first-publication probe today. TODO: wire a read-only
preflight that fetches the current `latest.json` and asserts the target objects
for the intended version are absent, so a first or renamed surface is proven
before the tag push.

## npm (not wired today)

crowsnest is not published to npm. If a release should publish an npm package for
the first time, this is release prep, not something to bootstrap from the publish
job: confirm the package name is available or owned, the npm scope and
package-creation permission exist, and the provenance path is decided, all before
the tag push. TODO: wire the npm publish step into `release.yml` (or a
skill-driven step after the R2 upload) and record the trusted-publisher or token
contract here once it exists. Do not create placeholder versions to reserve a
name.

## GitHub release (not wired today)

`release.yml` does not create a GitHub release. If one is added, confirm the
`Kaiships-ai/crowsnest` release permission and that the body source
(`packaging/CHANGELOG.md`, `## <version>` section) renders correctly before the
first real release. TODO: wire `gh release create v<version>` and record its
exact inputs here.

Do not hide or disable a release surface merely to unblock a train. Provisioning
the surface is release prep; dropping the surface is a product decision that
needs the operator.
