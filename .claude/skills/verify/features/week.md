# Week: Tuần này

The landing screen at `/`: today's reels, the rest of the ISO week, a drawer per reel, and the plan draft bar. Test cases live in `scripts/e2e/cases/week.md`.

## Sub-features

- Screen (`src/components/week/week-tab.tsx`, `week-screen.tsx`): `week-screen`, the next-action chip `week-next-action`, "Hôm nay" (`week-today`, one `week-today-card` per reel dated today), "Cả tuần" collapsed behind `week-toggle` with one `week-day` per other day of this ISO week and a `week-row` per reel.
- Drawer `week-drawer`: five steps (Ý tưởng, Hồ sơ, Video, Đăng, Số 48h), hook `week-hook-input` (or `week-hook-empty` "Reel này chưa có hook. Hook đến từ phiên remix." with no remix session), note `week-note-input`, keyword `week-drawer-keyword`, video `week-drawer-player`.
- Move: `week-move-select` ("Chuyển sang ngày", a native select whose option values are `YYYY-MM-DD`) or drag a `week-row` onto `week-today` or a `week-day`. Undo is `week-move-undo` "Hoàn tác" in the toast. Past days take no drop and are not in the select.
- Publish: `week-publish` "Duyệt đăng", `week-publish-confirm`, `week-publish-go` "Đăng". Without video and caption the gate reads "Chờ video và caption."
- Cancel publish: `week-scheduled` "Hẹn đăng ...", `week-cancel-publish` "Huỷ lịch đăng", `week-cancel-confirm-confirm`.
- Retry: `week-retry` "Thử đăng lại"; at `attempt_count` 3, `week-retry-exhausted` instead.
- Edit and delete: `week-edit` "Sửa plan" opens the plan dialog (Tiêu đề, Ngày, Ghi chú, Kịch bản, Loại video, "Lưu thay đổi"); `week-delete` "Xoá reel", then `week-delete-undo` in the toast.
- Funnel "Số 48h": six `week-funnel-tile` tiles, `data-metric` dms, emails, visits, orders, revenue, members, each "chưa đo" until a `reel_funnel` row exists. With no keyword: "Reel chưa có keyword, nên chưa đo được phễu."
- Plan draft: a proposed week version newer than the live one shows `week-draft-bar` with `week-draft-approve` "Duyệt vN". The approve toast offers `week-approve-undo` only when an older live version exists.
- Graph token line `graph-token-line`: one red line "Instagram từ chối token Graph. Mở Cài đặt để sửa." linking to `/settings#graph-api`, after a Graph check failed in this server process.

## How to get to it (user POV)

Sidebar, Tuần này. It is the landing page.

## Driving it with browse

A fresh seed has no `planned_posts`, so only the empty state renders ("Hôm nay không có reel."). After `up.sh` is ready, seed one reel dated today:

```bash
npx tsx scripts/e2e/mine-seed.ts plan    # row plan-1, state scheduled, today, no scheduled_at
```

Then set the state each sub-feature needs with `sqlite3 data/e2e.db` (fixture state only; drive the action itself through the UI):

| Sub-feature | Fixture | Proof read back |
|---|---|---|
| Note | none | `select note from planned_posts` after Esc |
| Move (select) | none | `planned_date` changes; `week-move-undo` restores it |
| Drag | move the reel to a future day first, it must be a `week-row` | `planned_date` after reload |
| Retry | `state='failed', attempt_count=1, last_error='x'` | `state` scheduled, `last_error` null |
| Cancel publish | after Retry (sets `scheduled_at`) | `draft`, `scheduled_at` and `idempotency_key` null, date and time kept |
| Retry cap | `state='failed', attempt_count=3` | `week-retry-exhausted` present, no `week-retry` |
| Delete and undo | none | `select *` before delete equals `select *` after undo |
| Hook | a `remix_sessions` row linked by `remix_session_id` | `remix_sessions.chosen_hook` after Esc |
| Funnel | `keyword` on the reel, rows via `mcp.sh crowsnest_save_funnel` | tile text, e.g. "2 orders" |
| Plan draft | `mcp.sh crowsnest_propose_plan` with `period` week and this ISO week's `periodKey` | `plan_versions.status`, reels upserted by `plan_reel_key` |
| Video | `mcp.sh crowsnest_attach_video` with an absolute mp4 path | `planned_posts.video_asset_id`, `week-drawer-player` shows |

Drag uses native HTML5 events, which browse has no command for. Copy `scripts/week-drag.js` into the browse cwd and eval it by absolute path:

```bash
cp .claude/skills/verify/scripts/week-drag.js .gstack/browse-cwd/
$B click '[data-testid="week-toggle"]'
$B js 'window.__dragTo = "[data-testid=week-today]"'
$B eval "$PWD/.gstack/browse-cwd/week-drag.js"
```

## Gotchas

- `up.sh` reseeds `data/e2e.db` on every start, so run `mine-seed.ts` and fixture SQL after it prints ready, never before.
- Funnel sources are fixed: chatbotx (dms), umami (emails, visits), polar (orders, revenue), skool (members). A row with another source is stored by raw SQL but never shown; `crowsnest_save_funnel` refuses it and requires `capturedAt`.
- Publishing, even dry run, needs `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE` in the server env and a Graph token and user id. `up.sh` passes none of the S3 vars, so `week-publish-go` toasts "No storage bucket configured. Set S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_PUBLIC_BASE to publish." and the row stays draft. The dry-run success text ("Đã chạy thử (dry run)") needs real S3 creds; the seed's junk Graph secret then still beats any env token.
- "Cả tuần" holds only this ISO week. Late in the week few days are future, and on Sunday there is no future `week-day` to move to.
- A first approved version has no undo; propose a second version to prove `week-approve-undo`.
- `graph-token-line` reads an in-memory cache. It shows only after a Graph check failed in this server process (pressing `mine-connect-check` in Settings, or a page that measures); a restart clears it.
