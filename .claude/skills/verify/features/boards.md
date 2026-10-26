# Boards

Crowsnest boards open as tabs in the Lead Studio workspace. The first is the channels board, a list of tracked channels read through the engine bridge. Architecture: `documents/architecture/boards.md`.

## Sub-features

- Board tab (`board-tab`), opened from the tab bar "+" menu, Lead Studio group (`new-tab-board`, `data-board-id`).
- App menu: top-level Boards menu, one item per board. On macOS the app menu itself is named Lead Studio, so boards get their own menu.
- Channels rows (`board-channels-row`).
- Load states: `board-state-loading`, `board-state-empty`, `board-state-error` with `board-retry`; `board-refresh` reloads a ready board.

## How to get to it (user POV)

Open a project, click "+" in the tab bar, then Channels under Lead Studio. Or use the Boards app menu, Channels.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh board-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`board-01` prints `ok: open the channels board from the new-tab menu`, `ok: opening it again reuses the tab`, `ok: a failed query shows the error state`, `ok: Retry brings the rows back`, and saves `board-01-ready.png` and `board-01-error.png`. It forces the error the way a real query fails: it drops the `channels_single_own` partial index (SQLite will not rename a table under a partial index that names it) and renames the `channels` table in the lane DB (`<userDataDir>/crowsnest.db`, with `userDataDir` read from the lane state file that `app-host.mjs` writes) with `sqlite3`, clicks Refresh, then renames it back and recreates the index in a `finally` and clicks Retry.

## Gotchas

- The journey needs a tab bar, so the lane must have a project open, as for `shell-01`.
- The app menu is native; CDP cannot click it. The journey covers the "+" menu path only.
- A board tab is not restored after a restart.
- If a run dies between the two renames, the lane DB keeps `channels_off`; `app-down.sh` and a fresh `app-up.sh --seed` reset it.
- The channels board's follower count, median views and outliers move only from a complete channel pull: a sync cut mid-walk leaves them as they were and marks the job `partial`. No journey drives that, because a lane makes no Instagram calls; the proof is the B1-07 test in `src/server/services/sync-engine.test.ts`. A journey run checks only that the seeded numbers still show.
