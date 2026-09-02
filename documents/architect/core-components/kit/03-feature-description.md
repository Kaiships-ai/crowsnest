# kit: feature description

`documents/architect/core-components/kit/`

Status: shipped and installable, blocked for a live Instagram sync by an onboarding bug that writes an empty IG_PASSWORD.

The Kit is what a buyer runs, not what they see in the app. Its whole surface is a shell installer and one command line tool, `kai`, with eight subcommands. This document describes each of them feature by feature: what the buyer types, what happens, what states it can land in, and where it is known to break. The behavior below is read from `packaging/install.sh.template`, `src/cli/kai.ts`, `src/cli/license.ts`, `src/cli/service-darwin.ts`, and `src/cli/runtime.ts`.

The happy path is four lines, in order:

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

`kai kit init` ends by calling the same routine as `kai up`, so a first time buyer who runs `kit init` never needs to type `kai up` separately; the fourth line is the one they use on every later start.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Install with `curl \| sh` | Puts the product on disk under `~/.kai` with no Node, Python, git, Xcode, Homebrew, or sudo | ● | `packaging/install.sh.template` | none |
| 3 | `kai login` | Activates and caches the license entitlement against Polar | ● | `src/cli/license.ts` | none |
| 4 | `kai kit init` | Writes buyer credentials, generates the sidecar token, creates the database, hands off to `kai up` | ◐ | `src/cli/kai.ts` (`cmdKitInit`) | KIT-1, the confirmed empty IG_PASSWORD bug blocks Instagram sync for every interactive install |
| 5 | `kai up` / `kai start` / `kai stop` | Starts, restarts, or stops the Next.js server and Instagram sidecar as LaunchAgents | ● | `src/cli/service-darwin.ts` | none |
| 6 | `kai status` | Prints the license state and each service's running state, offline | ● | `src/cli/kai.ts` (`cmdStatusFull`) | none |
| 7 | `kai doctor` | Read only health check across version, native modules, the sidecar venv, config, license, and services | ● | `src/cli/kai.ts` (`cmdDoctor`) | none |
| 8 | `kai update` | Re-runs the installer against a newer release, preserving buyer state | ◐ | `src/cli/kai.ts` (`cmdUpdate`) | KIT-3 and KIT-4, the default install URL and the entitlement cache path are each suspected to be wrong on update, unconfirmed in the field |

## 2. Install with `curl | sh`

### Who uses it

Every buyer, once, as the first line they run.

### What it does

The installer (`packaging/install.sh.template`, baked per release by `packaging/gen-install.sh`) puts the whole product on disk under `~/.kai` with no Node, Python, git, Xcode, Homebrew, or sudo. It is fetched from the gate worker on a route that needs no license, since the script itself holds no secret; everything it then pulls is gated. The script runs eleven numbered stages: an architecture guard, license key resolution, the download gate, a disk preflight, a verified download, an atomic extract, buyer state linking, an offline Python bootstrap, a `current` symlink flip, a PATH edit, and the closing next steps print.

The buyer pastes the `curl | sh` line. The script confirms the machine is Apple Silicon, prompts for the license key on the terminal, exchanges that key at the gate's `/download` route for a 15 minute signed R2 URL, downloads the tarball for the baked version, checks its byte size and sha256 against the values baked into the script at release time, extracts it to `~/.kai/app/v<version>`, sets up the Instagram helper's Python virtual environment from the bundled wheelhouse with no network, flips `~/.kai/app/current` to the new version, symlinks `~/.local/bin/kai`, adds `~/.local/bin` to PATH if it is missing, and prints the three next commands. No app has started yet; the installer only lays files down.

### How to access it

A single `curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh` line, from any terminal.

### Business rules

