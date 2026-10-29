---
name: verify
description: Prove behavior in the Lead Studio Electron app, crowsnest's only UI. Launches an isolated app with Playwright _electron.launch on a seeded or copied database (app-up.sh), drives it with app journeys (app-drive.sh), calls its MCP (mcp.sh), and keeps screenshot and transcript evidence (app-down.sh). Use to prove a UI, MCP or server change works in the real app, not just in vitest.
---

# Verify crowsnest

One surface: the Lead Studio Electron app at the repo root, with crowsnest's `src/server` (data, jobs, the MCP) in its main process. Other surfaces (the `kai` CLI in `src/kai-cli/`, the IG sidecar in `services/ig/`) are not covered here.

All helpers live in `.claude/skills/verify/scripts/` and run from any cwd. Run them under node 24 (`export PATH=/opt/homebrew/opt/node@24/bin:$PATH`) after `pnpm install` at the root.

Rule G-03: every PR that adds or changes a feature adds or updates its file in `features/` and a journey that runs it on the app; the journey fails when that step breaks. `scripts/check-verify-coverage.mjs` fails CI when a PR touches `src/renderer/` or `src/server/` without touching a feature file in `features/` other than `README.md`.

## Launch

```bash
APP_DEV=1 .claude/skills/verify/scripts/app-up.sh --seed      # dev mode, the default for agents: no build
.claude/skills/verify/scripts/app-up.sh                       # build in e2e mode, launch on an empty DB, wait for "app: ready"
.claude/skills/verify/scripts/app-up.sh --seed                # DB = fresh scripts/seed-e2e.ts seed
APP_REAL_DB=<db> .claude/skills/verify/scripts/app-up.sh --real  # DB = a copy of <db> (default data/crowsnest.db)
```

`app-up.sh` runs `app-host.mjs`, which launches the app the way `tests/e2e/helpers/orca-app.ts` does: a disposable user data dir and HOME, mock keychain, a seeded git repo with one terminal tab. `APP_NO_REPO=1` skips the repo, so the app starts with no project open, as on a first launch (`fresh-lane.sh`). It never uses the installed Orca.app profile. The lane's DB is always `<userData>/crowsnest.db` (`CROWSNEST_DB_PATH`), copied with `scripts/copy-db.ts`, so a lane never opens the checkout's `data/crowsnest.db`. Nothing pulls on its own, so the seed changes only through the journey's clicks; the publish scheduler stays off unless `LEAD_STUDIO_PUBLISH_JOBS=1`. `APP_DEV=1` skips the build and runs `electron-vite dev --mode e2e --watch` with the same user data, HOME, DB, mock keychain and CDP port, so every journey connects unchanged, and serves the renderer on a free port (`app-dev.mjs`), never the 5173 of the operator's `pnpm dev`: a renderer edit shows in the running app through HMR in about a second, and a main or preload edit rebuilds and restarts Electron (the MCP port file is recopied). Agents run dev mode only; the build path is for packaging checks. `APP_SKIP_BUILD=1` reuses `out/`; `APP_HEADLESS=1` hides the window; `APP_RECORD_VIDEO=<dir>` records a webm. Logs: `data/verify/app/{seed,build,host}.log`. The build goes through `scripts/heavy.sh`, so it waits with "heavy: another heavy job holds ..." while another worktree builds or tests.

`app-up.sh` fingerprints the Claude hooks in `~/.claude/settings.json` and `~/.orca/agent-hooks`; `app-down.sh` exits 1 with `app: HOST CHANGED` when they changed during the run. Report that with the revert path.

## Drive

```bash
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]  # run app-journeys/shell-01.mjs
.claude/skills/verify/scripts/app-drive.sh --console          # host log
.claude/skills/verify/scripts/app-drive.sh --timing 3         # cold start vs Orca.app
.claude/skills/verify/scripts/mcp.sh tools/list               # the app's MCP, port and token from data/verify/app/
.claude/skills/verify/scripts/mcp.sh crowsnest_plans '{}'
```

`app-drive.sh <journey>` connects over CDP and runs `app-journeys/<journey>.mjs`. A journey exports `default async ({ page, step, snap, snapAndCompare })`; each `step(label, fn)` prints `ok: <label>` or `FAIL: <label>` and exits 1. `snapAndCompare(name, locator?)` shoots the page (or one element) and fails when more than 0.5% of its pixels (`BASELINE_DIFF_MAX`) differ from `<name>.png` in the approved baseline (`~/.claude/orchestrate/lead-studio-v2/baseline`, or `BASELINE_APPROVED`); run it once with `UPDATE_BASELINE=1` to approve a new shot. Shoot on `baseline-lane.sh`, whose stopped clock keeps dates fixed. Journeys reuse Orca's own e2e helpers from `tests/e2e/helpers/`. Use `mcp.sh` for agent-side setup (plan versions, funnel rows, attach video), then prove the result in the UI. Each feature's journey and gotchas are in `features/`.

## Run in CI

