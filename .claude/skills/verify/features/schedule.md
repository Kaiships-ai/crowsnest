# Daily pull and Graph hour budget

Every connector pulls once a day at 05:00 local time (`src/server/services/daily-pull.ts`). A slot missed while the app was closed or the Mac asleep runs on the next tick after start or wake, once. The bridge call `pullAgain(id)` pulls one connector now. Every Graph call is recorded in `source_calls`, and the transport refuses a call once the last hour holds 200, across restarts. Architecture: `documents/architecture/jobs-and-failures.md` and `documents/architecture/mine.md`.

## Sub-features

- Catch-up: on start, the slot of the newest past 05:00 runs if it has no `daily_pulls` rows.
- The 05:00 run: the first tick at or after 05:00 claims today's slot and pulls each connector; a not-configured connector is recorded `skipped` with its status.
- Bridge `pullAgain(id)`: the connector's pull, outside the slot, returning its outcome.
- Hour budget: `source_calls` rows per Graph call; the 201st call in an hour never leaves the app.

## How to get to it (user POV)

Settings > Sources shows each connector's last pull, the next 05:00 pull and a Pull again button over `pullAgain`. See [connectors.md](connectors.md).

## Driving it

```bash
.claude/skills/verify/scripts/schedule-lane.sh [run-id]   # fake Graph, seeded app, clock at 04:59:30 today, then schedule-01
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]
.claude/skills/verify/scripts/app-down.sh                 # also stops the fake Graph
```

`schedule-lane.sh` starts `fake-graph.mjs` (one account and one reel; `FAKE_GRAPH_NO_MEDIA=1` serves none) on a free port, sets `IG_GRAPH_HOST` to it and `LEAD_STUDIO_CLOCK_START` to 04:59:30 today, and runs `app-up.sh --seed`. `schedule-01` prints `ok: on start the app pulls the slot it missed (yesterday's 05:00) once`, `ok: after the clock passes 05:00 every source pulls on its own, with no command`, `ok: the 05:00 pull wrote a new account snapshot`, `ok: the job log records each connector's outcome`, `ok: pull again pulls one source now through the bridge, outside the slot`, `ok: every Graph call is counted in SQLite`, `ok: Graph v23 refused nothing the app asked, and the reel's insights hold watch time and skip rate` (no `fake-graph: refused:` line, every `instagram-graph` slot `complete`, the fake reel's `avg_watch_time_ms` and `skip_rate` stored), and saves `schedule-01.png`. It reads the lane DB with `sqlite3`.

## Gotchas

- Umami has credentials fields, so with none saved it skips as `needs-setup`; ChatbotX and Polar skip as `not-connected`. `schedule-01` checks each reason.
- `fake-graph.mjs` answers a reel's insights the way Graph v23 does, and one refused name fails the whole call with HTTP 400, code 100: `reposts` (or any metric outside views, reach, likes, comments, shares, saved, total_interactions and the three `ig_reels`/`reels_skip_rate` ones) gets "The Media Insights API does not support the metrics: ...", `profile_activity` gets "... does not support the profile_activity metric for this media product type.", and an account `views` breakdown other than `follow_type` or `media_product_type` is refused. Each refusal is logged as `fake-graph: refused: ...` in `data/verify/app/fake-graph.log`. Known product gap: on main the reel pull asks for `reposts` and `profile_activity` and the views split for `follower_type`, so the first pull of the reel reads `partial` (later slots skip a reel measured recently and read `complete`) and `schedule-01` fails its last step; the fix is uncommitted in the `real-data-run` worktree (branch `fix/graph-reel-metrics`).
- The restart-mid-hour budget proof is vitest (`client.test.ts`), not the lane: it boots the client twice on one file DB.
- The sidecar is down in the lane, so `ig-sidecar` reads `failed (Instagram service is unreachable)`; that is the expected report, not a lane failure.
- The own-measure scheduler also writes a snapshot on boot with the real time; the journey reads only snapshots between 05:00 and 06:00 on the app clock.