- A non Darwin OS is refused with a refund pointer; a real Intel Mac is refused the same way, while Rosetta on Apple Silicon (which reports as `x86_64`) is let through via a `sysctl.proc_translated` check.
- The license key is taken, in order, from a `--key` argument, the `KAI_LICENSE_KEY` env var, a cached key in `$STATE/entitlement.json` (the update path, which prints "Reusing your saved license key"), then an interactive `/dev/tty` prompt, since stdin under `curl | sh` is the piped script itself.
- The download gate validates the key against Polar but never activates it, so an install or reinstall never spends an activation slot.
- The disk preflight refuses to start downloading when free space is below the baked requirement (tarball plus extraction plus the venv).
- A wrong byte size or a sha256 mismatch deletes the downloaded file and refuses to extract it, since the size and sha256 are baked into the script at release time and a tampered R2 object or worker cannot serve a build that still passes this check.
- Extraction is atomic: it builds the new version in a `.partial` directory, removes any older same version directory, then moves the partial into place, so a killed run never leaves a half extracted version as `current`; it also clears the quarantine extended attribute for a buyer who downloaded by browser rather than curl.
- Buyer state is linked in, not copied: `~/.kai/state/data` is created and symlinked to the new version's data directory, and a prior install's `state/env.local` is symlinked into the new version's `.env.local` slot. This is what lets an update swap versions without touching the buyer's database or config.
- The install and the update share one script; the only branch between them is whether `current` already exists. An update reuses the cached key, runs the post update migration and restart hook, and skips the first install's next steps print.

### Limitations

- The download URL from the gate is time boxed to 15 minutes; a very slow link that outlasts the token fails the download step, not the size or checksum check.
- The next steps footer echoes the buyer's license key back on screen as `kai login <KEY>`, so the key lands in terminal scrollback on a fresh install.

### User guide

To install crowsnest, open Terminal and paste the install command from your receipt email. It downloads and unpacks the app to your Mac, no other tools required. When it asks for your license key, paste the one from your receipt. When it finishes, it prints the two commands you run next: `kai login` and `kai kit init`.

## 3. `kai login`

### Who uses it

Every buyer, once per machine, right after the install finishes.

### What it does

`kai login` is the only command that spends a Polar activation. It activates the key, claiming one of two slots, validates it, and caches the result as `~/.kai/entitlement.json` at mode 0600, which every later license gated command reads instead of calling Polar again. Polar's customer portal endpoints are used directly by `src/cli/license.ts` with no bearer token; the key itself is the credential.

`login` reuses this machine's cached activation when the cached key matches, re-validating it rather than activating again, since activating on every login would spend both of a two activation license's slots the second time the same buyer runs it. A revoked or disabled license is a final refusal; any softer failure (the activation was removed in the portal, a stale cache) triggers a fresh activation attempt. Activation claims a slot; a 404 means the key was not found, a 403 means the key is already active on two machines with a pointer to deactivate one in the Polar portal. Validation is the call that actually proves entitlement; a non granted key status is a fatal refusal even on an HTTP 200.

### How to access it

`kai login <license-key>`, from the terminal, once installed.

### Business rules

- With no key argument the command refuses with a usage message.
- On success it writes `{key, activation_id, customer_id, validated_at}` to `entitlement.json` at mode 0600 and prints that the license is active and that the next step is `kai kit init`. A missing customer id is tolerated with a note rather than a failure.
- A network failure that is not a license specific error is reported as unreachable Polar, distinct from a bad key.
- The download gate (in `install.sh`) and `kai login` are two separate Polar checks on purpose: the gate validates only, `login` activates. A buyer can reinstall freely without spending a slot; only `login` spends one.
- The activation label defaults to the machine hostname, so the two slots show up in the Polar portal by machine name.

### Limitations

- A key already active on two other machines refuses this one until the buyer deactivates a slot in the Polar portal themselves; the CLI has no way to force a deactivation.

### User guide

Run `kai login` followed by your license key. crowsnest checks it against your purchase and saves that check on your Mac, so you will not need to enter the key again unless you reinstall on a different machine. If you see a message about the key already being active on two machines, open the Polar customer portal link from your receipt and deactivate one before trying again.

## 4. `kai kit init`

### Who uses it

Every buyer, once, right after `kai login`, and again only if they want to change a saved value.

### What it does

`kai kit init` is the one step where the buyer's own secrets go in. It requires a cached entitlement first, writes `.env.local` (from `.env.example` or in place), prompts for the Instagram account and an optional Anthropic key, generates the sidecar shared token, creates the vault directory, runs the database migrations and bootstrap, and then hands off to `kai up`. It is the setup command; everything the buyer does after the dashboard opens belongs to onboarding and the rest of the app.

