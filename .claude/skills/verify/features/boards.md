# Boards

Crowsnest boards open as tabs in the Lead Studio workspace: channels (tracked channels), Vault (each connector's state, with Sửa secret entry) and Agents (the MCP journal and agent tokens), all read through the engine bridge. Architecture: `documents/architecture/boards.md`.

## Sub-features

- Board tab (`board-tab`), opened from the tab bar "+" menu, Lead Studio group (`new-tab-board`, `data-board-id`).
- App menu: top-level Boards menu, one item per board. On macOS the app menu itself is named Lead Studio, so boards get their own menu.
- Channels rows (`board-channels-row`).
- Vault rows (`vault-row`, `data-connector-id`, `data-state`), `vault-problem`, `vault-test`, `vault-pull`, `vault-edit`, `vault-message`; Sửa fields `vault-secret-field` (`data-secret-name`), `vault-secret-input`, `vault-secret-save`, `vault-secret-status`.
- Agents: `agents-token-name`, `agents-token-create`, `agents-new-token` (`agents-new-token-value`, `agents-new-token-copy`, `agents-new-token-done`), `agents-token-row` (`data-token-name`, `data-revoked`), `agents-revoke`, `agents-revoke-confirm`; `agents-journal-row` (`data-caller`, `data-tool`), `agents-caller-filter`.
- Load states: `board-state-loading`, `board-state-empty`, `board-state-error` with `board-retry`; `board-refresh` reloads a ready board.

## How to get to it (user POV)

Open a project, click "+" in the tab bar, then Channels, Vault or Agents under Lead Studio. Or use the Boards app menu.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh board-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh vault-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh agents-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`board-01` prints `ok: open the channels board from the new-tab menu`, `ok: each value sits under its header` (each header cell and the fixture row's cell in the same position overlap on x), `ok: opening it again reuses the tab`, `ok: a failed query shows the error state`, `ok: Retry brings the rows back`, and saves `board-01-ready.png` and `board-01-error.png`. It forces the error the way a real query fails: it drops the `channels_single_own` partial index (SQLite will not rename a table under a partial index that names it) and renames the `channels` table in the lane DB (`<userDataDir>/crowsnest.db`, with `userDataDir` read from the lane state file that `app-host.mjs` writes) with `sqlite3`, clicks Refresh, then renames it back and recreates the index in a `finally` and clicks Retry.

`vault-01` prints `ok: open the Vault board from the new-tab menu and see every connector` (row ids match `listConnectors`), `ok: Sửa saves a fake secret, clears the input and shows only where it is stored`, `ok: no bridge read carries the saved value` (it also calls `setConnectorSecret` with a field Umami does not declare and gets `umami has no field IG_GRAPH_TOKEN`), `ok: the lane DB holds the key sealed, never in plaintext` (`sqlite3` on `<userDataDir>/crowsnest.db`, `.dump` included), `ok: Kiểm tra shows the connection check`, and saves `vault-01-dark.png`, `vault-01-light.png`, `vault-01-saved.png`, `vault-01.png`.

`agents-01` makes one `crowsnest_save_funnel` call with `mcp.sh --app` (reads are not journaled), then prints `ok: one MCP call with the local token shows in the journal with caller local`, `ok: the caller filter keeps only that caller's rows`, `ok: Tạo shows the new token once, and Xong hides it for good` (the new token calls the MCP with 200), `ok: Thu hồi asks to confirm, then the token gets 401`, and saves `agents-01-dark.png`, `agents-01-light.png`, `agents-01-created.png`, `agents-01.png`.

## Gotchas

- The journey needs a tab bar, so the lane must have a project open, as for `shell-01`.
- The app menu is native; CDP cannot click it. The journey covers the "+" menu path only.
- A board tab is not restored after a restart.
- If a run dies between the two renames, the lane DB keeps `channels_off`; `app-down.sh` and a fresh `app-up.sh --seed` reset it.
- The channels board's follower count, median views and outliers move only from a complete channel pull: a sync cut mid-walk leaves them as they were and marks the job `partial`. No journey drives that, because a lane makes no Instagram calls; the proof is the B1-07 test in `src/server/services/sync-engine.test.ts`. A journey run checks only that the seeded numbers still show.
- The light screenshots drop the `dark` class on `<html>` for the snap and put it back; the theme setting does not change.
- `vault-01` never presses Kéo lại: on a seeded lane Graph and the sidecar are real network calls. The state mapping is proven in `src/server/queries/vault-board.test.ts`.
- Token and fake-secret names carry a timestamp, so both journeys rerun on the same lane.
