# Kit cases

## Built features

The Kit is what a buyer runs, not what they see in the app. Its whole surface is a shell installer and one command line tool, `kai`, with ten commands. The happy path is four lines, in order:

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

`kai kit init` ends by calling the same routine as `kai up`, so a first time buyer who runs `kit init` never needs to type `kai up` separately; the fourth line is the one they use on every later start.

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Install with `curl \| sh` | Puts the product on disk under `~/.kai` with no Node, Python, git, Xcode, Homebrew, or sudo | ● | `packaging/install.sh.template` | none |
| 3 | `kai login` | Activates and caches the license entitlement against Polar | ● | `src/cli/license.ts` | none |
| 4 | `kai kit init` | Writes buyer credentials, generates the sidecar token, creates the database, hands off to `kai up` | ● | `src/cli/kai.ts` (`cmdKitInit`) | none (secret prompt rewritten to raw TTY mode; no real-terminal re-run recorded) |
| 5 | `kai up` / `kai start` / `kai stop` | Starts, restarts, or stops the Next.js server and Instagram sidecar as LaunchAgents | ● | `src/cli/service-darwin.ts` | none |
| 6 | `kai status` | Prints the license state and each service's running state, offline | ● | `src/cli/kai.ts` (`cmdStatusFull`) | none |
| 7 | `kai doctor` | Read only health check across version, native modules, the sidecar venv, config, license, and services | ● | `src/cli/kai.ts` (`cmdDoctor`) | none |
| 8 | `kai update` | Re-runs the installer against a newer release, preserving buyer state | ● | `src/cli/kai.ts` (`cmdUpdate`) | none (install URL default and entitlement path now match the installer; no second real release exercised) |
| 9 | `kai mcp` | Registers the MCP server with Claude Code and Codex, prints config for Claude Desktop and generic clients | ● | `src/cli/kai.ts` (`cmdMcp`), `src/cli/mcp-register.ts` | none |
| 10 | `kai rollback` | Flips `current` back to the previous installed version, refusing when migrations differ | ● | `src/cli/kai.ts` (`cmdRollback`) | none |

### Install with `curl | sh`

#### Who uses it

Every buyer, once, as the first line they run.

#### What it does

The installer (`packaging/install.sh.template`, baked per release by `packaging/gen-install.sh`) puts the whole product on disk under `~/.kai` with no Node, Python, git, Xcode, Homebrew, or sudo. It is fetched from the gate worker on a route that needs no license, since the script itself holds no secret; everything it then pulls is gated. The script runs eleven numbered stages: an architecture guard, license key resolution, the download gate, a disk preflight, a verified download, an atomic extract, buyer state linking, an offline Python bootstrap, a `current` symlink flip, a PATH edit, and the closing next steps print.

The buyer pastes the `curl | sh` line. The script confirms the machine is Apple Silicon, prompts for the license key on the terminal, exchanges that key at the gate's `/download` route for a 15 minute signed R2 URL, downloads the tarball for the baked version, checks its byte size and sha256 against the values baked into the script at release time, extracts it to `~/.kai/app/v<version>`, sets up the Instagram helper's Python virtual environment from the bundled wheelhouse with no network, flips `~/.kai/app/current` to the new version, symlinks `~/.local/bin/kai`, adds `~/.local/bin` to PATH if it is missing, and prints the three next commands. No app has started yet; the installer only lays files down.

#### How to access it

A single `curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh` line, from any terminal.

#### Business rules