The steps, in order: confirm a cached license exists; copy `.env.example` to `.env.local` if it is missing, or edit the existing file in place, keeping comments and ordering; print a throwaway account warning and prompt for `IG_USERNAME`, then only if a username was given prompt for `IG_PASSWORD` as a masked secret; replace `IG_SERVICE_TOKEN` with a random value if it is still the `change-me` placeholder, so the buyer never types it; prompt for an optional `ANTHROPIC_API_KEY`, masked, leaving it unset on a blank answer; prompt for `VAULT_PATH`, defaulting to `~/.crowsnest/vault`, and create the directory; write `.env.local` at mode 0600 (re-chmod'd, since a fresh copy from `.env.example` may have left it world readable and the file now holds the Instagram password); run `npm ci` only in the dev repo, since a bundle already ships its dependencies; run the database migrations then the bootstrap script directly through `node -> tsx`, never through `npm run`, which would resolve to a buyer's own Homebrew node and crash on the native module ABI; and finally call the same routine as `kai up`.

Prompts are read through one readline interface's async iterator, not `question()`, because `question()` drops lines when stdin is a pipe; the iterator queues them instead, so `kai kit init < answers` (piped, non interactive) works. A secret prompt is meant to suppress the terminal echo by temporarily replacing readline's internal output writer while `process.stdin.isTTY` and that writer both exist.

### How to access it

`kai kit init`, from the terminal, once logged in.

### Business rules

- A missing cached entitlement refuses the whole command with a pointer to `kai login`.
- Re-running `kit init` edits the existing `.env.local` in place rather than clobbering it, so a buyer can re-run to change one value.
- `kit init` always ends by starting the services, so a failed Instagram password write surfaces immediately as a sidecar that will not come up, visible in `kai status` and `kai doctor`.
- A blank `ANTHROPIC_API_KEY` is allowed and leaves the key unset; the app's keyless export path still works, while AI analysis and the vault pipeline need the key.

### Limitations

- Instagram sync depends entirely on this step writing a real password; see the open item below.
- The Instagram and Anthropic prompts are the two places a buyer types a secret, and both go through the same `ask({ secret: true })` code path that the open item names as defective on a real terminal.

### Open items: KIT-1 and KIT-2, the secret prompt defects on a real terminal

Confirmed on a real, live credential install (`evidence/10-onboarding-bugs.md`). Both defects live in the `ask({ secret: true })` path in `src/cli/kai.ts`, not in the app or the sidecar.

- **KIT-1, blocker: `IG_PASSWORD` saved empty.** The masked `IG_PASSWORD (not echoed):` prompt returns an empty string on a real terminal, so the password branch that only writes `IG_PASSWORD` when a value came back never fires; `.env.local` is left with `IG_PASSWORD=`, length 0. `IG_USERNAME`, the non secret prompt just before it, saves fine; only the secret read after it comes back empty. The Instagram sidecar then refuses to start, "IG_USERNAME and IG_PASSWORD must be set together", exit 78, and launchd's KeepAlive crash loops it, so port 8765 never comes up. This kills Instagram sync for every buyer who runs `kit init` interactively. The piped path (`kit init < answers`) is unaffected, which is why this is a real terminal specific defect, not a general one.
- **KIT-2, secondary: `ANTHROPIC_API_KEY` echoed in plaintext.** The same secret path fails to suppress the echo on this terminal, so the Anthropic key is printed as typed and lands in terminal scrollback. The key is still saved correctly, so this is a security and UX defect, not a functional blocker.

Both point at the echo suppression and async iterator approach in `ask()` not behaving as intended on a real terminal. The fix belongs in `src/cli/kai.ts`.

### User guide

Run `kai kit init`. It will ask for your Instagram username and password (use an account you do not mind losing, since Instagram can flag automated logins), then optionally your Anthropic API key for AI features, then where to store your vault. When it finishes, crowsnest starts and opens in your browser. If Instagram sync never seems to start, check `kai status` and `kai doctor`, and if the Instagram service shows stopped, re-enter your Instagram password by running `kai kit init` again from a fresh terminal window.

## 5. `kai up` / `kai start` / `kai stop`

### Who uses it

Every buyer, on every later start; `kai start`/`kai stop` are used less often, mainly for troubleshooting.

### What it does

These three drive the two launchd LaunchAgents: the Next.js server (`com.crowsnest.server`, bound to `127.0.0.1:3000`) and the Instagram sidecar (`com.crowsnest.ig`, the venv Python running as a module). Both are set `RunAtLoad` and `KeepAlive`, so they survive a reboot or a closed terminal. `kai start` requires a license, writes and reloads both plists, and is idempotent: it stops an already loaded label first so a changed plist (a new version directory after an update) takes effect, then loads it. `kai up` starts the services, then polls `http://localhost:3000` for up to 25 seconds, treating 200, 307, or 404 as up; on success it opens the URL in the default browser, on timeout it tails the last 10 lines of the server log and points at `kai doctor`. `kai stop` unloads both labels and needs no license.

### How to access it

`kai up` on every later start; `kai start` and `kai stop` directly when troubleshooting.

### Business rules

- The server binds `127.0.0.1` so macOS never shows the "accept incoming connections" firewall prompt.
- `kai up` reports the Instagram sidecar as running on port 8765 in its start message even though that port is the sidecar's own config, not set in the plist environment; if the sidecar has crashed on a bad password, it never actually opens 8765, but the Next.js server on 3000 still comes up and the dashboard still opens.
- `kai up`'s poll accepts a 404 as "the server answered," so it opens the browser as soon as the Next.js server responds at all, not only once the dashboard has fully rendered.

### Limitations

- `kai up`/`kai start` refuse without a cached license.
- Logs for both services go to `~/.kai/logs/<label>.log`; that is the only place a crash loop's real error message is visible from the command line.

### User guide

Run `kai up` to start crowsnest and open the dashboard in your browser. If it does not open within about 25 seconds, run `kai doctor` to see what is wrong. Use `kai stop` if you want to shut crowsnest down without uninstalling it, and `kai start` to bring it back up without opening a browser tab.

## 6. `kai status`

### Who uses it

A buyer or support, checking whether crowsnest is currently running.

### What it does

`kai status` prints the license line, either the active state with its activation id or that the buyer is not logged in, then for each service prints running, stopped, or not installed, read from launchd. It touches no network.

### How to access it

`kai status`, from the terminal.

### Business rules

- A second, shorter status function exists in the codebase but is not wired to any command; the `status` case always calls the full version. The unused function is dead code, not a second behavior a buyer can reach.

### Limitations

- It reports launchd's view of the services, not whether the Next.js server or the sidecar is actually answering requests; a service can show running while still crash looping if launchd has not yet noticed the latest failure.

### User guide

Run `kai status` any time to see whether you are logged in and whether crowsnest's two background services are running.

## 7. `kai doctor`

### Who uses it

A buyer following a failure message, or support walking a buyer through a problem.

### What it does

`kai doctor` is a read only health check that never touches the network. It prints an OK or a failed line per check: the VERSION file, bundle versus dev repo mode, that the native modules load, that the sidecar's virtual environment python exists and its package imports, that `.env.local` exists, that an entitlement is cached, and the running state of each service. In a bundle it also checks that the bundled `uv` and the wheelhouse are present. It is the command every failure path (the install's Python bootstrap, a `kai up` timeout, a missing virtual environment) points the buyer at.

