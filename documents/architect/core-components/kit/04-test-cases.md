# kit: test cases

How to run these: on an Apple Silicon Mac with a clean `~/.kai` (or back up and move
an existing one aside), a real crowsnest license key from Polar, and a network. Most
cases exercise the installed bundle, so start from the real `curl | sh` install
unless a case says otherwise; a few dev-repo cases (`kai doctor`, `kai update`'s
refusal) run from a clone. The gate Worker and Polar are live services, so the
license and download cases need real credentials; do not fake them. The two
`kai kit init` secret cases (KIT-04, KIT-05) must be run on a real interactive
terminal, not piped, because that is exactly where the defects appear. Reset by
removing `~/.kai/app`, `~/.kai/state`, `~/.kai/entitlement.json`, and the two
`~/Library/LaunchAgents/com.crowsnest.*.plist` files between runs.

Column key: P is priority, Needs is what the case requires, Result is the last known
outcome (`not run`, `pass`, or `fail` with a note).

## Install: `curl | sh`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INST-01 | P1 | arm64 Mac + real key | The four-line happy path installs the product under `~/.kai` with no Node/Python/git/Xcode/Homebrew and no sudo. | Clean `~/.kai`, valid key. | 1. Run the `curl \| sh` line.<br>2. Paste the key at the prompt. | The script downloads, verifies, extracts, sets up the venv, flips `current`, links `~/.local/bin/kai`, and prints the three next commands. | not run |
| INST-02 | P1 | Intel Mac (or forced) | A real Intel Mac is refused with a refund pointer; Rosetta on Apple Silicon is let through. | An Intel Mac, or force the arch branch. | 1. Run the installer. | Dies "crowsnest needs an Apple Silicon Mac (M1 or newer). Yours is Intel. Reply to your receipt for a refund." (`install.sh.template:34`) | not run |
| INST-03 | P1 | bad key | An unrecognized key at the download gate stops the install before any download. | Clean state, an invalid key. | 1. Run the installer, paste a junk key. | Dies "License not recognized. Check the key from your receipt and try again." (`install.sh.template:61`) | not run |
| INST-04 | P1 | real key | The download is verified by both byte size and sha256 baked into the script, so a corrupted or tampered tarball is rejected. | Valid install; then a way to corrupt the downloaded tarball mid-run, or point the gate at a wrong object. | 1. Corrupt the tarball before the checksum step. | The file is deleted and it dies "Checksum mismatch. The download was corrupted or tampered with. Rerun." (`install.sh.template:78`) | not run |
| INST-05 | P1 | real key | The download gate validates the key but does not activate it, so an install (or reinstall) spends no Polar activation slot. | A key with a known activation count. | 1. Note the Polar activation count.<br>2. Run the installer to completion.<br>3. Re-check the count. | The activation count is unchanged after install. | not run |
| INST-06 | P2 | real key | Extraction is atomic: a killed run never leaves a half-extracted version as `current`. | Valid install. | 1. Kill the installer during `tar`.<br>2. Inspect `~/.kai/app`. | A `v<version>.partial` may remain but `current` still points at the prior good version (or is unset on a first install); no half-tree is `current`. | not run |
| INST-07 | P2 | real key | The installer adds `~/.local/bin` to PATH for the buyer's shell if it is missing. | A shell without `~/.local/bin` on PATH. | 1. Run the installer.<br>2. Read the shell rc file. | The right rc file (`.zshrc`/`.bash_profile`/`.bashrc`/fish) gains the PATH line and the script says to open a new terminal. | not run |
| INST-08 | P2 | low disk | The disk preflight refuses before downloading when free space is below the baked requirement. | A home volume under `__REQUIRED_MB__` free (or force `AVAIL_MB`). | 1. Run the installer. | Dies "Not enough disk space..." before any download. (`install.sh.template:66`) | not run |
| INST-09 | P3 | real key | The offline Python bootstrap installs the sidecar deps from the bundled wheelhouse with no network. | Valid install, network optionally cut after the tarball download. | 1. Run install; watch the "Setting up the Instagram helper..." step. | The venv is built and packages install from `$APP/wheelhouse` with `--no-index`; no PyPI fetch. | not run |
| INST-10 | P3 | fresh install | The next-steps footer echoes the buyer's license key on screen. | A fresh (non-update) install. | 1. Complete an install and read the final lines. | Record what happens: the footer prints `kai login <KEY>` with the real key, landing it in scrollback. (minor UX defect) | not run |

