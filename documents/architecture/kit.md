# Kit

The Kit is the buyer-facing distribution of crowsnest: one tarball per platform plus the `kai` command line tool that installs, licenses, configures, updates, and runs the product on a buyer's Mac. The buyer runs four lines (`curl ... | sh`, `kai login <key>`, `kai kit init`, `kai up`) and needs no Node, Python, git, Xcode, Homebrew, or sudo. The bundle carries its own runtimes. Apple Silicon only for now.

crowsnest is sold as a one-time purchase that runs locally, so the install must work for a non-developer, and the download must be gated by a license so a shared link is useless. The Kit runs the headless `server.ts` (MCP at `/api/mcp` and the jobs, no UI); everything the buyer sees in an app belongs to the app, not to the Kit.

## Data it holds

The Kit owns no database table. `kai kit init` runs the same `src/server/db/migrate.ts` and `bootstrap.ts` scripts the dev repo uses, but writes nothing into the tables itself. Its state is flat files:

- `~/.kai/state/entitlement.json` (mode 0600; `$KAI_HOME` overrides the root): the cached license (`key`, `activation_id`, `customer_id`, `validated_at`), written by `kai login`.
- `~/.kai/app/v<version>/` and the `~/.kai/app/current` symlink: installed versions. The installer keeps exactly one previous version.
- `~/.kai/state/data`: the database and media, symlinked into each version's `data` directory so updates keep buyer data.
- `<app>/.env.local` (mode 0600): written by `kai kit init`. The installer symlinks `~/.kai/state/env.local` into a new version only when that file exists.
- `~/Library/LaunchAgents/com.crowsnest.server.plist` and `com.crowsnest.ig.plist`: written by `kai start` and `kai up`.
- `~/.kai/logs/<label>.log`: service logs.
- `packaging/platforms.json`: the one file pinning node, python-build-standalone, and uv per platform. `packaging/CHANGELOG.md`: one `## <version>` section per release.

Release infrastructure (outside the repo): a Cloudflare Worker gate (`crowsnest-gate.kaiships.workers.dev`), the private R2 bucket `crowsnest-releases` (holds `install.sh`, `latest.json`, and `releases/v<version>/crowsnest-v<version>-darwin-arm64.tar.gz`), and the production Polar organization for licenses.

## Boundaries

- Owns: `packaging/` (bundle build, installer template, release and rollback scripts, `worker/` gate), `src/kai-cli/` (`kai.ts`, `license.ts`, `service-darwin.ts`, `runtime.ts`, `mcp-register.ts`), `scripts/release-prep.sh`. No release workflow exists in `.github/workflows/`; the Kit is not shipping yet.
- Called by: the buyer from a terminal. Every other component depends on the Kit having put the app on disk and started the server and the Instagram sidecar.
- Calls: Polar (`api.polar.sh`) for activation and validation, the gate worker for the signed download, launchd for the two services, the app's `/api/mcp` endpoint to register MCP clients, and Claude Code and Codex configuration for registration.
- CLI surface: `login`, `status`, `kit init`, `up`, `start`, `stop`, `mcp`, `doctor`, `update`, `rollback`, plus the internal `_postupdate` hook the installer calls after an update.

## Invariants