### How to access it

`kai doctor`, from the terminal, any time.

### Business rules

- Every check prints regardless of whether an earlier check failed, so a buyer gets the full picture in one run rather than stopping at the first problem.

### Limitations

- It checks that files and processes exist and load; it does not attempt a live Instagram login or a live Anthropic API call, so a correctly configured but revoked or wrong Instagram password still shows as configured, not as broken, until a real sync attempt fails.

### User guide

If something is not working, run `kai doctor`. It checks your install for common problems and tells you exactly what to fix, without sending anything over the network.

## 8. `kai update`

### Who uses it

A buyer picking up a newer release.

### What it does

`kai update` requires a license and refuses to run in the dev repo. It re-runs the installer, which reuses the cached license key and the `~/.kai/state` symlink scheme, so the buyer never retypes the key and their database, config, and media survive. On failure it reports that the current version is untouched. The installer's own update branch then migrates the database and restarts the services if they were running.

### How to access it

`kai update`, from the terminal, whenever a new release is available.

### Business rules

- `kai update` requires a cached license and refuses outright in the dev repo, since it is meant only for installed bundles.
- A failed update leaves the previous version in place; nothing is torn down before the new one is confirmed good.

### Limitations

- See the open items below: the default install URL and the entitlement cache path each carry a suspected mismatch that has not been proven to bite in the field.

