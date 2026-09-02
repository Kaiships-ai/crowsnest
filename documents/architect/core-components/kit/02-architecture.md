# kit: architecture

## Key files

- `packaging/README.md`, `packaging/CHANGELOG.md`: what is live and how to cut a release.
- `packaging/platforms.json`: one key per platform (today just `darwin-arm64`) pinning
  node, python-build-standalone, and uv versions. CI and the installer template both read
  this file, so a new platform is a new key plus its wheels, not a script rewrite.
- `packaging/build-bundle.sh`: builds and self-tests one tarball.
- `packaging/install.sh.template` and `packaging/gen-install.sh`: the buyer installer,
  regenerated per release with that release's version, sha256, and byte size baked in.
- `packaging/release.sh` and `.github/workflows/release.yml`: build plus bake plus upload
  to R2, run on a `macos-15` GitHub Actions runner on `git tag v<version>` push.
- `packaging/worker/`: the Cloudflare Worker that gates the R2 download (`wrangler.toml`
  holds the Polar org id and API host as `[vars]`).
- `src/cli/kai.ts`: the CLI entry point, all eight commands (`login`, `status`, `kit`
  meaning `kai kit init`, `up`, `start`, `stop`, `doctor`, `update`).
- `src/cli/license.ts`: license activation and caching against Polar's customer portal
  endpoints.
- `src/cli/service-darwin.ts`: the one macOS specific module, LaunchAgent management for
  the server and the Instagram sidecar.
- `src/cli/runtime.ts`: shared runtime helpers the other CLI modules call.

## Data flow

**Install.** The buyer's `curl | sh` fetches `install.sh` from R2 through the Worker (this
one route needs no license key, since the script itself holds no secret). The script
checks the architecture, extracts the pinned tarball once a license key unlocks a download
(see below), lays it out under `~/.kai/app/v<version>`, symlinks `~/.kai/state` (db,
config, media) into it, and flips `~/.kai/app/current` to the new version.

**License and download gate.** These are two separate checks against Polar
(`api.polar.sh`, org `ef96ed5d-6721-403c-98a8-184d43d13334`), on purpose. The Worker
(`crowsnest-gate.kaiships.workers.dev`) that gates the *download* only validates the key,
never activates it, so a download never spends one of the buyer's activation slots; on a
valid key it streams the tarball from the private R2 bucket `crowsnest-releases` behind a
15 minute HMAC signed token. `kai login <key>` is the separate call, made by
`src/cli/license.ts` directly against Polar's customer portal endpoints, that actually
activates the key and caches the result (`key`, `activation_id`, `customer_id`,
`validated_at`) as `~/.kai/entitlement.json`. Every other CLI command that needs a license
(`kit init`, `up`, `start`, `doctor`) reads that cached file rather than calling Polar
again.

**Kit init.** `kai kit init` requires a cached entitlement first. It writes `.env.local`
from `.env.example` (or edits it in place if present), prompts for the Instagram account
(`IG_USERNAME`, `IG_PASSWORD`, the latter not echoed), generates `IG_SERVICE_TOKEN` if it
is still the placeholder value, prompts for an optional `ANTHROPIC_API_KEY`, and asks for
`VAULT_PATH` (default `~/.crowsnest/vault`), creating the directory. It then runs the
database migrations and bootstrap scripts directly through `node`/`tsx` (never through
`npm run`, which would resolve to the buyer's own node if one happened to be on `PATH`),
and finally calls the same routine as `kai up`.

**Up and the services.** `kai up` and `kai start` hand off to `service-darwin.ts`, which
writes and loads LaunchAgents for the Next.js server and the Instagram sidecar so both
survive a reboot or a closed terminal. `kai up` then polls `http://localhost:3000` for up
to 25 seconds and opens it in the default browser on success; on failure it prints the
tail of the relevant log and points at `kai doctor`.

**Release.** A maintainer pushes a tag (`git tag v0.2.1 && git push origin v0.2.1`). The
release workflow builds the arm64 bundle, bakes the fresh tarball's size and sha256 into
`install.sh`, and uploads the tarball, `install.sh`, and `latest.json` to R2. It refuses to
run if `packaging/CHANGELOG.md` has no matching `## <version>` section. `kai update`
re-runs the same `install.sh` against the newer version and preserves `~/.kai/state`
through the same symlink scheme used on first install.

## Decisions

- **Ship `next build` output plus a pruned `node_modules` (prod deps and `tsx`), not a
  compiled standalone server.** The app runs through a custom `server.ts` and several
  `tsx` scripts (migrate, bootstrap); a standalone build would mean precompiling the
  server and rewriting that script family. The pruned-bundle approach costs tarball size
  but keeps the buyer's runtime identical to how the app already runs in development, so a
  release is a tag push rather than a parallel build pipeline to maintain.
- **The download gate validates only; `kai login` activates.** Keeping these separate
  means a buyer can re-download or reinstall as often as they want without spending a
  Polar activation slot; activation is spent only by an explicit `kai login`.
- **The tarball's sha256 and byte size are baked into `install.sh` at release time**, so
  even a compromised Worker or R2 bucket cannot serve a tampered build that still passes
  the installer's own verification.
- **Buyer state lives outside the versioned install directory**, at `~/.kai/state`,
  symlinked into whichever version is current. This is what lets `kai update` swap
  `~/.kai/app/current` to a new version without touching the buyer's database, config, or
  downloaded media.
- **Runtime pins are data, not code.** `packaging/platforms.json` is the one file CI and
  the installer template both read for node, python-build-standalone, and uv versions per
  platform, so supporting a new platform later is a new key and a wheelhouse build, not a
  script rewrite.
- **Apple Silicon only for v1.** `install.sh` detects a real Intel Mac (as opposed to
  Rosetta) and refuses with a refund pointer rather than attempting an unsupported build.
  Intel, Windows, and Linux are explicitly future work.

## Open, not verified end to end

Per `documents/architect/shared/packaging-and-release.md`: a Kit install has not yet been
proven to complete a live Instagram sync or a real AI analysis with real credentials; the
no-proxy LLM path (no local proxy, hitting the real Anthropic API directly) is unverified
end to end; and the install URL is presently the raw `workers.dev` subdomain rather than a
custom domain.
