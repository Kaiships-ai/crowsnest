# Boards

Crowsnest boards open as tabs in the Lead Studio workspace: Hôm nay (the morning screen), Phễu (the funnel, driven in [funnel.md](funnel.md)), Kênh tôi (the own Instagram channel), Đối thủ (the tracked rivals), Vault (each connector's state, with Sửa secret entry) and Agents (the MCP journal and agent tokens), all read through the engine bridge. Architecture: `documents/architecture/boards.md`.

## Sub-features

- Board tab (`board-tab`), opened from the tab bar "+" menu, Lead Studio group (`new-tab-board`, `data-board-id`).
- App menu: top-level Boards menu, one item per board. On macOS the app menu itself is named Lead Studio, so boards get their own menu.
- Hôm nay: `today-offer`, `today-offer-step`, `today-step` (`data-step-id`), `today-drop` (`data-status`), `today-gates`, `today-gate-plans`, `today-gate-drafts`, `today-pulls`, `today-pull-row` (`data-connector-id`, `data-state`), `today-workspaces`, `today-workspace-row`; every number has a `source-label`, and a gap is `reading-missing` or `reading-not-connected` with `open-vault`.
- Kênh tôi: tabs `own-tab-home`, `own-tab-perf`, `own-tab-content`, `own-tab-aud` (panels `own-panel-*`), `own-days-7`, `own-days-30`, `own-stat-<metric>`, `own-total-<dm|gift_page_visit|purchase>`, `own-by-format`, `own-post-row` (`data-post-id`, `data-pull-error`) with `own-open-reel`, `own-post-pull-error` and `own-after-<key>` (`data-status`: `value`, `missing` or `no-keyword`), `own-sort-<key>`, `own-follower-split`, `own-audience-*`; reel view `own-reel-back`, `own-reel-open`, `own-reel-tab-ov`, `own-reel-tab-eng`, `own-reel-tab-after`, `own-reel-<metric>`, `own-reel-history`, `own-after-step` (`data-step-id`, `data-status`), `own-after-none`.
- Đối thủ: `rivals-channel-row` (`data-handle`), `rivals-outlier` (`data-video-id`), `rivals-outlier-open`, `rivals-evidence-card` (`data-video-id`), `rivals-evidence-open` (`data-url`), `rivals-add-input`, `rivals-add-submit`, `rivals-add-message` (`data-status`).
- Vault rows (`vault-row`, `data-connector-id`, `data-state`), `vault-problem`, `vault-test`, `vault-pull`, `vault-edit`, `vault-message`; Sửa fields `vault-secret-field` (`data-secret-name`), `vault-secret-input`, `vault-secret-save`, `vault-secret-status`.
- Agents: `agents-token-name`, `agents-token-create`, `agents-new-token` (`agents-new-token-value`, `agents-new-token-copy`, `agents-new-token-done`), `agents-token-row` (`data-token-name`, `data-revoked`), `agents-revoke`, `agents-revoke-confirm`; `agents-journal-row` (`data-caller`, `data-tool`, `data-result`, `data-call-id`), `agents-caller-filter`.
- Load states: `board-state-loading`, `board-state-empty`, `board-state-error` with `board-retry`; `board-refresh` reloads a ready board.

## How to get to it (user POV)

Open a project, click "+" in the tab bar, then Hôm nay, Phễu, Kênh tôi, Đối thủ, Vault or Agents under Lead Studio. Or use the Boards app menu.

## Driving it

```bash
.claude/skills/verify/scripts/boards-lane.sh                # fake sidecar + app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh own-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh rivals-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh today-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh vault-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh agents-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`boards-lane.sh` starts `fake-sidecar.mjs` on a free port (it answers `/profile` with a profile built from the handle and 503 to every other path), sets `IG_SERVICE_URL` to it, and runs `app-up.sh --seed`. Every other journey here runs on that lane too. The seed (`scripts/seed-e2e.ts`) holds the Kênh tôi rows (account `e2e_own`, reels `own-reel-1..3` and `own-carousel-1`, plan keyword `OWN01` published as `own-reel-1` with 52 DMs, 18 visits, 3 orders) and the rival `@e2e_fixture_rival` with one analyzed post; rival and own post URLs are on example.com, so opening one never calls Instagram.

`own-01` sets the viewport to 1440x875, then prints `ok: open Kênh tôi from the new-tab menu: Tổng quan shows the bridge's numbers, each with its source` (views, followers and DM against `getOwnBoard(30)`), `ok: Hiệu suất shows views by content type`, `ok: Nội dung lists the window's posts from the DB with each post's own comments, shares and saves; DM is 52 by keyword, a reel with no keyword reads chưa nối, never 0, and a failed newest pull is marked on its row` (`sqlite3` on the lane DB; the seed gives `own-reel-3` a failed capture newer than its good one), `ok: Khán giả shows the follower split from the stored breakdowns`, `ok: a reel opens on Tổng quan, and Sau reel walks OWN01's funnel with checkout chưa nối`, `ok: back to the board, 7 ngày keeps only the last week's posts`, and saves `own-01-home`, `own-01-content` and `own-01-after`, each `-dark` and `-light`.

`rivals-01` prints `ok: open Đối thủ from the new-tab menu: the rival shows with its source, the own channel does not`, `ok: the rival's outliers are its posts at 2x or more in 30 days, best first` (against the lane DB), `ok: an evidence card opens the original post in a browser tab` (the store's browser tabs hold the post's URL), `ok: opening Đối thủ again comes back to the same board tab`, `ok: a handle that is not a handle is refused with its reason and writes nothing`, `ok: Thêm đối thủ adds a channel after the profile check, and the new row shows` (the DB row carries the fake profile's id and follower count), `ok: a failed read shows the error state` (it renames `video_analyses` in the lane DB and clicks Refresh, then renames it back in a `finally`), `ok: Retry brings the board back`, and saves `rivals-01-dark.png`, `rivals-01-light.png` and `rivals-01-added.png`.

`today-01` sets the viewport to 1440x875 (a 1440x900 screen less the macOS menu bar), saves funnel rows (keyword `TODAY01`) and proposes a week plan (`2099-W01`) with `mcp.sh --app`, then prints `ok: open Hôm nay from the new-tab menu and see every block with a source label`, `ok: every number on the board sits in a block that names its source`, `ok: checkout reads chưa nối, never 0, and with no targets the drop says chưa đặt chuẩn`, `ok: gate counts match the lane DB` (`sqlite3` on the lane DB), `ok: last night's pulls show each connector's state from the Vault data` (against `getVaultBoard`), `ok: the board fits 1440x900 with no scroll`, and saves `today-01-dark.png` and `today-01-light.png`.

`vault-01` prints `ok: open the Vault board from the new-tab menu and see every connector` (row ids match `listConnectors`), `ok: Sửa saves a fake secret, clears the input and shows only where it is stored`, `ok: no bridge read carries the saved value` (it also calls `setConnectorSecret` with a field Umami does not declare and gets `umami has no field IG_GRAPH_TOKEN`), `ok: the lane DB holds the key sealed, never in plaintext` (`sqlite3` on `<userDataDir>/crowsnest.db`, `.dump` included), `ok: Kiểm tra shows the connection check`, and saves `vault-01-dark.png`, `vault-01-light.png`, `vault-01-saved.png`, `vault-01.png`.

`agents-01` makes one `crowsnest_save_funnel` call with `mcp.sh --app` (reads are not journaled), then prints `ok: one MCP call with the local token shows in the journal as one ok row with caller local` (its call id appears once, its pending row hidden), `ok: the caller filter keeps only that caller's rows`, `ok: Tạo shows the new token once, and Xong hides it for good` (the new token calls the MCP with 200), `ok: Thu hồi asks to confirm, then the token gets 401`, and saves `agents-01-dark.png`, `agents-01-light.png`, `agents-01-created.png`, `agents-01.png`.

## Gotchas

- The journey needs a tab bar, so the lane must have a project open, as for `shell-01`.
- The app menu is native; CDP cannot click it. The journey covers the "+" menu path only.
- A board tab is not restored after a restart.
- If `rivals-01` dies between the two renames, the lane DB keeps `video_analyses_off`; `app-down.sh` and a fresh lane reset it.
- On `boards-lane.sh` the app's background sync reaches the fake sidecar and gets 503, so the rival row shows that sync error. Without the fake sidecar, Thêm đối thủ shows the sidecar-down error and writes nothing.
- Đối thủ's follower count, median views and outliers move only from a complete channel pull: a sync cut mid-walk leaves them as they were and marks the job `partial`. No journey drives that, because a lane makes no Instagram calls; the proof is the B1-07 test in `src/server/services/sync-engine.test.ts`. A journey run checks only that the seeded numbers still show.
- The light screenshots drop the `dark` class on `<html>` for the snap and put it back, with the app's `theme-transition-disabled` class on during the swap so the snap does not catch text mid-fade; the theme setting does not change. Each journey also waits for the "+" menu to close before its first snap.
- `vault-01` never presses Kéo lại: on a seeded lane Graph and the sidecar are real network calls. The state mapping is proven in `src/server/queries/vault-board.test.ts`.
- Token and fake-secret names carry a timestamp, so both journeys rerun on the same lane.
- `today-01` sizes the page with `setViewportSize`: Electron's CDP has no `Browser.setWindowBounds`. Each rerun proposes one more week plan version, and the gate check reads the DB, so it still holds.
- No journey shows a failed or partial pull on Hôm nay: a lane makes no Instagram calls. The proof is `src/server/queries/today-board.test.ts`.
