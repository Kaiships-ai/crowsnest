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
.claude/skills/verify/scripts/app-up.sh                       # build in e2e mode, launch on an empty DB, wait for "app: ready"
.claude/skills/verify/scripts/app-up.sh --seed                # DB = fresh scripts/seed-e2e.ts seed
APP_REAL_DB=<db> .claude/skills/verify/scripts/app-up.sh --real  # DB = a copy of <db> (default data/crowsnest.db)
```

`app-up.sh` runs `app-host.mjs`, which launches the app the way `tests/e2e/helpers/orca-app.ts` does: a disposable user data dir and HOME, mock keychain, a seeded git repo with one terminal tab. It never uses the installed Orca.app profile. The lane's DB is always `<userData>/crowsnest.db` (`CROWSNEST_DB_PATH`), copied with `scripts/copy-db.ts`, so a lane never opens the checkout's `data/crowsnest.db`. The app runs sync and own-measure on that DB; the publish scheduler stays off unless `LEAD_STUDIO_PUBLISH_JOBS=1`. `APP_SKIP_BUILD=1` reuses `out/`; `APP_HEADLESS=1` hides the window; `APP_RECORD_VIDEO=<dir>` records a webm. Logs: `data/verify/app/{seed,build,host}.log`. The build goes through `scripts/heavy.sh`, so it waits with "heavy: another heavy job holds ..." while another worktree builds or tests.

`app-up.sh` fingerprints the Claude hooks in `~/.claude/settings.json` and `~/.orca/agent-hooks`; `app-down.sh` exits 1 with `app: HOST CHANGED` when they changed during the run. Report that with the revert path.

## Drive

```bash
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]  # run app-journeys/shell-01.mjs
.claude/skills/verify/scripts/app-drive.sh --console          # host log
.claude/skills/verify/scripts/app-drive.sh --timing 3         # cold start vs Orca.app
.claude/skills/verify/scripts/mcp.sh tools/list               # the app's MCP, port from data/verify/app/mcp.port
.claude/skills/verify/scripts/mcp.sh crowsnest_plans '{}'
```

`app-drive.sh <journey>` connects over CDP and runs `app-journeys/<journey>.mjs`. A journey exports `default async ({ page, step, snap })`; each `step(label, fn)` prints `ok: <label>` or `FAIL: <label>` and exits 1. Journeys reuse Orca's own e2e helpers from `tests/e2e/helpers/`. Use `mcp.sh` for agent-side setup (plan versions, funnel rows, attach video), then prove the result in the UI. Each feature's journey and gotchas are in `features/`.

## Evidence

`app-drive.sh` writes `data/verify/evidence/<run-id>/<journey>.transcript.txt` plus every `snap` screenshot there (`data/` is gitignored). A proof is:

- the real user path through the UI, never a direct server-action call or DB insert;
- the transcript showing each action and its `ok:` assertion, plus a screenshot of the end state;
- the side effect read back from the lane's DB, e.g. `sqlite3 <userData>/crowsnest.db "select count(*) from saved_posts"` with the user data dir `app-up.sh` printed.

Network boundaries stay real: the IG sidecar and Graph API are not mocked, so a journey that needs them either runs with them down and asserts the error path, or is out of scope for this harness.

## Cleanup

```bash
.claude/skills/verify/scripts/app-down.sh
```

Stops only the app `app-up.sh` started and keeps `data/verify/evidence/`. Never `pkill node` or `pkill Electron`; the operator's own app is one too. In a worktree, `app-down.sh` also runs `keep-evidence.sh`, which copies `data/verify/evidence/` into the main checkout at `data/verify/evidence/<branch>/` (slashes become dashes). Run it on its own after recording outside `app-drive.sh`, such as a proof video. Proof lives in the main checkout; the worktree copy is scratch.

After the branch's PR merges, retire the worktree:

```bash
.claude/skills/verify/scripts/retire.sh <worktree-path>   # run from outside the worktree, e.g. the main checkout
```

It refuses the main checkout, a worktree with uncommitted changes, and a branch whose PR is not merged and whose head is not on `origin/main`. It stops the worktree's `browse` server and refuses while any other process still has its working directory inside the worktree, such as an agent pane; it lists their pids. It also refuses while a process's command line points into the worktree, such as a leftover Electron daemon, and lists it. It removes clean nested worktrees under the worktree or in a scratchpad folder named after it, and keeps dirty ones. Otherwise it runs `app-down.sh` (stop the app, copy the evidence), then removes the worktree and its local branch. Retire every worktree the task created, delegate worktrees under `.claude/worktrees/` included.

## The operator's app

Kai's daily app is `pnpm dev` in the main checkout. It opens that checkout's `data/crowsnest.db` and migrates it on launch. Never drive, build in, or stop it. A DB from another branch can carry more `__drizzle_migrations` rows than `drizzle/` has; never delete the DB to fix that.
