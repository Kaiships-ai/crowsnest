# Kit distribution plan: arm64 v1

Status: final. Approved by Kai; revision 2 folds in crowsnest-37's three review items
(model default deliverable in Phase 0, real-completion assertion in Phase 5, disk
preflight in install.sh).
Locked: arm64-only, key-gated R2 download, curl|sh no notarization, license at runtime.

Two corrections to my earlier review, found by reading the repo:

1. Retract `output: 'standalone'`. The app runs through a custom `server.ts` via tsx, and
   db:migrate, db:bootstrap, and the postinstall perms fix are all tsx scripts. Standalone
   output would mean precompiling the server and rewriting the script family. Instead: ship
   `next build` output plus pruned node_modules (prod deps + tsx). Bigger tarball, zero
   divergence from how the repo already runs. Constraint 2 wins.
2. 9router is a product blocker to verify, not a packaging detail. crowsnest-up boots a
   Homebrew 9router on 20128 and LLM_BASE_URL points at it. Buyers have no 9router. If the
   app cannot do its AI analysis with LLM_BASE_URL aimed at the Anthropic API directly
   (key from kit init, stored in db), that is product work that blocks ship and is outside
   this plan. Phase 0 settles it first.

Answer to the open question: `kai up` REPLACES crowsnest-up for buyers. That skill is
dev-machine tooling (orca, browse, Homebrew paths). It stays as-is for dev. `kai up` is
start + health poll + `open http://localhost:3000`.

## Phase 0: ground truth (0.5 day, blocks everything)

Deliverables:
- Proof the app boots and completes one AI analysis with no 9router, LLM_BASE_URL at the
  real API, key from db. If it cannot: stop, report to Kai, this plan pauses.
- Audit report: every `#!/usr/bin/env node`, `npm `, `npx ` invocation reachable at
  runtime (grep src/, scripts/, package.json scripts the CLI calls). Each gets an
  absolute-path fix in Phase 1.
- Confirm server binds 127.0.0.1 (or make it so), and that the buyer URL is
  `http://localhost:3000` (Next 16 blocks Server Actions from mismatched origins; the
  printed URL and any LaunchAgent env must say localhost, the bind stays loopback).
- Model default fix. crowsnest-37's code read: src/server/llm/client.ts:235 already
  constructs `new Anthropic({ apiKey })` with no baseURL when LLM_BASE_URL is unset,
  and startRouter is only reachable from router-actions.ts (UI), never the analysis
  path. So keyless-direct works at the code level. BUT .env.example ships
  `CLAUDE_MODEL=nvidia/minimaxai/minimax-m2.7`, a router-only model id. Proxy dropped
  plus that model means every analysis 404s against the real API. Deliverable: kit
  init writes a real Anthropic model id as the buyer default, and .env.example's
  CLAUDE_MODEL is corrected for buyers. The exact model id is Kai's call, get it
  named before closing this phase; do not invent one.

Proven by: one screenshot-level run: clean env, no 9router process, analysis completes
against the real API with the new default model id.

## Phase 1: the bundle and CI build (1.5 days, long pole)

### Bundle layout (inside crowsnest-v{X.Y.Z}-darwin-arm64.tar.gz)

```
VERSION                  # version, arch, git sha, build date; kai doctor prints it
bin/
  kai                    # sh shim: exec "$ROOT/bin/node" "$ROOT/app/node_modules/.bin/tsx" "$ROOT/app/src/cli/kai.ts" "$@"
  node                   # pinned node arm64 binary
  uv                     # pinned uv static binary
runtime/python/          # python-build-standalone CPython 3.12, relocatable
app/
  .next/  server.ts  src/  drizzle/  scripts/  public/  package.json  next.config.*
  node_modules/          # prod deps + tsx, natives built in CI, pruned
  services/ig/           # source + pyproject.toml + uv.lock, NO venv
wheelhouse/              # cp312 macosx arm64 wheels for services/ig locked deps
.env.example
```

Buyer state lives OUTSIDE version dirs, linked in at install time:

```
~/.kai/
  app/v0.2.0/            # immutable, from tarball
  app/current -> v0.2.0  # atomic symlink flip
  state/data/            # crowsnest.db, media/, ig-session.json
  state/env.local        # written by kit init
  bin/kai -> app/current/bin/kai
```

`app/vN/data -> ~/.kai/state/data` and `app/vN/.env.local -> ~/.kai/state/env.local` are
symlinks created per version dir. No app code change: relative paths keep working, and
updates preserve db + env for free.

### CI (GitHub Actions, macos arm64 runner, single "release" workflow on tag push)

All platform pins live in one `platforms.json` (per row: node url+sha, python url+sha,
uv url+sha, wheel platform tag). CI matrix and the install.sh template both read it.
Adding linux/x64 later is a new row plus wheels, not new workflow code. That is
constraint 3 in one file.

1. setup-node pinned to the EXACT bundled node version. `MACOSX_DEPLOYMENT_TARGET=12.0
   npm ci` builds better-sqlite3 and node-pty against that ABI.
