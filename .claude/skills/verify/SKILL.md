---
name: verify
description: Launch an isolated crowsnest web app (production build on :3001 against the seeded data/e2e.db), drive it through the browse CLI journeys, and capture screenshot, transcript, and DB evidence. Use to prove a crowsnest UI or server-action change works in the real app, not just in vitest.
---

# Verify crowsnest

The primary surface is the Next.js web UI served by `server.ts` (it also hosts the MCP at `/api/mcp`). Other surfaces (the `kai` CLI in `src/cli/`, the IG sidecar in `services/ig/`) are not covered here.

The verify instance never touches the operator's app. It runs on **:3001** against **`data/e2e.db`**, rebuilt from `scripts/seed-e2e.ts` on every launch. The operator's own server is usually on :3000 with `data/crowsnest.db`; never drive or kill it.

All helpers live in `.claude/skills/verify/scripts/` and run from any cwd.

## Launch

```bash
.claude/skills/verify/scripts/up.sh                       # build + seed + start
VERIFY_SKIP_BUILD=1 .claude/skills/verify/scripts/up.sh   # reuse the last build
```

Ready when it prints `verify: ready on http://localhost:3001`. It means `GET /feed` returned 200 against a freshly seeded DB. It runs `npm run build` then `npm run start` (production) because Next 16 refuses a second `next dev` in one checkout ("Another next dev server is already running"). So rebuild after every code change; `VERIFY_SKIP_BUILD=1` only when nothing changed. Logs: `data/verify/{build,seed,server}.log`. It refuses to start if :3001 is taken; set `VERIFY_PORT` to move it.

## Doctor

```bash
.claude/skills/verify/scripts/doctor.sh
```

Read-only. Checks our pid is alive, :3001 belongs to our process group, `/feed` answers 200, `data/e2e.db` exists, and the `browse` CLI is installed (`~/.claude/skills/gstack/browse/dist/browse`). Notes when the IG sidecar on :8765 is up. Run it first whenever anything looks off. Any `FAIL` means do not drive.

## Drive

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

## Evidence

`drive.sh` writes `data/verify/evidence/<run-id>/<journey>.transcript.txt` plus every `snap` screenshot there (`data/` is gitignored). A proof is:

- the real user path through the UI, never a direct server-action call or DB insert;
- the transcript showing each action and its `ok:` assertion, plus a screenshot of the end state;
- the side effect read back from the DB, e.g. `sqlite3 data/e2e.db "select count(*) from saved_posts"`.

Network boundaries stay real: the IG sidecar and Graph API are not mocked, so a journey that needs them either runs with them down and asserts the error path, or is out of scope for this harness.

## Cleanup

```bash
.claude/skills/verify/scripts/down.sh
```

Kills only the process group `up.sh` started, removes the pid/port files, and keeps `data/verify/evidence/`. `data/e2e.db` is left for inspection and rebuilt on the next launch. Never `pkill node` or kill by name; the operator's dev server is a node process too.
