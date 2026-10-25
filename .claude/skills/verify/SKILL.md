---
name: verify
description: Bring up the crowsnest stack and prove behavior in it. Three modes. The Lead Studio Electron app in studio/, launched with Playwright _electron.launch and driven by app journeys (app-up.sh, app-drive.sh, app-down.sh). The operator stack (9router, migrated data/crowsnest.db, dev server on :3000, browser) for daily use, and an isolated verify instance (production build on :3001 against the seeded data/e2e.db) driven by the browse CLI journeys with screenshot, transcript, and DB evidence. Use to start crowsnest, or to prove a UI or server-action change works in the real app, not just in vitest.
---

# Verify crowsnest

Two surfaces. The Lead Studio Electron app in `studio/` is where boards move, one PR at a time. The Next.js web UI served by `server.ts` (it also hosts the MCP at `/api/mcp`) keeps every screen not moved yet. Other surfaces (the `kai` CLI in `src/cli/`, the IG sidecar in `services/ig/`) are not covered here.

Use the operator stack to run crowsnest day to day. Use the verify instance for proof: it never touches the operator's app. It runs on **:3001** against **`data/e2e.db`**, rebuilt from `scripts/seed-e2e.ts` on every launch. The operator's own server is usually on :3000 with `data/crowsnest.db`; never drive or kill it.

All helpers live in `.claude/skills/verify/scripts/` and run from any cwd.

## Lead Studio app

Rule G-03: every PR that adds or changes a feature adds or updates its file in `features/` and a journey that runs it on the Lead Studio Electron app; the journey fails when that step breaks. `scripts/check-verify-coverage.mjs` fails CI when a PR touches `studio/src/renderer/` or `src/server/` without touching a feature file in `features/` other than `README.md`.

```bash
.claude/skills/verify/scripts/app-up.sh                       # build studio/ in e2e mode, launch, wait for "app: ready"
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]  # run app-journeys/shell-01.mjs
.claude/skills/verify/scripts/app-down.sh                     # stop it, keep evidence
```

`app-up.sh` runs `app-host.mjs`, which launches the app with Playwright `_electron.launch` the way `studio/tests/e2e/helpers/orca-app.ts` does: a disposable user data dir and HOME, mock keychain, a seeded git repo with one terminal tab. It never uses the installed Orca.app profile. `APP_SKIP_BUILD=1` reuses `studio/out/`; `APP_HEADLESS=1` hides the window; `APP_RECORD_VIDEO=<dir>` records a webm. Logs: `data/verify/app/{build,host}.log`. `app-up.sh` fingerprints the Claude hooks in `~/.claude/settings.json` and `~/.orca/agent-hooks`; `app-down.sh` exits 1 with `app: HOST CHANGED` when they changed during the run. Report that with the revert path.

`app-drive.sh <journey>` connects over CDP and runs `app-journeys/<journey>.mjs`. A journey exports `default async ({ page, step, snap })`; each `step(label, fn)` prints `ok: <label>` or `FAIL: <label>` and exits 1. The transcript and screenshots go to `data/verify/evidence/<run-id>/`. Journeys reuse Orca's own e2e helpers from `studio/tests/e2e/helpers/`. `--console` prints the host log; `--timing [rounds]` times cold starts of Orca.app and Lead Studio to first contentful paint and fails over 1.5x. Setup and gotchas are in `features/app-shell.md`.

## Operator stack (:3000)

The operator's daily app: 9router LLM proxy on :20128, `data/crowsnest.db` migrated to the checked-out schema, `npm run dev` on :3000, and a browser on it. Bring it up, or check it, with:

```bash
.claude/skills/verify/scripts/stack-up.sh           # start 9router, migrate + bootstrap, smoke routes
.claude/skills/verify/scripts/stack-up.sh --check   # read-only: no start, no migrate
```

It leaves anything already up alone and never kills a port holder. It smokes `/ /feed /channels /channels/discover /logs /runs /settings`; each must answer 2xx or 3xx. Run it from the checkout whose `data/crowsnest.db` you mean; a worktree has none. Logs go to `~/.crowsnest/`.

