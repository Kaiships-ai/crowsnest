---
name: verify
description: Bring up the crowsnest stack and prove behavior in it. Two modes. The operator stack (9router, migrated data/crowsnest.db, dev server on :3000, browser) for daily use, and an isolated verify instance (production build on :3001 against the seeded data/e2e.db) driven by the browse CLI journeys with screenshot, transcript, and DB evidence. Use to start crowsnest, or to prove a UI or server-action change works in the real app, not just in vitest.
---

# Verify crowsnest

The primary surface is the Next.js web UI served by `server.ts` (it also hosts the MCP at `/api/mcp`). Other surfaces (the `kai` CLI in `src/cli/`, the IG sidecar in `services/ig/`) are not covered here.

Use the operator stack to run crowsnest day to day. Use the verify instance for proof: it never touches the operator's app. It runs on **:3001** against **`data/e2e.db`**, rebuilt from `scripts/seed-e2e.ts` on every launch. The operator's own server is usually on :3000 with `data/crowsnest.db`; never drive or kill it.

All helpers live in `.claude/skills/verify/scripts/` and run from any cwd.

## Operator stack (:3000)

The operator's daily app: 9router LLM proxy on :20128, `data/crowsnest.db` migrated to the checked-out schema, `npm run dev` on :3000, and a browser on it. Bring it up, or check it, with:

```bash
.claude/skills/verify/scripts/stack-up.sh           # start 9router, migrate + bootstrap, smoke routes
.claude/skills/verify/scripts/stack-up.sh --check   # read-only: no start, no migrate
```

It leaves anything already up alone and never kills a port holder. It smokes `/ /feed /channels/discover /mine /runs /settings`; each must answer 2xx or 3xx (`/mine` can redirect). Run it from the checkout whose `data/crowsnest.db` you mean; a worktree has none. Logs go to `~/.crowsnest/`.

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

Ready when it prints `verify: ready on http://localhost:3001`. It means `GET /feed` returned 200 against a freshly seeded DB. It runs `npm run build` then `npm run start` (production) because Next 16 refuses a second `next dev` in one checkout ("Another next dev server is already running"). So rebuild after every code change; `VERIFY_SKIP_BUILD=1` only when nothing changed. Logs: `data/verify/{build,seed,server}.log`. It refuses to start if :3001 is taken; set `VERIFY_PORT` to move it.

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
$B goto http://localhost:3001/vault && $B wait --networkidle
$B text                     # visible page text
$B screenshot data/verify/evidence/<run-id>/vault.png
```

`browse eval` only reads JS files under `/tmp` or the cwd. Select options are `[data-slot="select-item"]` nodes matched by visible text; check the label in the component before scripting it. Each feature's routes, test ids, and journey are in `features/`.

### Evidence

`drive.sh` writes `data/verify/evidence/<run-id>/<journey>.transcript.txt` plus every `snap` screenshot there (`data/` is gitignored). A proof is:

- the real user path through the UI, never a direct server-action call or DB insert;
- the transcript showing each action and its `ok:` assertion, plus a screenshot of the end state;
- the side effect read back from the DB, e.g. `sqlite3 data/e2e.db "select count(*) from saved_posts"`.

Network boundaries stay real: the IG sidecar and Graph API are not mocked, so a journey that needs them either runs with them down and asserts the error path, or is out of scope for this harness.

### Cleanup

```bash
.claude/skills/verify/scripts/down.sh
```

Kills only the process group `up.sh` started, removes the pid/port files, and keeps `data/verify/evidence/`. `data/e2e.db` is left for inspection and rebuilt on the next launch. Never `pkill node` or kill by name; the operator's dev server is a node process too.