## `kai login`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LOGIN-01 | P1 | real key | `kai login` activates and caches the entitlement at `~/.kai/entitlement.json` (0600). | Installed kai, valid key, no cached entitlement. | 1. `kai login <key>`. | Prints "License active. Saved to <path>" and "Next: kai kit init"; `entitlement.json` exists at 0600 with `key`, `activation_id`, `customer_id`, `validated_at`. | not run |
| LOGIN-02 | P1 | real key | Re-running `kai login` with the same key re-validates the cached activation rather than spending a second slot. | A machine already logged in. | 1. Note the Polar activation count.<br>2. `kai login <key>` again.<br>3. Re-check the count. | The count does not increase; the command still reports the license active. | not run |
| LOGIN-03 | P1 | 3rd machine | A key already active on 2 machines is refused with a pointer to deactivate one. | The key already activated on two other machines, this one with no cached activation. | 1. `kai login <key>`. | Dies "That license key is already active on 2 machines. Deactivate one in the Polar customer portal, then run `kai login` again." (`license.ts:89-91`) | not run |
| LOGIN-04 | P1 | bad key | An unknown key is refused as not found. | Installed kai. | 1. `kai login KSA-junk`. | Dies "That license key was not found. Check it for typos, then try again." (`license.ts:82-84`) | not run |
| LOGIN-05 | P2 | none | Missing key argument prints usage. | Installed kai. | 1. `kai login`. | Dies "Usage: kai login <license-key>". (`kai.ts:96`) | not run |
| LOGIN-06 | P2 | network off | A network failure is reported as unreachable Polar, not a bad key. | Network down. | 1. `kai login <key>`. | Dies "Could not reach Polar: <message>". (`kai.ts:105`) | not run |