**The dev server runs in an Orca pane, never from a tool call.** A `npm run dev` backgrounded from a sandboxed tool call can be reaped within minutes with no crash trace. If `stack-up.sh` reports :3000 down:

```bash
REPO="$(git rev-parse --show-toplevel)"
CUR=$(orca terminal list --worktree "path:$REPO" --json | jq -r '.result.terminals[0].handle // empty')
SURF=$(orca terminal split --terminal "$CUR" --direction vertical --json | jq -r '.result.split.handle')
orca terminal wait --terminal "$SURF" --for tui-idle --timeout-ms 15000 || true
orca terminal send --terminal "$SURF" --text "cd \"$REPO\" && PORT=3000 npm run dev" --enter
```

With no pane for this worktree, use `orca terminal create --worktree "path:$REPO" --title crowsnest-dev-3000 --json` (handle at `.result.terminal.handle`). Then re-run `stack-up.sh --check`. If it never answers, read the pane with `orca terminal read --terminal "$SURF" --screen --json`.

**Browser.** `browse connect` from a repo subdirectory keeps the headed window alive (from `$HOME` or `/tmp` it falls back to headless):

```bash
mkdir -p .gstack/browse-cwd && (cd .gstack/browse-cwd && ~/.claude/skills/gstack/browse/dist/browse connect)
~/.claude/skills/gstack/browse/dist/browse goto http://localhost:3000
```

Use `localhost`, never `127.0.0.1`: Next 16 silently blocks Server Actions from another origin.

**Stale schema.** A stale DB fails per page (`no such column`, a 500 on one route), not at boot; `stack-up.sh` without `--check` migrates first (`db:migrate` backs up to `data/crowsnest.db.bak-<epoch>`). If migrate dies with "table already exists", the drizzle ledger drifted: never delete the DB. Confirm the objects exist (`PRAGMA table_info`), prove the hash scheme (`shasum -a 256 drizzle/<file>.sql` equals the newest `__drizzle_migrations.hash`), stamp only the confirmed migrations with `insert into __drizzle_migrations (hash, created_at) values ('<sha>', <when from drizzle/meta/_journal.json>)`, then migrate again.

**Branch switches.** The dev server serves whatever is checked out. Switching branches under it can leave stale routes (a 404 on a route the new branch has) until it restarts, and a ledger with more rows than `drizzle/` means the DB came from another branch.

## Verify instance (:3001)

### Launch


```bash
.claude/skills/verify/scripts/up.sh                       # build + seed + start
VERIFY_SKIP_BUILD=1 .claude/skills/verify/scripts/up.sh   # reuse the last build
```

A fresh worktree has no `node_modules`: run `npm ci` first (about 10 s). Do not symlink another checkout's `node_modules`; Turbopack fails the build with "Symlink [project]/node_modules is invalid". The build goes through `scripts/heavy.sh`, so it waits with "heavy: another heavy job holds ..." while another worktree builds or tests.

Ready when it prints `verify: ready on http://localhost:3001`. It means `GET /feed` returned 200 against a freshly seeded DB. It runs `npm run build` then `npm run start` (production) because Next 16 refuses a second `next dev` in one checkout ("Another next dev server is already running"). So rebuild after every code change; `VERIFY_SKIP_BUILD=1` only when nothing changed. Logs: `data/verify/{build,seed,server}.log`. It refuses to start if :3001 is taken, which happens when another worktree's verify instance is up; set `VERIFY_PORT` (for example 3002) to move it.

The server runs with `PUBLISH_DRY_RUN=1` and preloads `scripts/e2e/graph-offline.mjs`, which answers every graph.instagram.com call with a rejected-token error, so nothing reaches Instagram. A worktree has no `.env.local`, so no `S3_*` vars are set and any publish stops at "No storage bucket configured" (see `features/week.md`).

