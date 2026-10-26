# Daily pull and Graph hour budget

Every connector pulls once a day at 05:00 local time (`src/server/services/daily-pull.ts`). A slot missed while the app was closed or the Mac asleep runs on the next tick after start or wake, once. The bridge call `pullAgain(id)` pulls one connector now. Every Graph call is recorded in `source_calls`, and the transport refuses a call once the last hour holds 200, across restarts. Architecture: `documents/architecture/jobs-and-failures.md` and `documents/architecture/mine.md`.

## Sub-features

- Catch-up: on start, the slot of the newest past 05:00 runs if it has no `daily_pulls` rows.
- The 05:00 run: the first tick at or after 05:00 claims today's slot and pulls each connector; a not-configured connector is recorded `skipped` with its status.
- Bridge `pullAgain(id)`: the connector's pull, outside the slot, returning its outcome.
- Hour budget: `source_calls` rows per Graph call; the 201st call in an hour never leaves the app.

## How to get to it (user POV)

The Vault board shows each connector's last pull, the next 05:00 pull and a Kéo lại button over `pullAgain`. See [boards.md](boards.md).

## Driving it

```bash
.claude/skills/verify/scripts/schedule-lane.sh [run-id]   # fake Graph, seeded app, clock at 04:59:30 today, then schedule-01
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]
.claude/skills/verify/scripts/app-down.sh                 # also stops the fake Graph
```

`schedule-lane.sh` starts `fake-graph.mjs` (one account, no media) on a free port, sets `IG_GRAPH_HOST` to it and `LEAD_STUDIO_CLOCK_START` to 04:59:30 today, and runs `app-up.sh --seed`. `schedule-01` prints `ok: on start the app pulls the slot it missed (yesterday's 05:00) once`, `ok: after the clock passes 05:00 every source pulls on its own, with no command`, `ok: the 05:00 pull wrote a new account snapshot`, `ok: the job log records each connector's outcome`, `ok: pull again pulls one source now through the bridge, outside the slot`, `ok: every Graph call is counted in SQLite`, and saves `schedule-01.png`. It reads the lane DB with `sqlite3`.

## Gotchas

- Umami has credentials fields, so with none saved it skips as `needs-setup`; ChatbotX and Polar skip as `not-connected`. `schedule-01` checks each reason.

- The restart-mid-hour budget proof is vitest (`client.test.ts`), not the lane: it boots the client twice on one file DB.
- The sidecar is down in the lane, so `ig-sidecar` reads `failed (Instagram service is unreachable)`; that is the expected report, not a lane failure.
- The own-measure scheduler also writes a snapshot on boot with the real time; the journey reads only snapshots between 05:00 and 06:00 on the app clock.
