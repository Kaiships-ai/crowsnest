# kit: feature description

The Kit is what a buyer runs, not what they see in the app. Its whole surface is a
shell installer and one command line tool, `kai`, with eight subcommands. This
document describes each of them feature by feature: what the buyer types, what
happens, what states it can land in, and where it is known to break. The authority
for scope is `01-concept-brief.md` and `02-architecture.md` in this folder; the
behavior below is read from `packaging/install.sh.template`, `src/cli/kai.ts`,
`src/cli/license.ts`, `src/cli/service-darwin.ts`, and `src/cli/runtime.ts`.

The happy path is four lines, in order:

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

`kai kit init` ends by calling the same routine as `kai up`, so a first-time buyer
who runs `kit init` never needs to type `kai up` separately; the fourth line is the
one they use on every later start.

## Install: `curl | sh`

### Summary

The installer (`packaging/install.sh.template`, baked per release by
`packaging/gen-install.sh`) puts the whole product on disk under `~/.kai` with no
Node, Python, git, Xcode, Homebrew, or sudo. It is fetched from the gate Worker on a
route that needs no license (`install.sh.template:5`); the script itself holds no
secret, so it is the one download that is public. Everything it then pulls is gated.

The script runs eleven numbered stages (the section banners in the template): an
architecture guard, license-key resolution, the download gate, a disk preflight, a
verified download, an atomic extract, buyer-state linking, an offline Python
bootstrap, a `current` symlink flip, a PATH edit, and the closing next-steps print.

### The simple case

The buyer pastes the `curl | sh` line. The script confirms the machine is Apple
Silicon, prompts `Paste your crowsnest license key:` on the terminal
(`install.sh.template:51`), exchanges that key at the gate's `/download` route for a
15-minute signed R2 URL, downloads the tarball for the baked `__VERSION__`, checks
its byte size and sha256 against the values baked into the script at release time,
extracts it to `~/.kai/app/v<version>`, sets up the Instagram helper's Python venv
from the bundled wheelhouse with no network, flips `~/.kai/app/current` to the new
version, symlinks `~/.local/bin/kai`, adds `~/.local/bin` to PATH if it is missing,
and prints the three next commands (`install.sh.template:160-163`). No app has
started yet; the installer only lays files down.

### States and branches

- **Architecture guard** (`install.sh.template:28-36`). A non-Darwin OS dies with
  "crowsnest is macOS only right now. Reply to your receipt for a refund." A real
  Intel Mac dies with "crowsnest needs an Apple Silicon Mac (M1 or newer). Yours is
  Intel. Reply to your receipt for a refund." Rosetta on Apple Silicon reports
  `x86_64`, so the script disambiguates with `sysctl.proc_translated` and lets a
  translated shell through.