## `kai kit init`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KIT-01 | P1 | no entitlement | `kit init` refuses without a cached license. | Installed kai, no `entitlement.json`. | 1. `kai kit init`. | Dies "No license found. Run `kai login <license-key>` first." (`kai.ts:121`) | not run |
| KIT-02 | P1 | entitlement + piped answers | The piped, non-interactive path (`kit init < answers`) sets every value, including the IG password, correctly. | Logged in; an answers file with username, password, key, vault path. | 1. `kai kit init < answers`. | `.env.local` (0600) has non-empty `IG_USERNAME`, `IG_PASSWORD`, `ANTHROPIC_API_KEY`, a generated `IG_SERVICE_TOKEN`, and `VAULT_PATH`; the db is created and the services start. | not run |
| KIT-03 | P1 | entitlement | `kit init` generates `IG_SERVICE_TOKEN` when it is still the placeholder, and hands off to `kai up` at the end. | Logged in, `.env.local` with a `change-me` token. | 1. Run `kai kit init` and let it finish. | "Generated IG_SERVICE_TOKEN" is printed, the token in `.env.local` is a random hex string, and the run ends by starting crowsnest and opening the dashboard. | not run |
| KIT-04 | P1 | entitlement + real TTY | (BUG 1, blocker) On a real terminal the masked `IG_PASSWORD` prompt returns empty, so `.env.local` gets `IG_PASSWORD=` and the IG sidecar refuses to start (exit 78) and crash-loops; 8765 never opens. | Logged in, run on a real interactive terminal (not piped). | 1. `kai kit init`.<br>2. Type a username, then type a password at the masked prompt.<br>3. Inspect `.env.local` and `kai status`. | Record what happens: `IG_PASSWORD=` is empty (length 0), `com.crowsnest.ig` is stopped/crash-looping, and the IG helper log shows "IG_USERNAME and IG_PASSWORD must be set together". (confirmed defect, `evidence/10-onboarding-bugs.md`; root cause `kai.ts:51-70`, 138-140) | fail (confirmed in #20 buyer test) |
| KIT-05 | P1 | entitlement + real TTY | (BUG 2) On a real terminal the masked `ANTHROPIC_API_KEY` prompt echoes the key in plaintext, landing it in scrollback. | Logged in, run on a real interactive terminal. | 1. `kai kit init`.<br>2. At the `ANTHROPIC_API_KEY (blank to skip, not echoed):` prompt, type a key. | Record what happens: the key is visible on screen as typed (echo not suppressed), though it is still saved to `.env.local`. (confirmed defect, `evidence/10-onboarding-bugs.md`; root cause `kai.ts:151` via `ask({secret:true})`) | fail (confirmed in #20 buyer test) |
| KIT-06 | P2 | entitlement | A blank `ANTHROPIC_API_KEY` is allowed and leaves the key unset; the keyless Create-Prompt export still works. | Logged in. | 1. `kai kit init`, leave the key blank.<br>2. Inspect `.env.local`. | No `ANTHROPIC_API_KEY` value is written; the run still completes and starts crowsnest. | not run |
| KIT-07 | P2 | entitlement | `.env.local` is written at 0600 because it holds the IG password. | Logged in. | 1. Run `kai kit init`.<br>2. `ls -l .env.local`. | The file mode is `-rw-------` (0600). (`kai.ts:160-163`) | not run |
| KIT-08 | P2 | entitlement | `kit init` runs migrations then bootstrap through node->tsx directly (never `npm run`), creating the tables and the filter presets. | Logged in, fresh db. | 1. `kai kit init`.<br>2. Inspect the created db. | The db has the migrated tables and the built-in filter presets; no "no such table" error. | not run |
| KIT-09 | P3 | entitlement | Re-running `kit init` edits `.env.local` in place rather than clobbering it. | An existing `.env.local` with custom values. | 1. Run `kai kit init` again, change one answer. | Only the answered keys change; comments, ordering, and untouched values are preserved. (`setEnv`, `kai.ts:75-79`) | not run |

## Services: `kai up` / `kai start` / `kai stop` / `kai status`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SVC-01 | P1 | initialized kit | `kai up` starts both services, polls localhost:3000 for up to 25s, and opens the dashboard on success. | Logged in, kit initialized. | 1. `kai up`. | Prints "crowsnest is running: http://localhost:3000" and opens the browser; both LaunchAgents load. | not run |
| SVC-02 | P1 | initialized kit | Services are set RunAtLoad + KeepAlive so they survive a reboot or closed terminal. | Services started. | 1. `kai up`.<br>2. Reboot (or log out/in).<br>3. `kai status`. | Both services come back `running` without re-running `kai up`. | not run |
| SVC-03 | P1 | no entitlement | `kai up`/`kai start` require a license. | No cached entitlement. | 1. `kai up`. | Dies "No license found. Run `kai login <license-key>` first." (`kai.ts:187-189`) | not run |
| SVC-04 | P2 | server that fails | On a server that never answers, `kai up` times out at 25s, tails the server log, and points at `kai doctor`. | A build where the server cannot start (or 3000 taken). | 1. `kai up`. | Prints "The dashboard did not come up within 25s.", shows the last 10 lines of the server log, and dies "Run `kai doctor` to diagnose." (`kai.ts:230-234`) | not run |
| SVC-05 | P2 | BUG 1 present | With an empty IG password, `kai up` still brings the server up and opens the dashboard while the IG sidecar crash-loops. | A kit initialized on a real TTY (KIT-04). | 1. `kai up`.<br>2. `kai status`. | The dashboard opens (server on 3000 runs); `com.crowsnest.ig` shows stopped/not running. | not run |
| SVC-06 | P2 | running services | `kai stop` unloads both services and needs no license. | Services running, entitlement optionally removed. | 1. `kai stop`.<br>2. `kai status`. | Prints "crowsnest services stopped."; both services report stopped. | not run |
| SVC-07 | P2 | after update | `kai start` is idempotent: it boots out an already-loaded label first so a new version's plist takes effect. | A running install, then a new version dir. | 1. `kai start` again. | Both services reload against the new plist without a "already loaded" error. | not run |
| SVC-08 | P2 | initialized kit | `kai status` reports the license line and per-service running/stopped/not-installed state, touching no network. | Logged in, services in a known state. | 1. `kai status`. | Prints "License: active (activation <id>)" and each service's state; runs offline. | not run |

## `kai doctor`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-01 | P1 | installed bundle | `kai doctor` prints an OK/!! line per check (version, mode, native modules, sidecar venv+import, config, license, services, uv+wheelhouse) and never touches the network. | A healthy bundle install. | 1. `kai doctor` (offline). | All checks print `[OK]` with detail; no network call is made. | not run |
| DOC-02 | P2 | broken venv | Doctor flags a missing sidecar venv with a "rerun kai kit init" hint. | An install with the sidecar `.venv` removed. | 1. `kai doctor`. | The "python sidecar" line reads `[!!] ... venv missing (rerun kai kit init)`. (`kai.ts:268-269`) | not run |
| DOC-03 | P2 | no entitlement | Doctor flags a missing license without failing the whole run. | Installed, no `entitlement.json`. | 1. `kai doctor`. | The "license" line reads `[!!] ... run kai login`; other checks still print. | not run |

## `kai update`

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UPD-01 | P1 | installed + newer release | `kai update` re-runs the installer, reusing the cached key and preserving `~/.kai/state`, then migrates and restarts if running. | An installed older version and a newer release in R2. | 1. `kai update`. | Updates to the new version; the db, config, and media survive; services restart if they were running. | not run |
| UPD-02 | P2 | dev repo | `kai update` refuses in the dev repo. | A dev clone (not a bundle). | 1. `kai update`. | Dies "kai update is for installed builds, not the dev repo." (`kai.ts:299`) | not run |
| UPD-03 | P2 | installed, no KAI_INSTALL_URL | (suspected defect) The default install URL points at an unconfigured custom domain. | An install with `KAI_INSTALL_URL` unset. | 1. `kai update`. | Record what happens: it curls `https://get.crowsnest.sh/install.sh` (`kai.ts:300`), which is not set up per the packaging doc; the live URL is the `workers.dev` subdomain. (latent gap) | not run |
| UPD-04 | P3 | installed | (suspected defect) The installer reads the cached key from `~/.kai/state/entitlement.json`, but `kai login` writes it to `~/.kai/entitlement.json`, so update-path key reuse may not find it. | A logged-in install with no `KAI_HOME` set. | 1. Compare where `entitlement.json` exists vs. where `install.sh` reads it. | Record what happens: the paths differ (`install.sh.template:43` vs. `license.ts:13-16`), so the installer may fall back to prompting for the key on update. | not run |

Not checkable by hand:

- Whether the gate Worker's 15-minute HMAC token actually expires mid-download on a
  slow link (would surface as a download failure, not a checksum failure).
- Whether a Polar-side revocation propagates to `kai login`'s validate call promptly,
  versus being masked by the cached activation.
- Whether the `kai update` domain and entitlement-path mismatches (UPD-03, UPD-04)
  bite in the field; neither has been run against a real second release.
- Whether a live Instagram sync or a real AI analysis completes after install; the
  #20 buyer test hit BUG 1 first, so the IG half was never exercised end to end.
