# On-demand pulls and Graph hour budget

Nothing pulls on a timer or on start: the app runs on the operator's Mac, so a pull runs only when the operator presses Pull on a Settings > Sources card (bridge `pullConnector(id)`, `src/server/services/connector-status.ts`). Only the publish scheduler runs on a timer, and only with `LEAD_STUDIO_PUBLISH_JOBS=1`. Every Graph call is recorded in `source_calls`, and the transport refuses a call once the last hour holds 200, across restarts. Architecture: `documents/architecture/connectors.md`, `documents/architecture/jobs-and-failures.md` and `documents/architecture/mine.md`.

## Sub-features

- No schedule: past the old 05:00 slot no snapshot, Graph call or `connector_status` row appears.
- Bridge `pullConnector(id)`: the connector's pull now, recorded as the card's state.
- Hour budget: `source_calls` rows per Graph call; the 201st call in an hour never leaves the app.

## How to get to it (user POV)

Settings > Sources: each card that can pull has a Pull button and shows its last pull time; none names a next pull. See [connectors.md](connectors.md).

## Driving it

```bash
.claude/skills/verify/scripts/schedule-lane.sh [run-id]   # fake Graph, seeded app, clock at 04:59:30 today, then schedule-01
.claude/skills/verify/scripts/app-down.sh                 # also stops the fake Graph
```

`schedule-lane.sh` starts `fake-graph.mjs` (one account and one reel; `FAKE_GRAPH_NO_MEDIA=1` serves none) on a free port, sets `IG_GRAPH_HOST` to it and `LEAD_STUDIO_CLOCK_START` to 04:59:30 today, and runs `app-up.sh --seed`. `schedule-01` prints `ok: past 05:00 on the app clock nothing pulls on its own: no snapshot, no Graph call, no card event`, `ok: Settings > Sources: Pull on the Graph card pulls now and the card reads Ready`, `ok: every Graph call is counted in SQLite`, `ok: Graph v23 refused nothing the app asked but profile_activity on a reel, and the reel's insights hold watch time and skip rate` (no `fake-graph: refused:` line other than `profile_activity` on the reel, the Graph row `ready`, the fake reel's `avg_watch_time_ms` and `skip_rate` stored), and saves `schedule-01.png`. It reads the lane DB with `sqlite3`.

## Gotchas

- `fake-graph.mjs` answers a reel's insights the way Graph v23 does, and one refused name fails the whole call with HTTP 400, code 100: `reposts` (or any metric outside views, reach, likes, comments, shares, saved, total_interactions and the three `ig_reels`/`reels_skip_rate` ones) gets "The Media Insights API does not support the metrics: ...", `profile_activity` gets "... does not support the profile_activity metric for this media product type.", and an account `views` breakdown other than `follow_type` or `media_product_type` is refused. Each refusal is logged as `fake-graph: refused: ...` in `data/verify/app/fake-graph.log`. The app asks `profile_activity` for each reel and takes the product-type refusal as no bio link taps, so each reel spends one refused call per measurement.
- The restart-mid-hour budget proof is vitest (`client.test.ts`), not the lane: it boots the client twice on one file DB.
- The journey waits 45 s of real time for the app clock to pass 05:00.
