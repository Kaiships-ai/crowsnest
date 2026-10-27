# Gate 2 and publish

A reel goes to Instagram only after Kai approves it on the Gate 2 board. Publish on a Plan card opens a sheet with the five checks (video, caption, keyword, time, cover; a missing keyword is a yellow warning) and stores a `publish_reel` draft; Approve on the Gate 2 board publishes it through the existing publish path with the cook's cover as `cover_url`, or schedules it when the draft has a set time. A failed publish puts the draft back to pending with its error; a draft whose video, caption or cover changed after it was made fails Approve with `DRAFT_STALE`. Architecture: `documents/architecture/publish.md`, `documents/architecture/boards.md`.

## Sub-features

- Cover: `crowsnest_attach_video` on `<name>.mp4` also stores `<name>-cover.png` beside it as `cover_asset_id`.
- Publish sheet (`plan-publish`, `publish-sheet`, `publish-check` with `data-check` and `data-status`, `publish-send`, `publish-sent`).
- Today's Gate 2 count opens the board (`today-open-gate2`).
- Gate 2 board: what (`gate2-what`), to whom (`gate2-to`), the cover (`gate2-cover`), checks, Approve (`gate2-approve`), Reject (`gate2-reject`), the decided list with proposer and approver (`gate2-decided`).
- Approve publishes: bucket PUT of the mp4 and the png, Graph `media` with `video_url` and `cover_url`, the container poll, `media_publish`, both DELETEs. Journal: `drafted`, `pending`, `ok` at gate2 with the draft id.

## Driving it

```bash
until mkdir ~/.claude/orchestrate/lead-studio-beta/locks/app-lane 2>/dev/null; do sleep 30; done
.claude/skills/verify/scripts/gate2-lane.sh [run-id]
.claude/skills/verify/scripts/app-down.sh
rmdir ~/.claude/orchestrate/lead-studio-beta/locks/app-lane
```

`gate2-lane.sh` starts `fake-graph.mjs`, which is also the S3 bucket (`/bucket/` takes PUT and DELETE, `/public/` serves them), points `IG_GRAPH_HOST` and every `S3_*` at it, sets `PUBLISH_DRY_RUN=0` and the baseline's stopped clock, runs `app-up.sh --seed` and `gate2-01`. The real Graph and bucket are never reachable from this lane. `gate2-01` prints `ok:` for the MCP attach with its cover, the sheet's checks (`video:ok caption:ok keyword:warn time:ok cover:ok`), the stored draft with no Graph call, Today's count against the DB and the board's what and to whom, the publish calls read from `data/verify/app/fake-graph.log`, and the published reel with its journal. It compares `B6-01-publish-sheet` and `B6-01-gate2-board` (light and dark) to the approved baseline and saves `gate2-01-approved.png`.

## Gotchas

- The journey sets the pending draft's `created_at` to the stopped clock before the board shot, because drafts are stamped with the real time.
- The seed's Graph user id is `0`, so the publish calls are `/v21.0/0/media` and `/v21.0/0/media_publish`.
- `baseline-lane.sh` cannot run `gate2-01` on its own app, whose Graph host refuses; it stops that app and runs `gate2-lane.sh` last.