- The download gate validates and never activates. Only `kai login` spends one of the two Polar activation slots, so reinstalling is free. `login` reuses a matching cached activation instead of activating again (`src/kai-cli/license.ts`).
- The tarball is never public. The worker mints a 15 minute HMAC token for one R2 object (`TOKEN_TTL_SECONDS` in `packaging/worker/src/index.ts`). `install.sh` also bakes the release's byte size and sha256, so a tampered object or worker fails verification and the file is deleted.
- Extraction is atomic. A new version is built in a `.partial` directory and moved into place, and `current` flips only after the Python venv is built offline from the bundled wheelhouse. A killed install never leaves a half-extracted `current`.
- Buyer state lives outside the version directory, so `kai update` and `kai rollback` swap versions without touching data. `kai rollback` refuses when the two versions' `drizzle/` migrations differ.
- The installer and `kai login` read and write the same entitlement path (`~/.kai/state/entitlement.json`). `readEntitlement` migrates a pre-existing `~/.kai/entitlement.json` forward once. The install URL default in `kai update` equals the installer's own (`DEFAULT_INSTALL_URL` in `src/kai-cli/kai.ts`).
- Secrets never echo and never half-write. The `ask({ secret: true })` prompt reads raw TTY input byte by byte. `checkPairedIgCreds` refuses to write `.env.local` with only one of `IG_USERNAME` and `IG_PASSWORD`, mirroring the sidecar's own pairing rule. `.env.local` is chmod 0600 after write. Prompts read through one readline async iterator, so piped input (`kai kit init < answers`) does not drop lines.
- Scripts run through `node -> tsx` with the bundled node, never `npm run`, which would resolve a buyer's own node and break native module ABI (`runScript` in `kai.ts`).
- The sidecar's launchd environment comes from the secrets store (`getOrCreateServiceToken`, `IG_USERNAME`, `IG_PASSWORD`) and every plist value is XML-escaped, because a password with `&`, `<`, or `>` would otherwise make `launchctl` reject the plist (`src/kai-cli/service-darwin.ts`).
- The server binds `127.0.0.1` so macOS never shows the incoming-connections prompt. `kai up` polls `localhost:3000` for up to 25 seconds, treating 200, 307, and 404 as up, then checks the sidecar's `/health` and tails its log if that fails.
- `kai doctor` is read-only, prints every check even after a failure, and makes no network call except the loopback sidecar `/health` and the MCP `tools/list` probe. It does not test live Instagram credentials.
- `kai mcp` registration is never fatal; the printed config is the fallback. `kai update` and `kai rollback` refuse in the dev repo.
- Platform code stays behind one small interface in `service-darwin.ts` (`services`, `start`, `stop`, `running`, `installed`). Adding a platform is a new `platforms.json` key plus wheels and a sibling module.
- `release.sh` refuses a version with no matching `## <version>` section in `packaging/CHANGELOG.md`.

## Release flow

`packaging/README.md` covers the bundle layout, the gate, one-time Cloudflare setup, and `release.sh`. These facts are not there.

- Cutting a release: `scripts/release-prep.sh <version>` first refuses unless the CI run for HEAD finished green (`gh run list --commit`), then bumps the version, writes the CHANGELOG section, commits, and tags, and stops. A human reviews and pushes `git push origin main v<version>`.
- No CI workflow builds or uploads a release; `ci.yml` is the only workflow. Native modules and the arm64 wheelhouse must build on arm64.
- `packaging/rollback.sh <version>` re-points `install.sh` and `latest.json` at an already uploaded version without rebuilding.
- Worker secret: `TOKEN_SECRET`, set with `wrangler secret put TOKEN_SECRET`.
- Runtime pins today: node 22.23.1, python-build-standalone 3.12.14, uv 0.12.8 (`packaging/platforms.json`).
- The live install URL is the raw `workers.dev` subdomain. `packaging/README.md` still names `get.crowsnest.sh`, which is not set up.
- Not proven: no Kit install has completed a live Instagram sync with real credentials (the one buyer test left them blank). Intel Macs, Windows, and Linux are future; `install.sh` refuses a real Intel Mac with a refund pointer and lets Rosetta on Apple Silicon through.

## Where to look

- `src/kai-cli/kai.ts`: all commands, `ask`, `cmdKitInit`, `cmdUp`, `cmdDoctor`, `cmdUpdate`, `cmdRollback`.
- `src/kai-cli/license.ts`: Polar activation, validation, entitlement cache.
- `src/kai-cli/service-darwin.ts`: LaunchAgent plists and service env.
- `src/kai-cli/runtime.ts`: bundle versus dev repo paths (`isBundle`, `stateDir`, `logDir`).
- `packaging/install.sh.template` and `gen-install.sh`: the eleven installer stages.
- `packaging/worker/src/index.ts`: the gate routes (`/install.sh`, `/latest.json`, `/download`, `/dl`).
- `packaging/build-bundle.sh`, `release.sh`, `rollback.sh`.