2. `next build`.
3. Prune to prod deps + tsx (`npm prune --omit=dev`, then re-add tsx). Strip test/docs
   dirs and sourcemaps from node_modules.
4. Fetch node, uv, python-build-standalone per platforms.json, verify their sha256s.
5. Wheelhouse: from the bundled python, `pip download --only-binary=:all:` for every dep
   in uv.lock (export via `uv export`), platform tag from platforms.json. Strip
   __pycache__ and tests.
6. Stamp VERSION (tag is the version source of truth, not package.json).
7. tar + gzip, record sha256 + byte size.
8. Smoke test in CI, same job: extract to an unrelated temp path, then
   - relocatability lint: `grep -r "$HOME" extracted/` excluding known-safe hits = 0.
     This one grep kills the entire absolute-path bug class.
   - `bin/node -e "require('better-sqlite3'); require('node-pty')"` = ABI proof.
   - `bin/uv venv --python runtime/python && bin/uv pip install --no-index
     --find-links wheelhouse -r <exported reqs>` then
     `uv run python -c "import crowsnest_ig"`.
   - boot server via bin/kai path, curl localhost 200, kill.
9. Upload to R2, regenerate install.sh from template (version + sha256 + size baked in),
   upload install.sh + latest.json.

Release cut for Kai: `git tag v0.2.1 && git push --tags`. That is the whole ritual.

Proven by: CI green on all of step 8; tarball on R2; second push of the same tag fails
loudly instead of overwriting.

## Phase 2: install.sh (1 day)

POSIX sh, set -eu, regenerated per release. Ordered spec:

1. Arch guard. `uname -s` must be Darwin. `uname -m` x86_64 with
   `sysctl -n sysctl.proc_translated` = 1 means Rosetta on Apple Silicon: proceed as
   arm64. Real Intel: print the refund/support URL and a one-line reason, exit 1.
2. Disk-space preflight: `df` on ~/.kai's volume before download. Need headroom for
   tarball + extracted tree + venv (compute the number from the real v1 bundle, bake it
   into the generated install.sh alongside the checksum; use a safety margin on top).
   Short: refuse early, print required vs available in MB, exit 1. A half-failed
   extract on a full disk is a support email.
3. License key. Order: `--key` arg, then `KAI_LICENSE_KEY` env, then cached
   `~/.kai/entitlement.json` key (update path), then prompt. The prompt MUST read from
   /dev/tty, not stdin: under curl|sh, stdin is the script.
4. Gate call: POST to the worker with {key, platform, version}. Worker returns a signed
   R2 URL only. The sha256 and byte size are baked into this install.sh, so a
   compromised worker or bucket cannot serve a tampered tarball that verifies. 401
   prints "key not recognized" + support link, exit 1.
5. Download to ~/.kai/tmp with `curl --retry 3 --retry-delay 2 -fL`. Verify byte size
   first (cheap), then sha256. Mismatch: delete, one retry, then abort with message.
6. Extract to `~/.kai/app/v{X}.partial`, then `mv` to `v{X}`. Any `.partial` found at
   start of a run is deleted. kill -9 mid-extract therefore cannot corrupt an install.
7. `xattr -dr com.apple.quarantine ~/.kai/app/v{X}` unconditionally. Free on the curl
   path, saves the buyer who downloaded by hand.
8. Create `~/.kai/state/data`, link `v{X}/data` and `v{X}/.env.local` into state as
   above.
9. Python bootstrap (here, not kit init, so failure surfaces before the buyer invests):
   `bin/uv venv` at `v{X}/services/ig/.venv` with the bundled python,
   `uv pip install --no-index --find-links ../wheelhouse`. Fully offline.
10. Flip: `ln -sfn` to a temp name then `mv` over `app/current`. If a previous version
   was running (`kai status` says so), run `kai _postupdate` (db:migrate) and restart
   the service. Keep exactly one previous version dir, delete older.
11. PATH: link `~/.kai/bin/kai`, append one guarded line to the detected rc file (zsh
    default; handle bash and fish), print it either way.
12. Final output, three lines max: version installed, then next command. Fresh install:
    `kai login`, then `kai kit init`. Update: "done, vX -> vY".

`kai update` = fetch install.sh from its stable URL and run it, passing the cached key.
Same script is installer and updater. Given instagrapi's breakage cadence and "lifetime"
buyers, this update path is load-bearing, not optional.

Proven by: shellcheck clean; the Phase 5 kill-mid-extract and update tests.

## Phase 3: R2 and gate worker (0.5 day, parallel with Phase 1)

Bucket `crowsnest-releases` (private):

```
install.sh                       # latest, served by worker at a stable URL
latest.json                      # {"version": "X.Y.Z"}
releases/v{X}/crowsnest-v{X}-darwin-arm64.tar.gz
releases/v{X}/manifest.json      # version, per-platform sha256 + size
```

Cloudflare Worker, stateless, two routes:
- GET /install.sh: proxy from bucket, no auth. The script holds no secrets.
- POST /download: validate key against the same Polar customer-portal VALIDATE endpoint
  license.ts uses (validate only, never activate: a download check must not burn one of
  the two activation slots). Valid: presigned R2 URL, 15 minute TTL. Log key hash +
  timestamp, basic per-key rate limit.

