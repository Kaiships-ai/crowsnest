# Package and docker proof

Read this for installable-Kit behavior, the containerized e2e lane, and failed-lane
reruns. Release identity itself belongs to `scripts/release-prep.sh` and
`.github/workflows/release.yml`, not here. Apply the boundaries in the parent
`SKILL.md` (isolated state, a free port, no operator data) before any build or run.

## Kit candidate identity

The buyer-installable Kit is built by `packaging/build-bundle.sh <version> [platform]`,
which produces `dist/crowsnest-v<version>-<platform>.tar.gz` next to a `.sha256` and a
`.size` file, then self-tests the tarball before it is considered done (relocatability
lint, native-module load, python import, server boot). Default platform is
`darwin-arm64`; runtime pins (node, python-build-standalone, uv, wheel tag) come from
`packaging/platforms.json`, so a candidate is identified by its version, platform, and
those pins, not by the repo working tree.

- Record the built version, tarball path, and the emitted `.sha256` and `.size`. Pin
  the exact version for any rerun or comparison; do not silently retarget a different
  version.
- Repo source is not the installed application. Proving install or update behavior means
  building the tarball and exercising it, not running the dev server from source.
- `packaging/release.sh <version> [platform]` is the release path: it builds the bundle,
  bakes `install.sh` from `packaging/install.sh.template` via `packaging/gen-install.sh`,
  and uploads the tarball, `install.sh`, and `latest.json` to the R2 bucket. It refuses
  to cut a version with no `## <version>` section in `packaging/CHANGELOG.md`. Building a
  bundle for proof is a shard of validation; `release.sh` and `scripts/release-prep.sh`
  own release identity, and neither should be run just to test.

## Install and gate proof

The Kit is gated: `install.sh` POSTs the buyer's license key to the Cloudflare Worker
under `packaging/worker/`, which validates it against Polar (validate only, so it never
burns an activation slot) and returns an HMAC-tokened download link. The `.sha256` and
byte size are baked into `install.sh`, so a tampered tarball fails verification even if
the Worker or bucket is compromised.

- To prove install, update, or rollback behavior, exercise the built tarball through the
  installer path (`install.sh`, `kai update`, `packaging/rollback.sh`) against isolated
  paths, never the operator's real install or config.
- To prove the download gate, test the Worker directly (a valid key returns a link, an
  invalid or missing key is refused). Use the sandbox Polar org id and API host from
  `packaging/worker/wrangler.toml`; never test the gate with a real activation.
- The operations runbook is `documents/architect/shared/packaging-ops.md` (TODO: wire if
  the ops doc lives elsewhere). Read the current input contract from the scripts and the
  Worker rather than reconstructing it from an older command.

## Docker e2e lane

The containerized end-to-end lane is owned by the `crowsnest-docker-e2e` skill, which
stands up the crowsnest stack (Next server, 9router proxy, drizzle database) in a
container and runs `scripts/e2e/run.sh` against it reproducibly.

That skill is currently a stub (TODO: it is not yet fleshed out). Until it is, there is
no committed docker e2e scheduler, scenario catalog, or per-lane artifact tree in
crowsnest. Do not invent one. For a containerized run today:

- Hand off to `crowsnest-docker-e2e` for authoring or running the lane; state the
  concrete gaps you hit rather than working around them here.
- The non-containerized browser journeys (`npm run e2e`, seeded by `scripts/seed-e2e.ts`)
  remain the available end-to-end proof. Coverage evidence is `scripts/e2e-coverage.sh`.
  Real Instagram session proof is `scripts/verify-live.sh` (a burner account and a
  running sidecar; see the script header), not a Docker lane.

## Rerun from evidence

When a build or lane fails, rerun from the recorded evidence, not from memory.

- Kit build failures: reread the `build-bundle.sh` output for the failing self-test
  phase (relocatability, native load, python import, or server boot). Rebuild the exact
  same version and platform; changing the platform or a pin in `platforms.json` is a
  different candidate, not a rerun.
- e2e failures: reread the run log under the e2e output path and rerun the smallest
  failing journey via `npm run e2e` before rebuilding anything upstream.
- CI failures on the release or ci workflow: bind the diagnosis to the exact SHA and job
  (`gh run view <run-id> --job <job-id> --log`), fetch the log once, and reuse it.
  Separate a product failure from a harness or infrastructure failure before choosing a
  retry; do not rerun the whole matrix to chase one lane.