- **License-key resolution** (`install.sh.template:38-53`). The key is taken, in
  order, from a `--key` argument, the `KAI_LICENSE_KEY` env var, a cached key in
  `$STATE/entitlement.json` (the update path — it prints "Reusing your saved license
  key."), then an interactive `/dev/tty` prompt. Under `curl | sh`, stdin is the
  piped script, so the prompt reads from `/dev/tty`, not stdin; with no terminal and
  no key it dies with a rerun hint.
- **Download gate** (`install.sh.template:55-61`). It POSTs `{key, platform,
  version}` to `$GATE_URL/download` and parses a `url` field out of the reply. No
  `url` means "License not recognized. Check the key from your receipt and try
  again." The gate validates the key against Polar but never activates it, so an
  install (or reinstall) never spends an activation slot.
- **Disk preflight** (`install.sh.template:63-67`). `df -m $HOME` must show at least
  the baked `__REQUIRED_MB__` (tarball + extraction + venv) free, else it dies
  before downloading.
- **Verified download** (`install.sh.template:69-78`). `curl -fL --retry 3`. A wrong
  byte size or a sha256 mismatch deletes the file and dies ("Checksum mismatch. The
  download was corrupted or tampered with. Rerun."). Because the size and sha256 are
  baked into the script at release time, a tampered R2 object or Worker cannot serve
  a build that still passes this check.
- **Atomic extract** (`install.sh.template:80-92`). It extracts to
  `v<version>.partial`, removes any older same-version dir, then `mv`s the partial
  into place, so a killed run never leaves a half-extracted version as `current`. It
  also clears the `com.apple.quarantine` xattr for the buyer who downloaded by
  browser rather than curl.
- **Buyer state linked in** (`install.sh.template:94-97`). `~/.kai/state/data` is
  created and symlinked to `<version>/app/data`, and `state/env.local` — if present
  from a prior install — is symlinked to `<version>/app/.env.local`. This is what
  lets an update swap versions without touching the buyer's database or config.
- **Offline Python bootstrap** (`install.sh.template:99-112`). The bundled `uv`
  creates the sidecar venv from the bundled `runtime/python` and installs the
  sidecar's dependencies from `$APP/wheelhouse` with `--no-index` (no network). A
  failure here dies pointing at `kai doctor`.
- **Flip current + launcher** (`install.sh.template:114-132`). It flips `current` to
  the new version, links `~/.local/bin/kai`, keeps exactly one previous version, and
  on an update (an existing `current` symlink) runs `kai _postupdate` (db migrate,
  and restart the services if they were running).
- **PATH** (`install.sh.template:134-153`). If `~/.local/bin` is not on PATH it
  appends the right line to `.zshrc`, `.bash_profile`, `.bashrc`, or fish config for
  the buyer's shell, and tells them to open a new terminal.

### Edge cases

- The install and the update share one script; the only branch between them is
  whether `current` already exists (`install.sh.template:115-116`). An update reuses
  the cached key, migrates, and restarts; a first install prints the three next
  steps.
- The download URL in the gate is time-boxed (15 minutes). A very slow link that
  outlasts the token would fail the download, not the size or checksum check.
- The next-steps footer echoes the buyer's key back on screen as `kai login <KEY>`
  (`install.sh.template:161`), so the key lands in scrollback on a fresh install.

## `kai login <key>`

### Summary

`kai login` is the only command that spends a Polar activation. It activates the key
(claiming one of two slots), validates it, and caches the result as
`~/.kai/entitlement.json` (`0600`), which every later license-gated command reads
instead of calling Polar again. Polar's customer-portal endpoints are used directly
by `src/cli/license.ts` with no bearer token — the key is the credential
(`license.ts:7-11`).

### Behavior, step by step

- With no key argument it dies "Usage: kai login <license-key>" (`kai.ts:96`).
- It prints "Checking your license with Polar..." then calls `login(key)`
  (`kai.ts:98-99`).
- `login` (`license.ts:160-178`) reuses this machine's cached activation when the
  cached key matches, re-validating it rather than activating again — activating on
  every login would burn both slots the second time the same buyer runs it. A
  revoked or disabled license (a `fatal` `LicenseError`) is final; any softer failure
  (the activation was removed in the portal, stale cache) triggers a fresh activate.
- `activate` (`license.ts:75-102`) claims a slot. A 404 means "That license key was
  not found. Check it for typos..."; a 403 means the key is already active on 2
  machines with a pointer to deactivate one in the Polar portal.
- `validate` (`license.ts:108-133`) is the call that actually proves entitlement. A
  non-`granted` key status is a fatal refusal even on an HTTP 200.
- On success it writes `{key, activation_id, customer_id, validated_at}` to
  `entitlement.json` at `0600` (`license.ts:145-153`) and prints "License active.
  Saved to <path>" and "Next: kai kit init". A missing customer id is tolerated with
  a note (`kai.ts:100-102`).
- A network failure that is not a `LicenseError` dies "Could not reach Polar:
  <message>" (`kai.ts:105`).

### Edge cases

- The download gate (in `install.sh`) and `kai login` are two separate Polar checks
  on purpose: the gate validates only, `login` activates. A buyer can reinstall
  freely without spending a slot; only `login` spends one.
- The activation label defaults to the machine hostname (`license.ts:75`), so the
  two slots show up in the Polar portal by machine name.

## `kai kit init`

### Summary

`kai kit init` is the one step where the buyer's own secrets go in. It requires a
cached entitlement first, writes `.env.local` (from `.env.example` or in place),
prompts for the Instagram account and an optional Anthropic key, generates the
sidecar shared token, creates the vault directory, runs the database migrations and
bootstrap, and then hands off to `kai up`. It is the setup command; everything the
buyer does after the dashboard opens belongs to onboarding and the rest of the app.

### Behavior, step by step

1. **License gate** (`kai.ts:120-122`). No cached entitlement dies "No license
   found. Run `kai login <license-key>` first."
2. **Env file** (`kai.ts:124-132`). It copies `.env.example` to `.env.local` if
   absent ("Created .env.local from .env.example"), otherwise edits the existing file
   in place, keeping comments and ordering (`setEnv`, `kai.ts:75-79`).
3. **Instagram account** (`kai.ts:134-141`). It prints a throwaway-account warning,
   prompts `IG_USERNAME`, and only if a username was given prompts `IG_PASSWORD (not
   echoed)` as a secret. See the known defects below.
4. **Sidecar token** (`kai.ts:143-147`). If `IG_SERVICE_TOKEN` is still a `change-me`
   placeholder it is replaced with a random UUID; the buyer never types it.
5. **Anthropic key** (`kai.ts:149-152`). It prompts `ANTHROPIC_API_KEY (blank to
   skip, not echoed)` as a secret; blank leaves it unset, and the app's keyless
   Create-Prompt export still works, while AI analysis and the Vault pipeline need it.
6. **Vault path** (`kai.ts:154-157`). It prompts `VAULT_PATH` defaulting to
   `~/.crowsnest/vault` and creates the directory.
7. **Write** (`kai.ts:159-164`). It closes the prompt, writes `.env.local` at `0600`,
   and re-`chmod`s to `0600` (because `copyFileSync` may have left `0644` and the
   file now holds the IG password).
8. **Database** (`kai.ts:166-177`). In the dev repo it runs `npm ci`; in a bundle the
   deps already ship, so it skips that. It then runs `migrate.ts` and `bootstrap.ts`
   through `node -> tsx` directly, never `npm run` — `npm run` would resolve to a
   buyer's own Homebrew node and crash on the native-module ABI. Migrations create the
   tables; bootstrap inserts the built-in filter presets (bootstrap alone on a fresh
   db dies on "no such table").
9. **Handoff** (`kai.ts:179-180`). It prints "Kit ready. Starting crowsnest..." and
   calls `cmdUp()`, so `kit init` flows straight into a running dashboard.

### Prompt input model

Prompts are read through one readline interface's async iterator, not
`question()` (`kai.ts:31-70`). The comment explains why: `question()` drops lines
when stdin is a pipe, so `kai kit init < answers` (piped, non-interactive) works
because the iterator queues the lines. A secret prompt suppresses the echo by
temporarily replacing readline's `_writeToOutput` while `process.stdin.isTTY` and an
echo function exist (`kai.ts:58-68`).

### Known defects (from a real buyer test — `evidence/10-onboarding-bugs.md`)

These are real, confirmed on a live-credential install (#20), and both live in the
`ask({ secret: true })` path (`kai.ts:51-70`), not in the app.

- **BUG 1 (blocker): `IG_PASSWORD` saved empty on a real TTY.** The masked
  `IG_PASSWORD (not echoed):` prompt returns an empty string on a real terminal, so
  `if (igPass)` at `kai.ts:140` is false and no password is written; `.env.local` is
  left with `IG_PASSWORD=` (length 0). The Instagram sidecar then refuses to start —
  "IG_USERNAME and IG_PASSWORD must be set together", exit 78 (`EX_CONFIG`) — and
  launchd's KeepAlive crash-loops it, so port 8765 never comes up. `IG_USERNAME` (the
  non-secret prompt just before) saves fine; only the secret read after it comes back
  empty. This kills Instagram sync for every buyer who runs `kit init`
  interactively. The piped path (`kit init < answers`) is unaffected, which is why
  it is a TTY-specific defect rather than a general one.
- **BUG 2: `ANTHROPIC_API_KEY` echoed in plaintext.** The same secret path fails to
  suppress the echo on this TTY, so the Anthropic key is printed as typed and lands
  in terminal scrollback (`kai.ts:151`, via `ask({ secret: true })`). Functionally
  the key is still saved, so this is a security/UX defect, not a blocker.

Both point at the `_writeToOutput` + async-iterator approach in `ask` not behaving
as intended on a real terminal. The fix belongs in `src/cli/kai.ts`.

### Edge cases

- Re-running `kit init` edits the existing `.env.local` in place rather than
  clobbering it, so a buyer can re-run to change one value — but BUG 1 means a
  re-run through a real TTY still cannot set the IG password.
- `kit init` always ends by starting the services (via `cmdUp`), so a failed IG
  password (BUG 1) surfaces immediately as a sidecar that will not come up, visible
  in `kai status` and `kai doctor`.

## `kai up` / `kai start` / `kai stop`

### Summary

These three drive the two launchd LaunchAgents (`src/cli/service-darwin.ts`): the
Next.js server (`com.crowsnest.server`, node -> tsx -> `server.ts`, bound to
`127.0.0.1:3000`) and the Instagram sidecar (`com.crowsnest.ig`, the venv python
running `-m crowsnest_ig`). Both are set `RunAtLoad` and `KeepAlive`
(`service-darwin.ts:67-68`), so they survive a reboot or a closed terminal.

### Behavior

- **`kai start`** (`kai.ts:191-195`) requires a license, writes and (re)loads both
  plists, and prints "crowsnest services started (server on 3000, Instagram helper on
  8765)." `start()` (`service-darwin.ts:83-96`) is idempotent: it `bootout`s an
  already-loaded label first so a changed plist (a new version dir after an update)
  takes effect, then `bootstrap`s it.
- **`kai up`** (`kai.ts:224-237`) starts the services, then polls
  `http://localhost:3000` for up to 25 seconds (`poll`, `kai.ts:202-214` — it treats
  200, 307, or 404 as "up"). On success it prints "crowsnest is running:
  http://localhost:3000" and opens the URL in the default browser. On timeout it
  prints "The dashboard did not come up within 25s.", tails the last 10 lines of the
  server log, and dies pointing at `kai doctor`.
- **`kai stop`** (`kai.ts:197-200`) `bootout`s both labels and prints "crowsnest
  services stopped." It needs no license.

The server env sets `HOST=127.0.0.1` so macOS never shows the "accept incoming
connections" firewall prompt (`service-darwin.ts:28-30`). Logs for both services go
to `~/.kai/logs/<label>.log` (`service-darwin.ts:52`, `runtime.ts:41`).

### Edge cases

- `kai up` reports the sidecar on 8765 in its start message even though that port is
  the sidecar's own config, not set in the plist env; if BUG 1 left the IG password
  empty, the sidecar crash-loops and 8765 never actually opens, but the server on
  3000 still comes up and the dashboard still opens.
- `kai up`'s poll accepts a 404 as "the server answered", so it opens the browser as
  soon as the Next server responds at all, not only on a fully-rendered dashboard.

## `kai status`

`kai status` (wired to `cmdStatusFull`, `kai.ts:239-246`) prints the license line —
"active (activation <id>)" or "not logged in" — then, for each service, "running",
"stopped", or "not installed", read from launchd via `svc.running`/`svc.installed`
(`service-darwin.ts:108-120`). It touches no network.

Note: a second, shorter `cmdStatus` (`kai.ts:109-117`) exists but is not wired to any
command; the `status` case calls `cmdStatusFull`. The unused function is dead code.

## `kai doctor`

`kai doctor` (`kai.ts:249-287`) is a read-only health check that never touches the
network. It prints an `[OK]`/`[!!]` line per check: the VERSION file, bundle-vs-dev
mode, that the native modules (`better-sqlite3`, `node-pty`) load, that the sidecar
venv python exists and `crowsnest_ig` imports, that `.env.local` exists, that an
entitlement is cached, and the running state of each service. In a bundle it also
checks the bundled `uv` and the wheelhouse are present. It is the command every
failure path (install Python bootstrap, `kai up` timeout, missing venv) points the
buyer at.

## `kai update`

`kai update` (`kai.ts:297-305`) requires a license and refuses to run in the dev repo
("kai update is for installed builds, not the dev repo."). It re-runs the installer —
`curl -fsSL <INSTALL_URL> | bash` — which reuses the cached license key and the
`~/.kai/state` symlink scheme, so the buyer never retypes the key and their database,
config, and media survive. On failure it dies "Update failed. Your current version is
untouched." The installer's own update branch then migrates the db and restarts the
services if they were running (`install.sh.template:130-132`, via `kai _postupdate`).

### Known inconsistencies

- `kai update` defaults its install URL to `https://get.crowsnest.sh/install.sh`
  (`kai.ts:300`), but per `documents/architect/shared/packaging-and-release.md` that
  custom domain is not set up — the live install URL is the raw
  `crowsnest-gate.kaiships.workers.dev` subdomain. An update on a machine without
  `KAI_INSTALL_URL` set would hit an unconfigured host. This is a latent packaging
  gap, not yet proven in the field.
- The installer reads the cached key from `$STATE/entitlement.json`
  (`install.sh.template:43`, i.e. `~/.kai/state/entitlement.json`), while `kai login`
  writes the entitlement to `~/.kai/entitlement.json` (`license.ts:13-16`, unless
  `KAI_HOME` is set). The two paths do not match, so the installer's key-reuse on the
  update path may not find the cached key and would fall back to prompting. Flagged as
  a suspected defect; not confirmed end to end.

## Not verified end to end

Per `documents/architect/shared/packaging-and-release.md` and this component's
`02-architecture.md`: a Kit install has not been proven to complete a live Instagram
sync or a real AI analysis with real credentials (the #20 buyer test hit BUG 1 before
IG sync could run); the no-proxy LLM path (hitting the real Anthropic API with no
local proxy) is unverified end to end; and the live install URL is still the raw
`workers.dev` subdomain rather than a custom domain.
