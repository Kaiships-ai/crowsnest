# Boards

A board is a crowsnest screen that opens as a tab in the Lead Studio workspace. There are seven: `today` (Hôm nay, the morning screen), `funnel` (Phễu, the six-step funnel), `own` (Kênh tôi, the own Instagram channel), `rivals` (Đối thủ, the tracked rival channels), `plan` (Kế hoạch, the planned reels by month, week and day), `vault` (each connector's state, with secret entry) and `agents` (the MCP journal and the agent tokens).

## What it holds

A board holds no data of its own. Each board reads the engine through the engine bridge (`window.api.crowsnest.call`, see [app](app.md)) every time it mounts, and on Retry or Refresh. Table headers and rows are subgrids of one grid, so each value sits in the same column as its header.

A board tab is an editor-family open file (`src/renderer/src/store/slices/editor/types/open-file.ts`) with `mode: 'board'` and a `boardId`. Its tab content type stays `editor`. Its `filePath` is the synthetic id `board::<id>`, and its label is the board's label.

## Board registry

`LEAD_STUDIO_BOARDS` in `src/shared/lead-studio-boards.ts` lists every board as `{ id, label }` and defines `BoardId`. Main (the Boards app menu) and the renderer (the new-tab menu) both read this one list. `BOARD_VIEWS` in `src/renderer/src/components/board/BoardView.tsx` is a `Record<BoardId, Component>`, so the compiler rejects a listed board with no view. Adding a board is one entry in the list plus one component in the record.

## Phễu board

`FunnelBoard` in `src/renderer/src/components/board/FunnelBoard.tsx` calls `getFunnelBoard` (`src/server/queries/funnel-board.ts`), which reads `getFunnel` and computes everything the board shows, so the renderer only formats:

- One row per step of `FUNNEL_STEPS`. The total sums the step's value over every keyword. Its time is the oldest `capturedAt` among the summed values, and `keywordsWithoutNumber` counts the keywords with no number while others have one, shown as "thiếu N keyword" because the total is then a floor. The rate into the step is the ledger rate over the two totals (`ratio` in `src/server/services/funnel.ts`), with the ledger target or "chưa đặt chuẩn".
- One row per keyword with each step's number, the plan's title, or "không có reel".
- Coverage: of the gift-page visits and orders stored per keyword, how many sit under a keyword a planned post holds (`tied / total`).

Each step names its source (Instagram for the reel's insights, else the `reel_funnel` source or the connector not built yet) and, with a number, its time. A reading is a number, "chưa có số" (the source is connected but has no number), or "chưa nối" with a Vault link (`openBoardInActiveWorkspace('vault')`); a gap never reads 0. The board is empty until some keyword has a number.

## Hôm nay board

`TodayBoard` in `src/renderer/src/components/board/TodayBoard.tsx` calls `getTodayBoard` (`src/server/queries/today-board.ts`), one aggregate read, and fits one screen with no scroll. Every block names its source and time.

- Người tới offer: the checkout and purchase totals at headline size, then the six steps from `getFunnelBoard`. A gap reads "chưa có số" or "chưa nối" in the same slot size as a number. A total summed over only some keywords shows "thiếu N keyword" (`KeywordGap` in `src/renderer/src/components/board/funnel-reading.tsx`), as on Phễu.
- The biggest drop (`biggestDrop`), boxed beside the offer as its headline: the step whose rate sits furthest below its target, as rate / target. With no target set it reads "chưa đặt chuẩn"; with targets but no rate it says so.
- Chờ anh duyệt, counts only: Cổng 1 is proposed `plan_versions` newer than their period's live version (an older proposed version that a newer live one passed is not waiting); Cổng 2 is pending `gate_drafts`.
- Đêm qua đã chạy: each connector's Vault state and last pull time, from `getVaultBoard`, with the detail of a failed or partial pull. A partial pull reads "thiếu", never "chạy".
- Workspace đang chạy: workspaces with an agent working, blocked or waiting, read in the renderer from the agent status store (`runningWorkspaces`), since the engine does not know panes.

## Kênh tôi board

`OwnBoard` in `src/renderer/src/components/board/OwnBoard.tsx` calls `getOwnBoard(7 | 30)` (`src/server/queries/own-board.ts`) and has the tabs of Instagram's own dashboard. The 7 ngày and 30 ngày buttons pick the window, which is the posts posted in it.

- Every Instagram number is a reading from the post's newest successful `own_post_insights` capture, with that capture's time. A window total sums the posts that have the number, takes the oldest time, and shows "thiếu N bài" when some posts in the window lack it.
- Tổng quan: views of the window's posts, followers from the newest `own_account_snapshots` row, and net followers against the newest snapshot at or before the window start (missing when there is none). Below, Sau Instagram: DM, Web and Đơn summed over the window's posts.
- Hiệu suất: views, likes, comments, shares and saves; views per content type (`format`); profile visits, bio link taps and follows.
- Nội dung: one row per post with views, likes, comments, shares and saves, then DM (ChatbotX), Web (Umami gift-page visits) and Đơn (Polar orders). Sorting is by date or by any column.
- Khán giả: the follower split and the engaged audience by gender, age and country from `getAccountBreakdowns` (the newest batch per metric), with the stored refusal or failure when Instagram gave none. These are account numbers, not per window.

DM, Web and Đơn come from the metric ledger through `getFunnel`: a post's keyword is the keyword of the plan whose `published_own_post_id` is that post, and its readings are that keyword's `dm`, `gift_page_visit` and `purchase`. A post no plan with a keyword was published as reads `no-keyword`, shown as "chưa nối", never 0. Reach has no window total: Instagram counts reach as unique accounts per post, so a sum would count one person once per post; reach shows per post only. A post whose newest pull failed after its last good one (`pullError`, from the newest failed `own_post_insights` row) keeps the older numbers and is marked on its Nội dung row and in the reel view. The views tile is the sum of the window's posts' own views, not Instagram's account views for the period, which no stored row holds.

A post row opens `OwnReelDetail` (`src/renderer/src/components/board/OwnReelDetail.tsx`), which calls `getOwnReelBoard(ownPostId)`: Tổng quan (views, reach, average watch time, skip rate, follows, reach against the channel median, and the views of each capture as a line), Tương tác (likes, comments, shares, saves, reposts, bio link taps), and Sau reel. Sau reel is `funnelSteps` over the one funnel entry for the reel's keyword, the same six steps and ledger rates as Phễu, each with its source and time; a step with no connector reads "chưa nối". A reel with no keyword says so instead. Mở bài gốc opens the permalink in a workspace browser tab (`openPostInBrowser` in `src/renderer/src/components/board/open-post.ts`).

## Đối thủ board

`RivalsBoard` in `src/renderer/src/components/board/RivalsBoard.tsx` calls `getRivalsBoard` (`src/server/queries/rivals-board.ts`):

- Kênh đang theo dõi: every tracked channel that is not the own one, from `getChannelsList`, with followers, median views, outliers of the last 30 days (score 2 or more), the last read as "Radar · time", and the sync error. Under each channel, its top 3 outliers from `getOutlierFeed`, each opening the original post.
- Bằng chứng: the 12 newest `video_analyses` rows on rival posts, each a card with the channel, score, views, hook type, why it worked, tags, the analysis time, and a button that opens the original post. No stored field says whether an analysis is to take (Lấy về), learn from (Học) or avoid (Tránh), so the cards sit under one heading and the board says so.
- Thêm đối thủ calls `addChannelAction(handle, { requireProfile: true })`: the sidecar must resolve the profile before a row is written, so a typo is refused with its reason and nothing is stored. On success the board reloads and the new channel shows with no numbers until a sync reads it.

## Kế hoạch board

`PlanBoard` in `src/renderer/src/components/board/PlanBoard.tsx` calls `getPlanBoard(month)` (`src/server/queries/plan-board.ts`) once per month and draws three views from that one result, so a change shows in all of them after the reload that follows it.

- `getPlanBoard` returns the whole Monday-to-Sunday weeks covering the month (`days`, with `inMonth`), the server's local `today`, and every dated `planned_posts` row in that range as a card. Undated drafts are not on the board.
- Card state: `publishing`, `published` and `failed` as stored; `scheduled` when `scheduledAt` is set (armed with Instagram); `draft` for a stored draft; otherwise `plan`, or `missed` once its date has passed.
- A card carries its title, post time (`plannedTime`), script (title and text), caption, reference reel (`sourceVideoId` joined to the video's URL and channel handle) and `missing`: script, caption, reference and time when absent, plus key, quà and offer on every card, because no column stores them yet.
- `lockReason` says why a card cannot change day; it is set for `scheduled`, `publishing`, `published` and `failed`.
- Tháng: one cell per day with a chip per reel (state dot, title, flag when `missing` is not empty). A week label opens that week; a chip opens its day. Tuần: seven columns of cards with state, post time and flag. Ngày: each reel in full, one row per item with "chưa có" for a missing one, and Còn thiếu listing them. The reference reel opens in a browser tab (`openPostInBrowser`).
- Drag in Tuần calls `movePlanCardAction(id, date)` (`src/server/actions/plan-board-actions.ts`). It refuses a card with a `lockReason` and otherwise calls `movePlannedPostAction`, so the board never moves a reel armed with Instagram. A locked card refuses the drag at its start and shows the reason. A day before today is refused by `movePlannedPostAction`.
- An empty day from today on has Thêm reel: a title and an optional time, written by `createPlannedPostAction` as a dated plan.

## Vault board

`VaultBoard` in `src/renderer/src/components/board/VaultBoard.tsx` calls `getVaultBoard` (`src/server/queries/vault-board.ts`). Each row is one connector from `listConnectors` with:

- `state`, one of `running` (chạy), `error` (lỗi), `stale` (cũ), `not-connected` (chưa nối) or `partial` (thiếu). Status not `configured` is `not-connected`. A configured connector with no `pull` is `running`. Otherwise the last pull from `lastPulls()` decides: `failed` is `error`, `partial` is `partial`, `complete` in the current 05:00 slot is `running`, and anything else (no pull yet, skipped, an earlier slot) is `stale`.
- the last pull time, the next 05:00 pull (`nextPullAt`, shown only for a connector that can pull), and for `instagram-graph` the Graph calls left in the rolling hour (200 minus `graphCallsInLastHour`).
- the problem and its fix in plain words (`vaultProblem`): the missing secret labels, the failed pull's detail, what a partial pull missed, or that no complete pull has run since 05:00.

Kiểm tra calls `testConnector` and shows its message under the row. Kéo lại calls `pullAgain` and reloads; it is disabled for a connector with no `pull`. Sửa opens one password field per secret the manifest declares, with "đã lưu · nguồn <source>" or "chưa có" under it. Lưu calls `setConnectorSecret`, clears the field and reloads. No value is ever read back: the status is the secret's source from the row.

## Agents board

`AgentsBoard` in `src/renderer/src/components/board/AgentsBoard.tsx` has two sections, each with its own load state.

- Token MCP: `listMcpTokens`, live tokens first. Tạo calls `createMcpToken(name)` and shows the raw token once, with a copy button (`window.api.ui.writeClipboardText`). Xong drops it from component state, and nothing can show it again. Thu hồi asks to confirm inline, then calls `revokeMcpToken(id)`.
- Nhật ký: `listAgentActions(500)`, the bridge's cap, newest first: time, caller (the token name), tool, gate, result and draft id. `latestPerCall` keeps one row per `callId`, the newest, so a finished call shows its outcome (`ok`, `error`, `drafted`) and its write-ahead `pending` row is hidden. A call with only its pending row shows "chưa xong": it is running, or the app stopped before it finished. Each call writes two rows, so the cap holds about 250 calls. A segmented filter keeps one caller's rows.

## Opening a board

- The tab bar "+" menu (`src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx`) has a Lead Studio group with one item per board. It opens the board in that tab bar's worktree and group.
- The app menu has a top-level Boards menu (`src/main/menu/app-menu-lead-studio.ts`, built in `src/main/menu/register-app-menu.ts`) with one item per board. A click sends `ui:openBoard` with the board id to the main window (`src/main/startup/main-process-i18n-menu.ts`). The preload listener (`src/preload/api/ui-bridge-state-and-menu-commands.ts`) drops any id not in `LEAD_STUDIO_BOARDS`, and the renderer (`src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts`) opens the board in the active worktree's active group.

Both paths call `openBoardTab` in `src/renderer/src/lib/open-board-tab.ts`, which calls the store's `openFile`. `openFile` reuses an open tab with the same path and mode, so a board has at most one tab per worktree.

## Load state

`useBoardLoad` in `src/renderer/src/components/board/use-board-load.ts` owns the call and a `retry`. Hôm nay, Phễu, Kênh tôi, Đối thủ and Kế hoạch read one object, so their load wraps it in a one-row list: Phễu returns no row when no keyword has a number, Kênh tôi none before the channel was ever measured, and Hôm nay, Đối thủ and Kế hoạch always have one (Đối thủ keeps its add form when nothing is tracked). Its state is a union:

- `{ status: 'loading' }`: a spinner.
- `{ status: 'ready', rows }`: the rows. Zero rows is the empty state, a quiet centered message.
- `{ status: 'error', message }`: the message in the destructive color and a Retry button.

`BoardStates` in `src/renderer/src/components/board/BoardStates.tsx` draws the three states, so every board shows them the same way.

## Boundaries

- A board reads only through the engine bridge. It never imports `src/server` code; only the bridge's types cross.
- Hôm nay, Phễu and Kênh tôi are read-only, Đối thủ writes only through `addChannelAction`, and Kế hoạch only through `movePlanCardAction` and `createPlannedPostAction`. Every sum, rate and count they show is computed in `src/server/queries/`; the renderer formats and sorts.
- A board writes only through calls `ENGINE_CALLS` exposes. The Vault board writes secrets (`setConnectorSecret`) and runs pulls; the Agents board creates and revokes tokens.

## Invariants

- A bridge result `{ ok: false, error }` becomes the error state with the bridge's message. A thrown invoke also becomes the error state. A board never shows stale rows as if they were current after a failed load.
- Board tabs are virtual: `isVirtualEditorFile` is true for `mode: 'board'`. They have no path header, no file watcher, no git status and no path context-menu items, and `isMobilePublishableOpenFile` never sends them to a paired phone.
- A funnel gap is never 0: a step with no source, or a post with no keyword, reads "chưa nối", and one with no number reads "chưa có số".
- Kế hoạch never schedules, unschedules or publishes: a reel armed with Instagram keeps its day, and a new reel has no `scheduledAt`.
- The Vault board never holds a stored secret. Its field is `type="password"`, cleared after each save, and every status comes from the secret's source.
- A new MCP token lives only in the Agents board's component state until Xong; `listMcpTokens` never returns a token or its hash.
- A board tab is not restored after a restart. Only `mode: 'edit'` files persist in the workspace session (`src/renderer/src/lib/workspace-session.ts`), as with markdown preview tabs.
- The app menu path does nothing when no worktree is active. This is a known gap: with no project open there is no tab bar to hold the board.

## Verify

`.claude/skills/verify/features/boards.md` runs journeys `today-01`, `own-01`, `rivals-01`, `plan-01`, `vault-01` and `agents-01`; `.claude/skills/verify/features/funnel.md` runs `funnel-01`, which ends on the Phễu board. Cases are in `scripts/e2e/cases/boards.md`.