Org id and Polar host are worker env vars, same values license.ts already uses.

Proven by: unauthenticated GET on any releases/ path = 403; POST with the sandbox key =
working URL; POST with garbage = 401; the URL dies after TTL.

## Phase 4: kai commands (1 day, parallel after Phase 1 layout freeze)

Service management goes in ONE new file (src/cli/service-darwin.ts) behind a small
interface. That file is the only genuinely macOS-coded part; Windows/Linux later means
one new file each (systemd unit, Windows service), not edits across commands.

- kai start: write + bootstrap two LaunchAgents if missing, load both.
  com.crowsnest.server: `bin/node .../tsx server.ts`, absolute paths only, cwd
  app/current/app, PORT=3000, KeepAlive, RunAtLoad, stdout/err to ~/.kai/logs/.
  com.crowsnest.ig: uvicorn sidecar on 8765 via the venv, same pattern.
  Survives reboot and closed terminals by construction.
- kai stop: bootout both. kai status: launchctl state + HTTP poll on 3000 and 8765 +
  entitlement summary (cached, no network).
- kai up: start + poll until 200 (20s budget) + `open http://localhost:3000`. On
  failure, print the last 10 log lines and the failing service name.
- kai doctor: VERSION contents; arch; `require('better-sqlite3')` through bundled node;
  `uv run python -c "import crowsnest_ig"`; db file present + pending migrations; ports;
  disk free; log paths. Read-only, no network. `--bundle` (v1.1) tars logs + VERSION +
  env with IG_PASSWORD and key redacted.
- kai update: as Phase 2. Refuses to run if the gate says current version is latest,
  unless --force.
- kit init changes: env lands in ~/.kai/state/env.local through the symlink
  (transparent, no code change expected); after prompts, call kai start; keep the
  existing prompt/migrate/bootstrap flow untouched.

Proven by: reboot the test machine, dashboard reachable without touching a terminal;
`kai doctor` exits nonzero when the venv is deleted and says why.

## Phase 5: verification (1 day, the gate before Kai sees it)

1. Second macOS user account on the build Mac (cheapest different-username,
   different-HOME environment; a UTM VM is better if time allows). Full buyer journey:
   paste one command, key prompt, kai login, kit init, kai up, dashboard, one IG sync,
   and one AI analysis that COMPLETES against the real Anthropic API. The completion is
   an explicit pass/fail: a returned analysis rendered in the UI, not a booted server.
   Same-machine tests and mocks both hide a wrong model default; this is the only place
   it gets caught before a buyer. Zero unexpected macOS dialogs (firewall prompt absent
   because bind is loopback).
2. Poison test: Homebrew node of a different major first in PATH. Everything still
   green. Catches any missed env-node shebang.
3. kill -9 during extract, rerun, clean install.
4. Update test: install vN, add a row to the db, write env.local, release vN+1 (CI run),
   kai update. Db row and env intact, migrations ran, service restarted.
5. Revoked-key test: gate worker 401s, installer message is the written one.

## Constraint conflicts and calls

- Buyer-easy vs maintainer-easy: shipping tsx + full pruned node_modules instead of a
  compiled server costs maybe 100MB and a second of boot; it keeps buyer runtime
  identical to dev and release = tag push. Maintainer wins, buyer never notices.
- Buyer-easy vs maintainer-easy: the key gate adds a worker to run. Locked already;
  the /dev/tty detail and the cached-key reuse in kai update are what keep it from
  hurting buyers on day 2.
- Maintainer-easy vs cross-platform-later: resisting per-OS branches in scripts.
  Everything platform-specific is data (platforms.json) or one module
  (service-darwin.ts). install.sh grows a case on uname reading the same baked table.
- Buyer-easy vs cross-platform-later: launchd is the right v1 call even though it is
  the least portable piece; the interface seam contains it.

## Cut line

Ship v1 (target): Phases 0-3, kai start/stop/status/up/update, doctor in read-only
form, verification items 1-4. Without any one of these the product either does not
install, does not survive a reboot, or cannot be fixed post-sale.

v1.1: doctor --bundle, kai rollback (the N-1 dir is already kept, command is trivial
later), worker rate-limit hardening, uninstall command (v1 ships a doc line:
`kai stop && rm -rf ~/.kai`), Intel/other platforms.

## Estimate, pointed at crowsnest-37 + parallel sessions

Serial person-days: 0.5 + 1.5 + 1 + 0.5 + 1 + 1 = 5.5. Wall clock with parallel
sessions (Phase 3 fully parallel; Phase 2 and 4 start once the Phase 1 bundle layout
and platforms.json shape are frozen, day 1): 3.5 to 4 days. The 3-4 day target holds
ONLY if Phase 0 finds the no-9router path already works. If it does not, that is
product work of unknown size and the honest answer is "blocked, ask Kai" on day 1, not
a slipped estimate on day 4.