`.github/workflows/verify.yml` runs on every PR that touches `src/renderer/`, `src/server/` or the verify skill: an Ubuntu runner, Xvfb, dev mode, the boards lane (fake sidecar, Umami and Polar; no real-service keys). `ci-journeys.mjs` picks the journeys: each `app-drive.sh <journey>` a changed feature file names, minus the ones that need their own lane (`gate2-01`, `schedule-01`, `fresh-01`, `card-state-*`, `graph-pull-01`, `crash-rest-*`, `baseline-v2`), or `shell-01` when none is left. `ci-run.sh` records the display with ffmpeg (`run.mp4`), drives each journey, and writes `summary.md`; the workflow uploads `data/verify/evidence/ci/` as the `verify-evidence` artifact and comments its link and the journey table on the PR. `BASELINE_SKIP=1` turns `snapAndCompare` into a plain shot, since the approved baselines are macOS shots. It is not a required check.

When a change needs no real keys, use the CI run as its proof instead of a local app: push, then read the PR comment and the artifact. Run the app locally only for a real-data run, a lane-only journey, or a baseline compare.

## Run every journey

```bash
.claude/skills/verify/scripts/run-all.sh [run-id]   # dev mode; exits 1 when any journey or the baseline compare failed
```

Each journey runs on the lane it needs, in dev mode: `baseline-lane.sh --compare` (stopped clock) runs its board journeys in order and then `gate2-01` on the fake Graph; the boards lane (fake sidecar and Umami) runs every other journey except Orca's own `shell-01` and `close-terminal`; then `fresh-01` on `fresh-lane.sh` (no project open) `schedule-01` on `schedule-lane.sh` (fake Graph, clock at 04:59:30), and `card-state-01` then `card-state-02` on `card-state-lane.sh`, which quits and reopens the app on the same DB between them. Journeys share one app per lane and run in order, so a journey must leave the app the way it found it (close its sheet, go back to the app). `run-all-report.mjs` writes `data/verify/evidence/<run-id>/report.html`: each DoD id from the proposal's `data.js` with its pass criterion, the journeys that assert it and their state, then each journey's steps, DB checks, shots and diffs. A journey names its DoD ids in `export const dod = ["B2-02"];`.

`snapAndCompare` (above) fails the step on a diff over the threshold and on a shot with no approved baseline. Shoot the board, not the page, so tabs and the window chrome never count. Baselines hold the state `run-all.sh` leaves after the journeys before it, so compare through `run-all.sh`, not a lone `app-drive.sh` run. `UPDATE_BASELINE=1` approves this run's shots; look at each one first.

## Add a journey for a new screen

1. Give every element the journey drives a `data-testid` (`scripts/testid-audit.sh` checks).
2. Copy `app-journeys/today-01.mjs` to `app-journeys/<screen>-01.mjs`; keep its `sql` and `mcp` helpers.
3. Set `export const dod = [...]` to the DoD ids whose pass criterion it asserts.
4. Set up data the way an agent does (`mcp(...)`), then open the screen from "+" in the tab bar.
5. One `step` per criterion: read the number in the UI and the same number from the lane DB with `sql`, and throw when they differ.
6. End with `snapAndCompare("<screen>-01", board)`, run `run-all.sh` with `UPDATE_BASELINE=1` once, check the shot, commit it.
7. Add the journey to its `features/<part>.md`.

## Evidence

`app-drive.sh` writes `data/verify/evidence/<run-id>/<journey>.transcript.txt` plus every `snap` screenshot there (`data/` is gitignored). A proof is:

- the real user path through the UI, never a direct server-action call or DB insert;
- the transcript showing each action and its `ok:` assertion, plus a screenshot of the end state;
- the side effect read back from the lane's DB, e.g. `sqlite3 <userData>/crowsnest.db "select count(*) from saved_posts"` with the user data dir `app-up.sh` printed.

Network boundaries are fakes, never the real services: `fake-graph.mjs` (Graph v23 and the S3 bucket), `fake-sidecar.mjs` (the IG sidecar) and `fake-umami.mjs`, started by the lane scripts. A fake answers the way the real service does, refusals included: `fake-graph.mjs` refuses a metric or breakdown Graph v23 refuses for a reel with its HTTP 400 code 100 body, and `fake-sidecar.mjs` answers an expired session with the body the real sidecar sends. When a real run finds the service answering something a fake does not, teach the fake that answer and add the journey that would have caught it. A lane with no fake for a service points it at a refused port (`baseline-lane.sh` sets `IG_GRAPH_HOST` to `127.0.0.1:9`).

## Real-service keys

A real-data run (the smallest real sample, never a lane with fakes) reads its keys from one place outside the repo, `~/.config/lead-studio-test/<service>.env` (mode 600). Agents never ask Kai for a key again and never print one.