- A non Darwin OS is refused with a refund pointer; a real Intel Mac is refused the same way, while Rosetta on Apple Silicon (which reports as `x86_64`) is let through via a `sysctl.proc_translated` check.
- The license key is taken, in order, from a `--key` argument, the `KAI_LICENSE_KEY` env var, a cached key in `$STATE/entitlement.json` (the update path, which prints "Reusing your saved license key"), then an interactive `/dev/tty` prompt, since stdin under `curl | sh` is the piped script itself.
- The download gate validates the key against Polar but never activates it, so an install or reinstall never spends an activation slot.
- The disk preflight refuses to start downloading when free space is below the baked requirement (tarball plus extraction plus the venv).
- A wrong byte size or a sha256 mismatch deletes the downloaded file and refuses to extract it, since the size and sha256 are baked into the script at release time and a tampered R2 object or worker cannot serve a build that still passes this check.
- Extraction is atomic: it builds the new version in a `.partial` directory, removes any older same version directory, then moves the partial into place, so a killed run never leaves a half extracted version as `current`; it also clears the quarantine extended attribute for a buyer who downloaded by browser rather than curl.
- Buyer state is linked in, not copied: `~/.kai/state/data` is created and symlinked to the new version's data directory, and a prior install's `state/env.local`, if present (see #153), is symlinked into the new version's `.env.local` slot. This is what lets an update swap versions without touching the buyer's database or config.
- The install and the update share one script; the only branch between them is whether `current` already exists. An update reuses the cached key, runs the post update migration and restart hook, and skips the first install's next steps print.

#### Limitations

- The download URL from the gate is time boxed to 15 minutes; a very slow link that outlasts the token fails the download step, not the size or checksum check.
- The next steps footer echoes the buyer's license key back on screen as `kai login <KEY>`, so the key lands in terminal scrollback on a fresh install.

#### User guide

To install crowsnest, open Terminal and paste the install command from your receipt email. It downloads and unpacks the app to your Mac, no other tools required. When it asks for your license key, paste the one from your receipt. When it finishes, it prints the two commands you run next: `kai login` and `kai kit init`.

### `kai login`

#### Who uses it

Every buyer, once per machine, right after the install finishes.

#### What it does

`kai login` is the only command that spends a Polar activation. It activates the key, claiming one of two slots, validates it, and caches the result as `~/.kai/state/entitlement.json` at mode 0600, which every later license gated command reads instead of calling Polar again. Polar's customer portal endpoints are used directly by `src/cli/license.ts` with no bearer token; the key itself is the credential.

`login` reuses this machine's cached activation when the cached key matches, re-validating it rather than activating again, since activating on every login would spend both of a two activation license's slots the second time the same buyer runs it. A revoked or disabled license is a final refusal; any softer failure (the activation was removed in the portal, a stale cache) triggers a fresh activation attempt. Activation claims a slot; a 404 means the key was not found, a 403 means the key is already active on two machines with a pointer to deactivate one in the Polar portal. Validation is the call that actually proves entitlement; a non granted key status is a fatal refusal even on an HTTP 200.

#### How to access it

`kai login <license-key>`, from the terminal, once installed.

#### Business rules

- With no key argument the command refuses with a usage message.
- On success it writes `{key, activation_id, customer_id, validated_at}` to `entitlement.json` at mode 0600 and prints that the license is active and that the next step is `kai kit init`. A missing customer id is tolerated with a note rather than a failure.
- A network failure that is not a license specific error is reported as unreachable Polar, distinct from a bad key.
- The download gate (in `install.sh`) and `kai login` are two separate Polar checks on purpose: the gate validates only, `login` activates. A buyer can reinstall freely without spending a slot; only `login` spends one.
- The activation label defaults to the machine hostname, so the two slots show up in the Polar portal by machine name.

#### Limitations

- A key already active on two other machines refuses this one until the buyer deactivates a slot in the Polar portal themselves; the CLI has no way to force a deactivation.

#### User guide

Run `kai login` followed by your license key. crowsnest checks it against your purchase and saves that check on your Mac, so you will not need to enter the key again unless you reinstall on a different machine. If you see a message about the key already being active on two machines, open the Polar customer portal link from your receipt and deactivate one before trying again.

### `kai kit init`

#### Who uses it

Every buyer, once, right after `kai login`, and again only if they want to change a saved value.

#### What it does

`kai kit init` is the one step where the buyer's own secrets go in. It requires a cached entitlement first, writes `.env.local` (from `.env.example` or in place), prompts for the Instagram account and an optional Anthropic key, generates the sidecar shared token, creates the vault directory, runs the database migrations and bootstrap, and then hands off to `kai up`. It is the setup command; everything the buyer does after the dashboard opens belongs to onboarding and the rest of the app.

The steps, in order: confirm a cached license exists; copy `.env.example` to `.env.local` if it is missing, or edit the existing file in place, keeping comments and ordering; print a throwaway account warning and prompt for `IG_USERNAME`, then only if a username was given prompt for `IG_PASSWORD` as a masked secret and refuse to write anything if only one of the pair was given; replace `IG_SERVICE_TOKEN` with a random value if it is still the `change-me` placeholder, so the buyer never types it; prompt for an optional `ANTHROPIC_API_KEY`, masked, leaving it unset on a blank answer; prompt for `VAULT_PATH`, defaulting to `~/.crowsnest/vault`, and create the directory; write `.env.local` at mode 0600 (re-chmod'd, since a fresh copy from `.env.example` may have left it world readable and the file now holds the Instagram password); run `npm ci` only in the dev repo, since a bundle already ships its dependencies; run the database migrations then the bootstrap script directly through `node -> tsx`, never through `npm run`, which would resolve to a buyer's own Homebrew node and crash on the native module ABI; and finally call the same routine as `kai up`.

Prompts are read through one readline interface's async iterator, not `question()`, because `question()` drops lines when stdin is a pipe; the iterator queues them instead, so `kai kit init < answers` (piped, non interactive) works. A secret prompt on a real terminal switches stdin to raw mode and reads the line byte by byte, so nothing echoes; a piped stdin falls back to the readline iterator.

#### How to access it

`kai kit init`, from the terminal, once logged in.

#### Business rules

- A missing cached entitlement refuses the whole command with a pointer to `kai login`.
- Re-running `kit init` edits the existing `.env.local` in place rather than clobbering it, so a buyer can re-run to change one value.
- `kit init` always ends by starting the services, so a failed Instagram password write surfaces immediately as a sidecar that will not come up, visible in `kai status` and `kai doctor`.
- A blank `ANTHROPIC_API_KEY` is allowed and leaves the key unset; the app's keyless export path still works, while AI analysis and the vault pipeline need the key.

#### Limitations

- Instagram sync depends entirely on this step writing a real username and password pair; `kai doctor` reports whether the pair is set.
- The Instagram and Anthropic prompts are the two places a buyer types a secret, and both go through `ask({ secret: true })` in `src/cli/kai.ts`.

#### User guide

Run `kai kit init`. It will ask for your Instagram username and password (use an account you do not mind losing, since Instagram can flag automated logins), then optionally your Anthropic API key for AI features, then where to store your vault. When it finishes, crowsnest starts and opens in your browser. If Instagram sync never seems to start, check `kai status` and `kai doctor`, and if the Instagram service shows stopped or not responding, re-enter your Instagram credentials by running `kai kit init` again.

### `kai up` / `kai start` / `kai stop`

#### Who uses it

Every buyer, on every later start; `kai start`/`kai stop` are used less often, mainly for troubleshooting.

#### What it does

These three drive the two launchd LaunchAgents: the Next.js server (`com.crowsnest.server`, bound to `127.0.0.1:3000`) and the Instagram sidecar (`com.crowsnest.ig`, the venv Python running as a module). Both are set `RunAtLoad` and `KeepAlive`, so they survive a reboot or a closed terminal. `kai start` requires a license, writes and reloads both plists, and is idempotent: it stops an already loaded label first so a changed plist (a new version directory after an update) takes effect, then loads it. `kai up` starts the services, then polls `http://localhost:3000` for up to 25 seconds, treating 200, 307, or 404 as up; on success it opens the URL in the default browser, on timeout it tails the last 10 lines of the server log and points at `kai doctor`. `kai stop` unloads both labels and needs no license.

#### How to access it

`kai up` on every later start; `kai start` and `kai stop` directly when troubleshooting.

#### Business rules

- The server binds `127.0.0.1` so macOS never shows the "accept incoming connections" firewall prompt.
- After the server answers, `kai up` calls the sidecar's `/health`; if the sidecar does not respond it prints that and the tail of its log, but the Next.js server on 3000 still comes up and the dashboard still opens. `kai start` still prints a fixed message naming port 8765 without checking it.
- `kai up`'s poll accepts a 404 as "the server answered," so it opens the browser as soon as the Next.js server responds at all, not only once the dashboard has fully rendered.

#### Limitations

- `kai up`/`kai start` refuse without a cached license.
- Logs for both services go to `~/.kai/logs/<label>.log`; that is the only place a crash loop's real error message is visible from the command line.

#### User guide

Run `kai up` to start crowsnest and open the dashboard in your browser. If it does not open within about 25 seconds, run `kai doctor` to see what is wrong. Use `kai stop` if you want to shut crowsnest down without uninstalling it, and `kai start` to bring it back up without opening a browser tab.

### `kai status`

#### Who uses it

A buyer or support, checking whether crowsnest is currently running.

#### What it does

`kai status` prints the license line, either the active state with its activation id or that the buyer is not logged in, then for each service prints running, stopped, or not installed, read from launchd. It touches no network.

#### How to access it

`kai status`, from the terminal.

#### Business rules

- A second, shorter status function exists in the codebase but is not wired to any command; the `status` case always calls the full version. The unused function is dead code, not a second behavior a buyer can reach.

#### Limitations

- It reports launchd's view of the services, not whether the Next.js server or the sidecar is actually answering requests; a service can show running while still crash looping if launchd has not yet noticed the latest failure.

#### User guide

Run `kai status` any time to see whether you are logged in and whether crowsnest's two background services are running.

### `kai doctor`

#### Who uses it

A buyer following a failure message, or support walking a buyer through a problem.

#### What it does

`kai doctor` is a read only health check that makes no external network call; the only requests are loopback, to the sidecar `/health` and the app's MCP `tools/list`. It prints an OK or a failed line per check: the VERSION file, bundle versus dev repo mode, that the native modules load, that the sidecar's virtual environment python exists and its package imports, that `.env.local` exists, that `IG_USERNAME` and `IG_PASSWORD` are both set or both blank, that an entitlement is cached, the running state of each service, the sidecar's `/health`, and the MCP endpoint. In a bundle it also checks that the bundled `uv` and the wheelhouse are present. It is the command every failure path (the install's Python bootstrap, a `kai up` timeout, a missing virtual environment) points the buyer at.

#### How to access it

`kai doctor`, from the terminal, any time.

#### Business rules

- Every check prints regardless of whether an earlier check failed, so a buyer gets the full picture in one run rather than stopping at the first problem.

#### Limitations

- It checks that files and processes exist and load; it does not attempt a live Instagram login or a live Anthropic API call, so a correctly configured but revoked or wrong Instagram password still shows as configured, not as broken, until a real sync attempt fails.

#### User guide

If something is not working, run `kai doctor`. It checks your install for common problems and tells you exactly what to fix, without sending anything over the network.

### `kai update`

#### Who uses it

A buyer picking up a newer release.

#### What it does

`kai update` requires a license and refuses to run in the dev repo. It re-runs the installer, which reuses the cached license key and the `~/.kai/state` symlink scheme, so the buyer never retypes the key and their database, config, and media survive. On failure it reports that the current version is untouched. The installer's own update branch then migrates the database and restarts the services if they were running.

#### How to access it

`kai update`, from the terminal, whenever a new release is available.

#### Business rules

- `kai update` requires a cached license and refuses outright in the dev repo, since it is meant only for installed bundles.
- A failed update leaves the previous version in place; nothing is torn down before the new one is confirmed good.

#### Limitations

- Not exercised against a real second release.

#### Add-on commands

`kai mcp` probes the live `/api/mcp` endpoint with a real `tools/list`, registers the server with Claude Code (user scope, remove then add so it is idempotent) and Codex (an idempotent upsert of `~/.codex/config.toml`), and prints copy-paste config for Claude Desktop and any generic MCP client. `kai mcp --print` only prints. It is never fatal, and `kai kit init` runs it at the end. `kai rollback` flips `~/.kai/app/current` to the one other installed version and runs the post update routine in a fresh process; it refuses in the dev repo and refuses when the two versions' `drizzle/` migrations differ.

#### User guide

Run `kai update` whenever a new version is announced. It downloads and installs the update the same way the original install did, but keeps everything you have already set up, so you should not need to log in or run `kai kit init` again.

### Edge cases

- **The download gate and `kai login` are separate Polar checks on purpose,** so a buyer can reinstall or update freely without spending an activation slot; only `kai login` spends one, and a key already active on two machines refuses a third until the buyer deactivates one in the Polar portal.
- **Extraction is atomic.** A killed install run never leaves a half extracted version as `current`; the new version builds in a `.partial` directory and is moved into place only once complete.
- **A sidecar that crashes on a bad credential does not stop the dashboard.** `kai up` reports the failed `/health` and shows the log tail, and `kai doctor` shows the pairing and health checks.
- **No live install has been proven to complete a real Instagram sync or a real AI analysis with real credentials,** since the one buyer test that exercised the real installer left the Instagram fields blank.

## kit: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: on an Apple Silicon Mac with a clean `~/.kai` (or an existing one backed up and moved aside), a real crowsnest license key from Polar, and a network. Most cases exercise the installed bundle, so start from a real `curl | sh` install unless a case says otherwise; a few cases (`kai doctor`, `kai update`'s dev repo refusal) run from a clone. The gate worker and Polar are live services, so the license and download cases need real credentials, never fakes. The two `kai kit init` secret cases (BEH-11, BEH-12) must be run on a real interactive terminal, not piped, because that is exactly where the confirmed defects appear. Reset between runs by removing `~/.kai/app`, `~/.kai/state`, `~/.kai/entitlement.json`, and the two `~/Library/LaunchAgents/com.crowsnest.*.plist` files.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BEH-01 | P1 | arm64 Mac, real key | The four-line happy path installs the product under `~/.kai` with no Node, Python, git, Xcode, or Homebrew, and no sudo ([install with curl \| sh](#built-features)). | Clean `~/.kai`, a valid key. | 1. Run the `curl \| sh` line.<br>2. Paste the key at the prompt. | The script downloads, verifies, extracts, sets up the venv, flips `current`, links `~/.local/bin/kai`, and prints the three next commands. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-02 | P1 | Intel Mac, or forced | A real Intel Mac is refused with a refund pointer; Rosetta on Apple Silicon is let through ([install with curl \| sh](#built-features)). | An Intel Mac, or the arch branch forced. | 1. Run the installer. | Dies "crowsnest needs an Apple Silicon Mac (M1 or newer). Yours is Intel. Reply to your receipt for a refund." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-03 | P1 | bad key | An unrecognized key at the download gate stops the install before any download ([install with curl \| sh](#built-features)). | Clean state, an invalid key. | 1. Run the installer, paste a junk key. | Dies "License not recognized. Check the key from your receipt and try again." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-04 | P2 | shell without `~/.local/bin` on PATH | The installer adds `~/.local/bin` to PATH for the buyer's shell when it is missing ([install with curl \| sh](#built-features)). | A shell without `~/.local/bin` on PATH. | 1. Run the installer.<br>2. Read the shell rc file. | The right rc file gains the PATH line and the script says to open a new terminal. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-05 | P3 | fresh install | The next-steps footer echoes the buyer's license key on screen ([install with curl \| sh](#built-features)). | A fresh, non-update install. | 1. Complete an install and read the final lines. | The footer prints `kai login <KEY>` with the real key, landing it in scrollback. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-06 | P1 | real key | `kai login` activates and caches the entitlement at `~/.kai/entitlement.json`, mode 0600 ([kai login](#kai-login)). | Installed kai, valid key, no cached entitlement. | 1. `kai login <key>`. | Prints "License active. Saved to <path>" and "Next: kai kit init"; `entitlement.json` exists at 0600 with `key`, `activation_id`, `customer_id`, `validated_at`. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-07 | P1 | a key already active on 2 machines | A key already active on two machines is refused with a pointer to deactivate one ([kai login](#kai-login)). | The key already activated on two other machines, this machine with no cached activation. | 1. `kai login <key>`. | Dies "That license key is already active on 2 machines. Deactivate one in the Polar customer portal, then run `kai login` again." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-08 | P2 | none | Missing key argument prints usage rather than attempting a call ([kai login](#kai-login)). | Installed kai. | 1. `kai login`. | Dies "Usage: kai login <license-key>". | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-09 | P1 | no entitlement | `kai kit init` refuses without a cached license ([kai kit init](#kai-kit-init)). | Installed kai, no `entitlement.json`. | 1. `kai kit init`. | Dies "No license found. Run `kai login <license-key>` first." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-10 | P1 | entitlement | `kai kit init` generates `IG_SERVICE_TOKEN` when it is still the placeholder, and hands off to `kai up` at the end ([kai kit init](#kai-kit-init)). | Logged in, `.env.local` with a `change-me` token. | 1. Run `kai kit init` and let it finish. | "Generated IG_SERVICE_TOKEN" is printed, the token in `.env.local` is a random string, and the run ends by starting crowsnest and opening the dashboard. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-11 | P1 | entitlement, a real terminal | (KIT-1, confirmed) On a real terminal the masked `IG_PASSWORD` prompt returns empty, so `.env.local` gets `IG_PASSWORD=` and the Instagram sidecar refuses to start and crash loops; port 8765 never opens ([kai kit init](#kai-kit-init)). | Logged in, run on a real interactive terminal, not piped. | 1. `kai kit init`.<br>2. Type a username, then a password at the masked prompt.<br>3. Inspect `.env.local` and `kai status`. | `IG_PASSWORD=` is empty (length 0), `com.crowsnest.ig` is stopped or crash looping, and the sidecar log shows "IG_USERNAME and IG_PASSWORD must be set together". | fail (confirmed, `evidence/10-onboarding-bugs.md`) |
| BEH-12 | P1 | entitlement, a real terminal | (KIT-2, confirmed) On a real terminal the masked `ANTHROPIC_API_KEY` prompt echoes the key in plaintext, landing it in scrollback ([kai kit init](#kai-kit-init)). | Logged in, run on a real interactive terminal. | 1. `kai kit init`.<br>2. At the `ANTHROPIC_API_KEY (blank to skip, not echoed):` prompt, type a key. | The key is visible on screen as typed; it is still saved to `.env.local` correctly. | fail (confirmed, `evidence/10-onboarding-bugs.md`) |
| BEH-13 | P2 | entitlement | A blank `ANTHROPIC_API_KEY` is allowed and leaves the key unset; the run still completes ([kai kit init](#kai-kit-init)). | Logged in. | 1. `kai kit init`, leave the key blank.<br>2. Inspect `.env.local`. | No `ANTHROPIC_API_KEY` value is written; the run still completes and starts crowsnest. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-14 | P1 | initialized kit | `kai up` starts both services, polls localhost:3000 for up to 25s, and opens the dashboard on success ([kai up / kai start / kai stop](#built-features)). | Logged in, kit initialized. | 1. `kai up`. | Prints "crowsnest is running: http://localhost:3000" and opens the browser; both LaunchAgents load. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-15 | P2 | a server that fails to start | On a server that never answers, `kai up` times out at 25s, tails the server log, and points at `kai doctor` ([kai up / kai start / kai stop](#built-features)). | A build where the server cannot start, or port 3000 taken. | 1. `kai up`. | Prints "The dashboard did not come up within 25s.", shows the last 10 lines of the server log, and dies "Run `kai doctor` to diagnose." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-16 | P2 | BUG KIT-1 present | With an empty Instagram password, `kai up` still brings the server up and opens the dashboard while the Instagram sidecar crash loops ([kai up / kai start / kai stop](#built-features)). | A kit initialized on a real terminal, matching BEH-11. | 1. `kai up`.<br>2. `kai status`. | The dashboard opens, the server on 3000 runs; `com.crowsnest.ig` shows stopped or not running. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-17 | P2 | running services | `kai stop` unloads both services and needs no license ([kai up / kai start / kai stop](#built-features)). | Services running, entitlement optionally removed. | 1. `kai stop`.<br>2. `kai status`. | Prints "crowsnest services stopped."; both services report stopped. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-18 | P2 | initialized kit | `kai status` reports the license line and per-service running, stopped, or not-installed state, touching no network ([kai status](#kai-status)). | Logged in, services in a known state. | 1. `kai status`. | Prints the license line and each service's state; runs offline. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-19 | P1 | installed bundle | `kai doctor` prints an OK or failed line per check and never touches the network ([kai doctor](#kai-doctor)). | A healthy bundle install. | 1. `kai doctor` (offline). | All checks print `[OK]` with detail; no network call is made. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-20 | P2 | broken venv | Doctor flags a missing sidecar venv with a rerun hint ([kai doctor](#kai-doctor)). | An install with the sidecar `.venv` removed. | 1. `kai doctor`. | The python sidecar line reads `[!!] ... venv missing (rerun kai kit init)`. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-21 | P1 | installed, a newer release | `kai update` re-runs the installer, reusing the cached key and preserving `~/.kai/state`, then migrates and restarts if the services were running ([kai update](#kai-update)). | An installed older version and a newer release in R2. | 1. `kai update`. | Updates to the new version; the database, config, and media survive; services restart if they were running. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| BEH-22 | P2 | dev repo | `kai update` refuses to run in the dev repo ([kai update](#kai-update)). | A dev clone, not a bundle. | 1. `kai update`. | Dies "kai update is for installed builds, not the dev repo." | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |

Not checkable by hand:

- Whether a Polar-side revocation propagates promptly to `kai login`'s validate call, versus being masked by a cached activation until the buyer explicitly re-logs in.
- Whether the gate worker's 15 minute HMAC token actually expires mid-download on a slow link, which would surface as a download failure rather than a checksum failure.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | CLI function (`src/cli/license.ts :: login`) | A login with a matching cached key re-validates the existing activation rather than activating again, so a second `kai login` with the same key does not spend a second Polar slot. | A machine already logged in with a cached entitlement. | `login(sameKey)`. | The activation id is unchanged; only `validate` is called, not `activate`, unless the cached activation is fatally revoked. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | CLI function (`src/cli/license.ts :: activate`) | A 404 from Polar raises a not-found `LicenseError`; a 403 raises the two-machine `LicenseError`, since the key is configured for exactly two activation slots. | Mocked Polar responses of 404 and 403. | `activate(key)` against each mocked status. | The 404 case throws "not found...", the 403 case throws "already active on 2 machines...". | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | CLI function (`src/cli/license.ts :: validate`) | A non-`granted` key status is a fatal refusal even on an HTTP 200, since Polar can answer 200 for a revoked or disabled key. | A mocked Polar 200 response with `license_key.status` set to something other than `granted`. | `validate(key, activationId)`. | Throws a fatal `LicenseError` naming the non-granted status. | 🟢 covered by vitest (green) |
| ACTION-04 | P2 | CLI function (`src/cli/license.ts :: readEntitlement`, `writeEntitlement`) | `writeEntitlement` writes the file at mode 0600; `readEntitlement` returns null on a missing or malformed file rather than throwing. | A temp `KAI_HOME`. | `writeEntitlement({...})`, then `readEntitlement()`; separately, `readEntitlement()` against a missing or truncated file. | The written file is mode 0600 and round-trips through `readEntitlement`; the missing or malformed case returns null, not an exception. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | CLI function (`src/cli/kai.ts :: setEnv`) | Setting an existing key replaces its line in place, preserving comments and ordering; setting a new key appends it. | A sample `.env.local` text with comments and an existing `IG_USERNAME` line. | `setEnv(text, "IG_USERNAME", "newuser")`, then `setEnv(result, "NEW_KEY", "value")`. | The `IG_USERNAME` line is replaced in place with everything else unchanged; `NEW_KEY=value` is appended at the end. | 🟢 covered by vitest (green) |
| ACTION-06 | P2 | CLI function (`src/cli/kai.ts :: poll`) | `poll` treats HTTP 200, 307, or 404 as up and returns before its budget; any other outcome (connection refused, timeout) keeps retrying until the budget elapses. | A mock server answering with each status in turn. | `poll(url, budgetMs)` against a 200, a 307, a 404, and a connection-refused server. | The first three resolve `true` quickly; the connection-refused case resolves `false` only after the full budget elapses. | 🟢 covered by vitest (green) |
| ACTION-07 | P1 | CLI function (`src/cli/service-darwin.ts :: start`) | `start` is idempotent: it boots out an already-loaded label before bootstrapping it, so a changed plist (a new version directory after an update) takes effect on a second call. | A service already loaded under an older plist. | `start()` twice in a row, with the underlying binary paths changed between calls. | The second call's `bootout` succeeds (or is ignored if already unloaded) before its `bootstrap`; the reloaded plist reflects the new paths. | 🟢 covered by vitest (green) |
| ACTION-08 | P2 | CLI function (`src/cli/service-darwin.ts :: running`, `installed`) | `running` reflects whether launchd currently has the label loaded; `installed` reflects whether the plist file exists on disk, independent of whether it is loaded. | A service with its plist written but not loaded; separately, one loaded. | `running(label)` and `installed(label)` against each state. | Plist present, not loaded: `installed` true, `running` false. Loaded: both true. | 🟢 covered by vitest (green) |
| ACTION-09 | P1 | Worker route (`packaging/worker/src/index.ts :: POST /download`) | The download route validates the key against Polar but never activates it, and refuses when the object for the requested version and platform does not exist in R2. | A worker test harness with a mocked Polar `validate` response and a known R2 bucket state. | `POST /download` with `{key, platform, version}` for a valid key and an existing object; separately, for a version with no matching R2 object. | The first returns `{url}` pointing at `/dl?token=...`; no Polar activation call is made. The second returns a 404 with a "no release for..." message. | 🟢 covered by vitest (green) |
| ACTION-10 | P1 | Worker route (`packaging/worker/src/index.ts :: GET /dl`, `mintToken`, `verifyToken`) | A minted token verifies within its 15 minute window and streams the object; an expired or tampered token is refused. | A minted token, and a copy with one character of its signature flipped. | `GET /dl?token=...` with the real token, the tampered token, and the real token after its expiry has passed. | The real token within its window streams the object; the tampered token and the expired token are both refused, neither streams bytes. | 🟢 covered by vitest (green) |
| ACTION-11 | P2 | Worker route (`packaging/worker/src/index.ts :: rateLimited`) | With a rate-limit store bound, a key that has minted 20 download tokens within an hour is refused a 21st. | A worker test harness with a bound `RATE_LIMIT` KV namespace, 20 prior mints recorded for one key. | `POST /download` a 21st time for the same key within the hour. | Returns 429 with "too many download requests, wait an hour"; no new token is minted. | 🟢 covered by vitest (green) |

Not checkable by hand:

- Whether a Polar-side revocation is reflected by the gate worker's `keyIsValid` check within any bounded time, since the worker calls Polar fresh on every `/download` request rather than caching.

## 3. browse-e2e

The Kit draws no DOM of its own: its whole surface is a shell installer and the `kai`
command line tool. So its end-to-end journeys are driven by running the installer and
`kai` subcommands and asserting on stdout and on the files and launchd state they leave
behind (`.env.local`, `~/.kai/entitlement.json`, the plists `kai status` reads), not by
clicking a rendered page. The one place the Kit reaches a browser is `kai up`, which on
success hands off to the dashboard at `http://localhost:3000`; that dashboard belongs to
the rest of the app, so the Kit's only browser assertion there is the URL it opens
(`assert_url_contains localhost:3000`), read by the same helper a browse journey uses.

Two consequences follow, both honest rather than gaps to close:

- No `data-testid` exists or is needed in `src/cli/`, confirmed by grep. A CLI has no
  elements to tag, so every assertion below names its real observable (an exact stdout
  line, a written file value, or a `kai status` line) instead of a testid, per the
  format reference's allowance for assertions that read something other than the DOM. No
  testid gap is filed to GitHub issues, because there is no DOM element to add one to.
- Every journey is `Mode: live`. A kit journey needs a real Apple Silicon Mac, a real
  Polar license, and a real `~/.kai` install; `npm run e2e`'s seeded-fixture harness
  starts a dev server against a fixture database and cannot lay down a real bundle or spend
  a real activation. So no row is `offline` and every `Script` is `none`, which the format
  reference permits precisely for a live journey no harness can seed. These are run by hand
  on a real machine, or against a release-prep box that has the install and a burner key.

Corner-case coverage below spans six distinct types (`empty`, `auth`, `invalid`,
`failure`, `boundary`, `network`). The three not written here (`concurrency`, `stale`,
`repeat`) do apply to the Kit but are already exercised one level down in the route lens
(`start`'s bootout-then-bootstrap idempotency in ACTION-07, `status`'s launchd read in
ACTION-08, `login`'s re-validate-not-reactivate in ACTION-01); six distinct types already
clears the floor of five, so they are not duplicated here as browser journeys.

Happy-path journeys cover every built feature in the `03` summary: `Feat` 2, 3, 4, 5, 6,
7, and 8, one journey each.

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 2 | happy | live | Install the product with `curl \| sh` | Clean `~/.kai` on an arm64 Mac, a valid Polar key, network up | Arrive at a fresh terminal; Act: run the `curl -fsSL .../install.sh \| sh` line, paste the key at the `/dev/tty` prompt; Assert on the closing stdout | Install completes and the footer prints the next commands `kai login <KEY>` and `kai kit init`; `~/.local/bin/kai` is a working symlink and `~/.kai/app/current` points at the new version dir | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-02 | P1 | 3 | happy | live | Activate a license with `kai login` | Installed `kai`, valid key, no `~/.kai/entitlement.json` | Arrive at the terminal; Act: run `kai login <key>`; Assert on stdout and the written file | stdout reads `License active. Saved to <path>` then `Next: kai kit init`; `~/.kai/entitlement.json` exists at mode `-rw-------` with `key`, `activation_id`, `customer_id`, `validated_at` | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-03 | P1 | 4 | happy | live | Set up config with `kai kit init` (piped answers) | Logged in, `.env.local` absent or with a `change-me` token, answers file prepared | Arrive at the terminal; Act: run `kai kit init < answers` (piped, the path unaffected by KIT-1); Assert on stdout and `.env.local` | stdout prints `Generated IG_SERVICE_TOKEN` and `Wrote <envPath>` then `Kit ready. Starting crowsnest...`; `.env.local` is mode 0600 with a random `IG_SERVICE_TOKEN` and a non-empty `IG_PASSWORD` from the piped answer | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-04 | P1 | 5 | happy | live | Start services and open the dashboard with `kai up` | Logged in, kit initialized, port 3000 free | Arrive at the terminal; Act: run `kai up`; Assert on stdout and the browser the poll opens | stdout reads `crowsnest is running: http://localhost:3000`; the default browser opens and `assert_url_contains localhost:3000` holds; both LaunchAgents load (confirmed by the following `kai status`) | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-05 | P1 | 6 | happy | live | Read license and service state with `kai status` | Logged in, services in a known running state, network unplugged | Arrive at the terminal; Act: run `kai status`; Assert on stdout with no network | stdout reads `Licensed. Activation <id>, last checked <ts>` and one line per service reading `running`; the command makes no outbound connection | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-06 | P1 | 7 | happy | live | Run the offline health check with `kai doctor` | A healthy bundle install, network unplugged | Arrive at the terminal; Act: run `kai doctor`; Assert on stdout with no network | every check prints an `[OK] <label> <detail>` line (VERSION, native modules, sidecar venv, `.env.local`, entitlement, services); no outbound connection is made | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-07 | P1 | 8 | happy | live | Update to a newer release with `kai update` | An installed older version, a newer release in R2, cached key present | Arrive at the terminal; Act: run `kai update`; Assert on stdout and preserved state | stdout prints `Updating crowsnest...` then completes; `~/.kai/app/current` points at the new version while `~/.kai/state` (database, `.env.local`, media) is unchanged; services restart if they were running | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-08 | P2 | 6 | empty | live | `kai status` on a machine that has never been set up | Clean `~/.kai`: no entitlement, no plists installed | Arrive at the terminal; Act: run `kai status`; Assert on the zero-state stdout and its recovery copy | stdout reads `Not logged in. Run: kai login <license-key>` and each service line reads `not installed`; the recovery command is named inline, nothing else is printed | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-09 | P1 | 4 | auth | live | A license-gated command refuses without an entitlement | Installed `kai`, `~/.kai/entitlement.json` absent | Arrive at the terminal; Act: run `kai kit init`; Assert it refuses before touching `.env.local` | stdout reads `No license found. Run \`kai login <license-key>\` first.` and the command exits non-zero; no `.env.local` is written | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-10 | P2 | 3 | invalid | live | `kai login` with no key prints usage instead of calling Polar | Installed `kai` | Arrive at the terminal; Act: run `kai login` with no argument; Assert on stdout | stdout reads `Usage: kai login <license-key>` and the command exits non-zero; no network call is made | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-11 | P2 | 5 | failure | live | `kai up` times out on a server that never answers and points at doctor | Kit initialized but the server cannot bind 3000 (port taken or a broken build) | Arrive at the terminal; Act: run `kai up` and wait out the 25s poll; Assert on stdout | stdout reads `The dashboard did not come up within 25s.`, then the last 10 lines of the server log, then `Run \`kai doctor\` to diagnose.`; the browser is not opened | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-12 | P2 | 3 | boundary | live | `kai login` on a third machine hits the two-activation cap | The key already activated on two other machines, this machine with no cached activation | Arrive at the terminal; Act: run `kai login <key>`; Assert on the refusal stdout | stdout reads `That license key is already active on 2 machines. Deactivate one in the Polar customer portal, then run \`kai login\` again.`; no `entitlement.json` is written | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| E2E-13 | P2 | 3 | network | live | `kai login` with Polar unreachable reports the outage, not a bad key | Installed `kai`, valid key, but `api.polar.sh` blocked or offline | Arrive at the terminal; Act: run `kai login <key>` with Polar unreachable; Assert on stdout | stdout reads `Could not reach Polar: <message>`, distinct from the `License not recognized` bad-key path; no `entitlement.json` is written | none | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | The cached entitlement holding the license key is written at mode 0600 and is never logged or printed after the initial "License active" line. | A machine that has run `kai login`. | 1. `ls -l ~/.kai/entitlement.json`.<br>2. Grep `~/.kai/logs/*.log` for the license key. | The file mode is `-rw-------`; the key does not appear in any log file. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| SEC-02 | P1 | Secret handling | (KIT-1, confirmed) On a real terminal, `kai kit init`'s masked `IG_PASSWORD` prompt fails silently and writes an empty password rather than the value typed, a secret-handling failure even though nothing is disclosed. | Logged in, run on a real interactive terminal. | 1. `kai kit init`.<br>2. Type a password at the masked prompt.<br>3. Inspect `.env.local`. | `IG_PASSWORD=` is written empty (length 0) instead of the typed value. | fail (confirmed, `evidence/10-onboarding-bugs.md`) |
| SEC-03 | P1 | Secret handling | (KIT-2, confirmed) On a real terminal, `kai kit init`'s masked `ANTHROPIC_API_KEY` prompt fails to suppress the terminal echo, so the key is visible on screen and lands in scrollback. | Logged in, run on a real interactive terminal. | 1. `kai kit init`.<br>2. Type a key at the `ANTHROPIC_API_KEY (blank to skip, not echoed):` prompt. | The key is printed to the terminal as typed, even though the prompt is labeled "not echoed". | fail (confirmed, `evidence/10-onboarding-bugs.md`) |
| SEC-04 | P1 | License gate | Every license-gated command (`kai kit init`, `kai up`, `kai start`, `kai update`) refuses to run without a cached entitlement file present. | No `~/.kai/entitlement.json`. | 1. Run each gated command in turn. | Each dies with "No license found. Run `kai login <license-key>` first." (or the update-specific equivalent) before doing anything else. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| SEC-05 | P2 | License gate | The cached entitlement is trusted on its shape alone: `readEntitlement` only checks that `key` and `activation_id` are present, with no signature or live re-check against Polar, so every command after the first `kai login` is gated on a local file's contents rather than a fresh server answer. | A hand-written `entitlement.json` with an arbitrary `key`/`activation_id` and no real Polar activation behind it. | 1. Write a fake `entitlement.json`.<br>2. Run `kai kit init` or `kai up`. | The gated commands proceed as if licensed; grounded in `readEntitlement`'s implementation in `src/cli/license.ts`, not yet exercised as a live run. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |
| SEC-06 | P1 | No buyer data leaving the box | The Kit's own outbound calls go only to Polar (license operations) and the crowsnest gate worker (install and download); it sends no buyer channel or Instagram data anywhere, since it never touches those tables itself. | An installed kit with network capture available. | 1. Run `kai login`, `kai kit init`, `kai up`, `kai status`, `kai doctor` while capturing outbound connections. | Every outbound connection targets `api.polar.sh` or `crowsnest-gate.kaiships.workers.dev`; nothing else is contacted, and no request body carries anything beyond a license key, platform, and version. | 🟡 not browser-drivable (needs kai CLI / kit install, no browser surface) |

Security-lite has no row for the sidecar shared token: that threat belongs to ig-sync, which owns `IG_SERVICE_TOKEN`'s enforcement. The Kit only generates that token's initial random value during `kai kit init`; it neither reads nor validates it afterward.