### Open items: KIT-3 and KIT-4, suspected update path defects

Neither has been confirmed against a real second release; both are read directly off the source, not from a failed run.

- **KIT-3: default install URL points at an unconfigured domain.** `kai update` defaults its install URL to `https://get.crowsnest.sh/install.sh`, but per `documents/architect/shared/packaging-and-release.md` that custom domain is not set up; the live install URL is the raw `crowsnest-gate.kaiships.workers.dev` subdomain. An update on a machine without `KAI_INSTALL_URL` set would hit an unconfigured host.
- **KIT-4: the installer and `kai login` cache the entitlement at two different paths.** The installer reads the cached key from `$STATE/entitlement.json` (`~/.kai/state/entitlement.json`), while `kai login` writes it to `~/.kai/entitlement.json`, one directory up, unless `KAI_HOME` is set. The installer's key reuse on the update path may not find the cached key and would fall back to prompting.

### User guide

Run `kai update` whenever a new version is announced. It downloads and installs the update the same way the original install did, but keeps everything you have already set up, so you should not need to log in or run `kai kit init` again.

## 9. Interactions with other systems

Persistence and autosave. The Kit has no autosave surface; every write is atomic and immediate: `entitlement.json` on a successful `kai login`, `.env.local` at mode 0600 on `kit init`, the SQLite database created and migrated during `kit init`, and the LaunchAgent plists written and reloaded on `kai start`/`kai up`. There is no draft state anywhere in the CLI.

Navigation and refresh. There is no page navigation; `kai up` is the one place the Kit hands off to a browser, opening the dashboard once the Next.js server answers on `localhost:3000`. Everything after that belongs to [onboarding](../onboarding/01-concept-brief.md) and the rest of the app, not to this component.

Background jobs and the sidecar. `kai start`/`kai up` start the Instagram sidecar as a LaunchAgent, but the Kit itself starts no job and tracks no run; the sidecar's own sync runs are owned by [background jobs](../../shared/background-jobs.md), and the Kit's only visibility into them is `kai status`'s running, stopped, or not-installed read of launchd.

External services. Polar is reached twice: once by the download gate, which only validates, and once by `kai login`, which activates; the gate worker also streams the tarball from R2. No other Kit command reaches an external service; the Instagram and Anthropic credentials the Kit collects are consumed later, by the sidecar and by analysis, not by the Kit's own commands. See [external services](../../shared/external-services.md).

Status and failures. `kai status` and `kai doctor` are the Kit's own status surface, entirely separate from the app's shell failure strip, since a buyer runs them from a terminal before or instead of ever opening the app. A service that has crash looped past what launchd has noticed yet still reads as running in `kai status` (see limitations above).

Configuration and settings. `KAI_LICENSE_KEY`, `KAI_HOME`, `KAI_INSTALL_URL`, and `WORKSPACE_ROOT` are environment overrides read at the CLI layer, not settings a buyer edits from the app; `COOK_MODEL`, `COOK_CONCURRENCY`, and the cook watchdog and idle thresholds are consumed downstream by the studio, not by the Kit.

## 10. Edge cases

- **The download gate and `kai login` are separate Polar checks on purpose,** so a buyer can reinstall or update freely without spending an activation slot; only `kai login` spends one, and a key already active on two machines refuses a third until the buyer deactivates one in the Polar portal.
- **Extraction is atomic.** A killed install run never leaves a half extracted version as `current`; the new version builds in a `.partial` directory and is moved into place only once complete.
- **The IG_PASSWORD secret prompt returns empty on a real terminal (KIT-1),** the confirmed hard blocker for Instagram sync on an interactive install; the piped path (`kit init < answers`) is unaffected. See [`kai kit init`](#4-kai-kit-init).
- **`kai up` can report the Instagram sidecar as running even when it has crashed on a bad password,** since the message names the sidecar's own configured port rather than checking that the port answers; only `kai doctor` and the service logs show the real state.
- **`kai update`'s default install URL and its entitlement cache path each carry a suspected mismatch (KIT-3, KIT-4),** unconfirmed against a real second release. See [`kai update`](#8-kai-update).
- **No live install has been proven to complete a real Instagram sync or a real AI analysis with real credentials,** since the one buyer test that exercised the real installer hit KIT-1 before Instagram sync could run.