```bash
.claude/skills/verify/scripts/test-keys.sh save umami        # Kai, in his own terminal: address + API key, hidden, tested at once
.claude/skills/verify/scripts/test-keys.sh save graph        # Instagram Graph token, tested with /me
.claude/skills/verify/scripts/test-keys.sh save ig-session   # sidecar sessionid; proved by the sidecar card's Test connection
.claude/skills/verify/scripts/test-keys.sh save s3          # endpoint, bucket, key, secret, public base; hidden; check is a HEAD on the public base only (no write)
.claude/skills/verify/scripts/test-keys.sh check             # exit 1 when a key is missing or refused
```

A run loads a key with `set -a; . ~/.config/lead-studio-test/umami.env; set +a`. When `check` fails for the service a run needs, the run stops with `BLOCKED need <service> key` and names the `save` command; it does not guess or reuse a key from another file. Publish lanes load s3 from there (`s3.env`), never from `.env.local`.

### Real check

```bash
.claude/skills/verify/scripts/real-check.sh umami --db <userData>/crowsnest.db [--proof ~/.claude/orchestrate/proof/<pr>/proof.json]
.claude/skills/verify/scripts/real-check.sh graph --db <userData>/crowsnest.db [--proof ...]
```

Run it after a real-data lane (`app-up.sh --real`) has pulled. It reads the key from `~/.config/lead-studio-test/<service>.env`, makes read-only GETs, and prints a table of the lane DB's value against the real service's, one `ok` or `DIFF` per row; it exits 1 on any `DIFF`, and on a missing key prints `BLOCKED need <service> key`. `umami`: pageviews, summed daily visitors and `checkout_click` over the 7 complete Asia/Ho_Chi_Minh days before today (the app's `umami_days.clean`, test sessions dropped; set `UMAMI_WEBSITE_ID` when the key reads more than one site). `graph`: followers (latest `own_account_snapshots`) and views, likes, comments of the 5 newest reels (latest `own_post_insights`). With `--proof` it writes the rows into that file's `numbers` list (`label`, `source`, `expected` = real, `app`), replacing rows with the same label, so the proof page compares them.

## Proof page

Every complex PR ends with one page Kai opens to decide it. The owner fills `~/.claude/orchestrate/proof/<pr>/proof.json` and puts the media beside it:

```json
{ "pr": 242, "title": "...", "risk": "low|medium|high", "prUrl": "https://github.com/...",
  "youWillSee": ["one step Kai takes, in his words", "..."],
  "video": "flow.webm",
  "states": [{ "name": "Ready", "prototype": "proto-ready.png", "before": "before-ready.png", "after": "after-ready.png" }],
  "numbers": [{ "label": "Visits, 7 days", "source": "Umami dashboard", "expected": 123, "app": 123 }],
  "checks": [{ "label": "CI green", "ok": true }],
  "cost": "new tokens · minutes", "undo": "Revert button on the PR" }
```

`node .claude/skills/verify/scripts/proof-page.mjs ~/.claude/orchestrate/proof/<pr>` checks every media file exists and writes `index.html` and `comment.md`. A state with no before shot (a new state) sets `before` to null. A state with no prototype adds a failing check, "Chưa có prototype được duyệt", because every state the app shows needs one Kai approved. A measured number (a timing) sets `tolerancePct`; others must be equal. `numbers` compare the app with the real source on the smallest real sample, never a fake. The root publishes `index.html` as a private claude.ai artifact with the media as supporting files, puts the page URL in `comment.md`, and runs `gh pr comment <pr> --body-file comment.md`. Kai opens that one link.

## Cleanup

```bash
.claude/skills/verify/scripts/app-down.sh
```

Stops only the app `app-up.sh` started and keeps `data/verify/evidence/`. Never `pkill node` or `pkill Electron`; the operator's own app is one too. In a worktree, `app-down.sh` also runs `keep-evidence.sh`, which copies `data/verify/evidence/` to `~/.claude/orchestrate/proof/evidence/<branch>/` (slashes become dashes); it never writes into the operator's main checkout. Run it on its own after recording outside `app-drive.sh`, such as a proof video. Evidence lives in the worktree or under `~/.claude/orchestrate/proof/`.

After the branch's PR merges, retire the worktree:

```bash
.claude/skills/verify/scripts/retire.sh <worktree-path>   # run from outside the worktree, e.g. the main checkout
```

It refuses the main checkout, a worktree with uncommitted changes, and a branch whose PR is not merged and whose head is not on `origin/main`. It stops the worktree's `browse` server and refuses while any other process still has its working directory inside the worktree, such as an agent pane; it lists their pids. It also refuses while a process's command line points into the worktree, such as a leftover Electron daemon, and lists it. It removes clean nested worktrees under the worktree or in a scratchpad folder named after it, and keeps dirty ones. Otherwise it runs `app-down.sh` (stop the app, copy the evidence), then removes the worktree and its local branch. Retire every worktree the task created, delegate worktrees under `.claude/worktrees/` included.

## The operator's app

Kai's daily app is `pnpm dev` in the main checkout. It opens that checkout's `data/crowsnest.db` and migrates it on launch. Never drive, build in, or stop it. A DB from another branch can carry more `__drizzle_migrations` rows than `drizzle/` has; never delete the DB to fix that.