`up.sh` reseeds `data/e2e.db` on every start. Add fixture state only after it prints ready: `npx tsx scripts/e2e/mine-seed.ts plan` for one reel dated today, then `sqlite3 data/e2e.db` for the state a check needs. The seed writes junk `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, and `IG_SERVICE_TOKEN` rows to `secrets`, and a `secrets` row beats the server env.

### Doctor

```bash
.claude/skills/verify/scripts/doctor.sh
```

Read-only. Checks our pid is alive, :3001 belongs to our process group, `/feed` answers 200, `data/e2e.db` exists, and the `browse` CLI is installed (`~/.claude/skills/gstack/browse/dist/browse`). Notes when the IG sidecar is listening on :8765; `drive.sh` then refuses `ig-sync-e2e-01`, which would otherwise query real Instagram. Run it first whenever anything looks off. Any `FAIL` means do not drive.

### Drive

Journeys are the repo's own browse scripts in `scripts/e2e/*-e2e-*.sh` (helpers in `scripts/e2e/lib.sh`: `goto_and_settle`, `assert_text`, `assert_url_contains`, `select_option_by_text`, `snap`). Run one against the verify instance:

```bash
.claude/skills/verify/scripts/drive.sh feed-e2e-01 [run-id]
```

For an ad-hoc check, drive `browse` directly with `data-testid` selectors (the repo audits them with `scripts/testid-audit.sh`):

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B goto http://localhost:3001/feed && $B wait --networkidle
$B text                     # visible page text
$B screenshot data/verify/evidence/<run-id>/feed.png
```

Run browse from `.gstack/browse-cwd` in the checkout (`mkdir -p .gstack/browse-cwd`). Give `screenshot` and `eval` absolute paths: relative ones resolve against the browse server, and it only accepts paths under the checkout or `/tmp`. Use `localhost`, never `127.0.0.1`, or Server Actions are blocked. `browse eval` only reads JS files under `/tmp` or the cwd. Select options are `[data-slot="select-item"]` nodes matched by visible text; check the label in the component before scripting it. Each feature's routes, test ids, and journey are in `features/`.

The MCP lives on the same server at `/api/mcp` and needs no token from localhost. `scripts/mcp.sh <tool> '<json-args>'` makes one call against the verify instance, e.g. `mcp.sh crowsnest_propose_plan '{...}'` to put a plan draft on Tuần này. Use it for agent-side setup (plan versions, funnel rows, attach video), then prove the result in the UI. `scripts/week-drag.js` is a browse eval helper for the week's native drag and drop.

### Evidence

`drive.sh` writes `data/verify/evidence/<run-id>/<journey>.transcript.txt` plus every `snap` screenshot there (`data/` is gitignored). From a worktree, the kept copy is in the main checkout; see Cleanup. A proof is:

- the real user path through the UI, never a direct server-action call or DB insert;
- the transcript showing each action and its `ok:` assertion, plus a screenshot of the end state;
- the side effect read back from the DB, e.g. `sqlite3 data/e2e.db "select count(*) from saved_posts"`.

Network boundaries stay real: the IG sidecar and Graph API are not mocked, so a journey that needs them either runs with them down and asserts the error path, or is out of scope for this harness.

### Cleanup

```bash
.claude/skills/verify/scripts/down.sh
```

Kills only the process group `up.sh` started, removes the pid/port files, and keeps `data/verify/evidence/`. `data/e2e.db` is left for inspection and rebuilt on the next launch. Never `pkill node` or kill by name; the operator's dev server is a node process too.

In a worktree, `down.sh` also runs `keep-evidence.sh`, which copies `data/verify/evidence/` into the main checkout at `data/verify/evidence/<branch>/` (slashes become dashes). Run it on its own after recording outside `drive.sh`, such as a proof video. Proof lives in the main checkout; the worktree copy is scratch.

After the branch's PR merges, retire the worktree:

```bash
.claude/skills/verify/scripts/retire.sh <worktree-path>   # run from outside the worktree, e.g. the main checkout
```

It refuses the main checkout, a worktree with uncommitted changes, and a branch whose PR is not merged and whose head is not on `origin/main`. It stops the worktree's `browse` server and refuses while any other process still has its working directory inside the worktree, such as an agent pane; it lists their pids. It stops processes whose command line points into the worktree, such as a leftover Electron daemon, and removes nested worktrees named after it. Otherwise it runs `down.sh` (stop the server, copy the evidence), then removes the worktree and its local branch. Retire every worktree the task created, delegate worktrees under `.claude/worktrees/` included.
