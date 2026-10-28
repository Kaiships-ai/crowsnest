# Boards

A board is a crowsnest screen that opens as a tab in the Lead Studio workspace. There are eight: `today` (Today, the morning screen), `funnel` (Funnel, the six-step funnel), `own` (My channel, the own Instagram channel), `rivals` (Rivals, the tracked rival channels), `plan` (Plan, the planned reels by month, week and day), `gate` (Gate 1, approve a proposed plan), `gate2` (Gate 2, approve an action that reaches people outside) and `agents` (the MCP journal and the agent tokens). Each connector's state and key live in Settings > Sources (see [connectors](connectors.md)), not on a board. All board copy is English through `translate()` keys; the `en` catalogs hold the English text.

## What it holds

A board holds no data of its own. Each board reads the engine through the engine bridge (`window.api.crowsnest.call`, see [app](app.md)) every time it mounts, and on Retry or Refresh. Table headers and rows are subgrids of one grid, so each value sits in the same column as its header.

A board tab is an editor-family open file (`src/renderer/src/store/slices/editor/types/open-file.ts`) with `mode: 'board'` and a `boardId`. Its tab content type stays `editor`. Its `filePath` is the synthetic id `board::<id>`, and its label is the board's label.

## Board registry

`LEAD_STUDIO_BOARDS` in `src/shared/lead-studio-boards.ts` lists every board as `{ id, label }` and defines `BoardId`. Main (the Boards app menu) and the renderer (the new-tab menu) both read this one list. The sidebar rows (`src/renderer/src/components/sidebar/LeadStudioNavRows.tsx`) open the same boards. A board tab lives in a workspace, so with no workspace active (a first launch) `openBoardInActiveWorkspace` in `src/renderer/src/lib/open-board-tab.ts` opens the "Lead Studio" folder workspace first: the engine call `ensureLeadStudioWorkspaceDir` creates `Lead Studio/` next to the app's database (`CROWSNEST_DB_PATH`), the renderer adds it once as a folder project with `addRepoPath` and activates it without seeding a terminal, and the board opens there. `BOARD_VIEWS` in `src/renderer/src/components/board/BoardView.tsx` is a `Record<BoardId, Component>`, so the compiler rejects a listed board with no view. Adding a board is one entry in the list plus one component in the record.

## Board kit

`src/renderer/src/components/board/kit/` holds the pieces every board shares, built on Orca's tokens and `ui/` primitives:

- `Kpi.tsx`: `KpiValue` and `KpiTile` draw a number in one of five states (`KpiState`): `value`, `partial` (missing N keywords, or missing N posts on My channel), `not-connected` (a badge that opens Settings > Sources), `pull-failed` or `pull-partial` (the newest pull of the step's source did not complete; an older number stays, muted), and `no-data`. The number slot keeps its size and the state is a small badge under it; on a narrow tile a long state ends in an ellipsis, with the full text as the badge title. `kpiFromStep` maps a funnel step to its state.
- `SourceTag.tsx`: `SourceTag` names a block's sources and its oldest pull time once; `BlockHeader` is a block title with that tag.
- `StatePill.tsx`: a connector state in Orca's Integrations tones and words (`SOURCE_STATE`): Connected, Partial, Error, Not configured.
- `Bars.tsx`: one bar, on a log scale by default so the last funnel steps stay visible next to views, or linear for shares of a whole (`scale="linear"`).
- `LineChart.tsx`: a small line over time, one polyline like Orca's status-bar sparkline, with the peak above it and the first and last time under it.
- `DataTable.tsx`: a table with a mono header row and right-aligned number columns. `rowData` puts `data-*` attributes on each row for journeys and tests.

## Funnel board

`FunnelBoard` in `src/renderer/src/components/board/FunnelBoard.tsx` calls `getFunnelBoard` (`src/server/queries/funnel-board.ts`), which reads `getFunnel` and computes everything the board shows, so the renderer only formats:

- One row per step of `FUNNEL_STEPS`: label, a bar, the total as a `KpiValue`, the rate and the target. The total sums the step's value over every keyword. Its time is the oldest `capturedAt` among the summed values, and `keywordsWithoutNumber` counts the keywords with no number while others have one, shown as "missing N keywords" because the total is then a floor. `pull` is `failed` or `partial` when the newest pull of the step's connector did not complete (`withPulls`, from `getVaultBoard`; Instagram steps read `instagram-graph`), shown as "<source> pull failed" beside the number. The rate into the step is the ledger rate over only the keywords that have both the step's number and the step before's (`matchedRate`, then `ratio` in `src/server/services/funnel.ts`), so a keyword with visits but no DMs never inflates the visit rate; the totals still count every keyword. The rate carries the ledger target or "no target set".
- By keyword, a `DataTable`: one row per keyword with each step's number, the plan's title, or "no reel".
- Coverage (`tied / total`): visits are the gift-page visits under a keyword a planned post holds over every clean `/get/` pageview in `umami_days`, tagged or not (`visitCoverage`), so an untagged visit lowers it; missing until Umami has stored a day. Orders are the orders under a planned keyword over all orders stored per keyword.

Each block names its sources and oldest pull time once (`StepsSourceTag`). A gap is never 0: it reads "no data yet" (the source is connected but has no number) or "<source> not connected" with a link to Settings > Sources (`openLeadSourcesSettings`). The board is empty until some keyword has a number.

## Today board

`TodayBoard` in `src/renderer/src/components/board/TodayBoard.tsx` calls `getTodayBoard` (`src/server/queries/today-board.ts`), one aggregate read, and fits one screen with no scroll. Every block names its source and time.

- People reaching the offer: the checkout and purchase totals as `KpiTile`s, then Funnel, the six steps from `getFunnelBoard` as tiles. Each tile shows its state as on Funnel, including a failed newest pull.
- The biggest drop (`biggestDrop`), boxed beside the offer: the step whose rate sits furthest below its target, as rate / target. With no target set it says so; with targets but no rate it says so.
- Waiting for your approval, counts only: Gate 1 is proposed `plan_versions` newer than their period's live version (an older proposed version that a newer live one passed is not waiting), and its label opens the Gate 1 board; Gate 2 is pending `gate_drafts`, and its label opens the Gate 2 board. Gate 2 has no sidebar row: Today is its entry.
- Ran overnight: each connector's last pull time and its state as a `StatePill`, from `getVaultBoard`. A partial pull reads Partial, never Connected.
- Running workspaces: workspaces with an agent working, blocked or waiting, read in the renderer from the agent status store (`runningWorkspaces`), since the engine does not know panes.

## My channel board

`OwnBoard` in `src/renderer/src/components/board/OwnBoard.tsx` calls `getOwnBoard(7 | 30)` (`src/server/queries/own-board.ts`) and has the tabs of Instagram's own dashboard. The 7 days and 30 days buttons pick the window, which is the posts posted in it.

- Every Instagram number is a reading from the post's newest successful `own_post_insights` capture, with that capture's time. A window total sums the posts that have the number, takes the oldest time, and shows "missing N posts" when some posts in the window lack it.
- Overview: an Instagram block (views of the window's posts, followers from the newest `own_account_snapshots` row, and net followers against the newest snapshot at or before the window start, missing when there is none) as `KpiTile`s, and views by post date as a `LineChart`, one point per day of the window, summing the views of the posts that went up that day (a day with no post reads 0; posts with no views number are counted as missing above the line). Below, After the reel: DMs, Site and Orders summed over the window's posts.
- Performance: views, likes, comments, shares and saves as tiles; views per content type (`format`) as linear bars; profile visits, bio link taps and follows.
- Content: a `DataTable`, one row per post with views, likes, comments, shares and saves, then DMs (ChatbotX), Site (Umami gift-page visits) and Orders (Polar orders). Sorting is by date or by any column.
- Audience: the follower split and the engaged audience by gender, age and country from `getAccountBreakdowns` (the newest batch per metric) as linear bars, with the stored refusal or failure when Instagram gave none. These are account numbers, not per window.

Each block names its sources and oldest pull time once with a `SourceTag`; a total that lacks some posts' numbers is a `partial` Kpi ("missing N posts"), and every per-post total is `pull-failed` while any post in the window has a failed newest pull, because that post still adds its last good numbers (the views line says how many posts kept old numbers); account numbers (followers, net follows) are not marked. `kpiFromReading` maps the states in `src/renderer/src/components/board/own-reading.tsx`. The panels live in `src/renderer/src/components/board/OwnPanels.tsx` and the Content table in `src/renderer/src/components/board/OwnContentTable.tsx`.

DMs, Site and Orders come from the metric ledger through `getFunnel`: a post's keyword is the keyword of the plan whose reel is that post (a hand-marked `published_own_post_id`, or the `published_media_id` publish stored, matched on `own_posts.external_id`), and its readings are that keyword's `dm`, `gift_page_visit` and `purchase`. A post no plan with a keyword was published as reads `no-keyword`, shown as "not connected", never 0. Reach has no window total: Instagram counts reach as unique accounts per post, so a sum would count one person once per post; reach shows per post only. A post whose newest pull failed after its last good one (`pullError`, from the newest failed `own_post_insights` row) keeps the older numbers and is marked on its Content row and in the reel view. The views tile is the sum of the window's posts' own views, not Instagram's account views for the period, which no stored row holds.

A post row opens `OwnReelDetail` (`src/renderer/src/components/board/OwnReelDetail.tsx`), which calls `getOwnReelBoard(ownPostId)`: Overview (views, reach, reach against the channel median, average watch time, skip rate and follows as tiles, and the views of each capture as a `LineChart`), Engagement (likes, comments, shares, saves, reposts, bio link taps), and After the reel. A reel whose newest pull failed shows its tiles as `pull-failed`. After the reel is `funnelSteps` over the one funnel entry for the reel's keyword, the same six steps and ledger rates as Funnel, each a bar and a `KpiValue`, with the sources and pull time once; a step with no connector reads "<source> not connected". A reel with no keyword says so instead. Open original post opens the permalink in a workspace browser tab (`openPostInBrowser` in `src/renderer/src/components/board/open-post.ts`).

## Rivals board

`RivalsBoard` in `src/renderer/src/components/board/RivalsBoard.tsx` calls `getRivalsBoard` (`src/server/queries/rivals-board.ts`):

- Evidence from analyzed posts: the 24 newest `video_analyses` rows on rival posts, filed in three columns by the row's `tag`: Take (`take`, moves worth copying), Learn (`learn`, lessons to adapt) and Avoid (`avoid`, mistakes to steer clear of). Rows with no tag sit in a fourth group, Not sorted, shown only when it has cards. Each card has the channel, score, views, hook type, why it worked, tags, the analysis time, and Open original post, which opens the post in a workspace browser tab (`openPostInBrowser`, Orca's `createBrowserTab`). The cards are in `src/renderer/src/components/board/RivalsEvidence.tsx`.
- The tag comes from the agent: `crowsnest_save_analysis` takes an optional `tag` (`take`, `learn` or `avoid`, `RivalTagSchema` in `src/server/schemas.ts`) and stores it on the row. A re-save without a tag keeps the earlier one.
- Outliers, last 30 days: a `DataTable` of every rival's top 3 outliers from `getOutlierFeed` (score 2 or more), best first, each opening the original post.
- Channels you follow: a `DataTable` of every tracked channel that is not the own one, from `getChannelsList`, with followers, median views, outliers of the last 30 days, the last read and the sync error.
- Add rival calls `addChannelAction(handle, { requireProfile: true })`: the sidecar must resolve the profile before a row is written, so a typo is refused with its reason and nothing is stored. On success the board reloads and the new channel shows with no numbers until a sync reads it.

## Plan board

`PlanBoard` in `src/renderer/src/components/board/PlanBoard.tsx` calls `getPlanBoard(month)` (`src/server/queries/plan-board.ts`) once per month and draws three views from that one result, so a change shows in all of them after the reload that follows it.

- `getPlanBoard` returns the whole Monday-to-Sunday weeks covering the month (`gridDays`, each with `inMonth`), the server's local `today`, and every dated `planned_posts` row in that range as a card. Undated drafts are not on the board.
- Card state: `publishing`, `published` and `failed` as stored; `scheduled` when `scheduledAt` is set (armed with Instagram); `cooking` when Cook opened a workspace for it (`cook_workspace_id`); `draft` for a stored draft; otherwise `plan`, or `missed` once its date has passed.
- A card carries its title, post time (`plannedTime`), script (title and text), caption, reference reel (`sourceVideoId` joined to the video's URL and channel handle) and `missing`: script, caption, reference and time when absent, plus key, gift and offer on every card, because no column stores them yet.
- `lockReason` says why a card cannot change day; it is set for `scheduled`, `publishing`, `published` and `failed`.
- Month: one cell per day with a chip per reel (state dot, one-line title, flag when `missing` is not empty); hovering a chip shows its full title and state in a tooltip. A week label opens that week; a chip opens its day. Week: seven columns of cards with state, post time and flag. Day: each reel in full, one row per item with "not yet" for a missing one, and the missing items listed. The reference reel opens in a browser tab (`openPostInBrowser`).
- Drag in Week calls `movePlanCardAction(id, date)` (`src/server/actions/plan-board-actions.ts`). It refuses a card with a `lockReason` and otherwise calls `movePlannedPostAction`, so the board never moves a reel armed with Instagram. A locked card refuses the drag at its start and shows the reason. A day before today is refused by `movePlannedPostAction`.
- An empty day from today on has Add reel: a title and an optional time, written by `createPlannedPostAction` as a dated plan.
- Day shows each missing item as an attention `StatePill` from the board kit. Lock reasons and move errors come from the server in English.

### Cook

A Day card in `draft`, `plan` or `missed` with a script has Cook (B5-01). `cookReel` in `src/renderer/src/components/board/cook-reel.ts`:

1. `cookPlanCardAction(id)` (`src/server/actions/cook-actions.ts`) writes the script to `workspace/scripts/<slug>.md` in studio-reel, in the format studio-reel's workspace README gives (front matter with slug, target seconds and CTA keyword, the title, `## Script`). The slug is the title plus the last six characters of the id, in ASCII lower case with dashes, so two reels never share a file. It refuses a reel already cooking (`COOK_ALREADY`), one not in `draft`, `plan` or `missed` (`COOK_LOCKED`), one with no script, and a missing studio-reel (`COOK_NO_STUDIO`). studio-reel is `LEAD_STUDIO_COOK_ROOT`, by default `~/Desktop/kaiships/studio-reel`; under a verify lane (`ORCA_E2E_USER_DATA_DIR` set) there is no default, so a lane never writes into the real checkout.
2. It finds or creates the project group "Studio Reel" and reuses the folder workspace named `Reel: <title>` on studio-reel's folder, or creates it.
3. Only then `markPlanCookingAction(id, workspaceId)` stores the workspace on `planned_posts.cook_workspace_id`, and only while it is empty, so a second window or a stale board cannot cook the same reel twice. The card reads Cooking and its Open workspace button activates that workspace.
4. It activates the workspace and calls Orca's `launchAgentInNewTab` with Claude, `initialCwd` studio-reel and the prompt `/make-reel workspace/scripts/<slug>.md` with `promptDelivery: 'submit-after-ready'`, so the prompt is typed once Claude's TUI is ready. If the launch fails, or the prompt is never delivered, `clearPlanCookingAction` rolls Cooking back and the card offers Retry cook. Lead Studio shows no progress of its own; the terminal is the progress.

## Gate 1 board

`GateBoard` in `src/renderer/src/components/board/GateBoard.tsx` calls `getGateBoard` (`src/server/queries/gate-board.ts`):

- `proposal`: the newest proposed `plan_versions` row ahead of its period's live version, the live version, and `changes`, from `planChanges(live, proposed)` in `src/server/services/plan-versions.ts`. The diff is always against the live version, never the previous version: one change per reel key, `add`, `remove` or `edit` (any of title, date, time, keyword or note differs), in plan order. A reel's `note` is the reason shown beside it.
- `lastApproval`: the newest live version with its approval time and approver, and whether an earlier approved version exists to undo to.

The board shows the change list, each with a switch, above Orca's `DiffViewer` side by side: the live plan on the left and the live plan with the switched-on changes on the right, one line per reel. Monaco shows an edited line as a removal plus an addition, so the board passes the edited reels' line numbers as `markedLines` and they are painted with `--diff-modified-ground` (yellow). The Approve button counts the switched-on changes.

Approve calls `approvePlanChanges(versionId, keys)`. With every change on, the proposal itself goes live. With some off, a new version made of the live plan plus the kept changes is proposed under the approver's name and goes live, and the proposal stays behind it. Undo calls `undoPlanApproval(ref, liveId)`, which restores the version live before and refuses if another version went live since. Both bridge calls record `approved_by` on the version and journal the call as caller `kai` at gate `gate1` (`asOperator` in `src/server/bridge/engine-calls.ts`). The board is empty when nothing waits and nothing was approved.

## Gate 2 board

`Gate2Board` in `src/renderer/src/components/board/Gate2Board.tsx` calls `getGate2Board` (`src/server/services/gate2-drafts.ts`): every `pending` draft, newest first, then the last 10 decided ones. A `publish_reel` draft shows what it does (publish right after approval, or at a local time), to whom (Instagram and the own channel's handle), the cover from the media store (`cn-media://asset/<id>`), and the five checks recomputed from the draft's input. Approve calls `approveGateDraft(id)` and Reject `rejectGateDraft(id)`; both journal caller `kai` at gate `gate2` with the draft id. Approve is disabled while a check is missing or the reel changed since the draft (stale). A failed run puts the draft back in the list with the error. The decided list shows who proposed, who approved or rejected, and when (wireframe B6-06). A draft of another tool shows its raw input and cannot be approved.

## Publish sheet

On the Plan day view, a reel with a video in draft, plan, missed, cooking or failed shows Publish (`PublishButton` in `src/renderer/src/components/board/PublishSheet.tsx`). The sheet asks for a time (a local `datetime-local`, or right after approval), shows the five checks from `getPublishChecks(id, at)` (wireframe B6-01), and Send to Gate 2 calls `draftPublish(id, at)`. Nothing is published from the sheet.

## Agents board

`AgentsBoard` in `src/renderer/src/components/board/AgentsBoard.tsx` has two sections, each a `DataTable` with its own load state.

- Journal: `listAgentActions(500)`, the bridge's cap, newest first. `groupByCall` makes one row per `callId`: the newest row's result, so a finished call shows its outcome (`ok`, `error`, `drafted`) and its write-ahead `pending` row is hidden, timed from its oldest row (Time is when the call started, Took is outcome minus start). A call with only its pending row shows "pending": it is running, or the app stopped before it finished. Each call writes two rows, so the cap holds about 250 calls. A segmented filter keeps one caller's rows.
- MCP tokens: `listMcpTokens`, live tokens first. Create calls `createMcpToken(name)` and shows the raw token once, with a copy button (`window.api.ui.writeClipboardText`). Done drops it from component state, and nothing can show it again. Revoke asks to confirm inline, then calls `revokeMcpToken(id)`.

## Opening a board

- The tab bar "+" menu (`src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx`) has a Lead Studio group with one item per board. It opens the board in that tab bar's worktree and group.
- The app menu has a top-level Boards menu (`src/main/menu/app-menu-lead-studio.ts`, built in `src/main/menu/register-app-menu.ts`) with one item per board. A click sends `ui:openBoard` with the board id to the main window (`src/main/startup/main-process-i18n-menu.ts`). The preload listener (`src/preload/api/ui-bridge-state-and-menu-commands.ts`) drops any id not in `LEAD_STUDIO_BOARDS`, and the renderer (`src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts`) opens the board in the active worktree's active group, or in the "Lead Studio" folder workspace when none is active, as the sidebar rows do.

Both paths call `openBoardTab` in `src/renderer/src/lib/open-board-tab.ts`, which calls the store's `openFile`. `openFile` reuses an open tab with the same path and mode, so a board has at most one tab per worktree.

## Load state

`useBoardLoad` in `src/renderer/src/components/board/use-board-load.ts` owns the call and a `retry`. Today, Funnel, My channel, Rivals, Plan, Gate 1 and Gate 2 read one object, so their load wraps it in a one-row list: Funnel returns no row when no keyword has a number, My channel none before the channel was ever measured, Gate 1 none when no plan was proposed or approved, Gate 2 none when no draft exists, and Today, Rivals and Plan always have one (Rivals keeps its add form when nothing is tracked). Its state is a union:

- `{ status: 'loading' }`: a spinner.
- `{ status: 'ready', rows }`: the rows. Zero rows is the empty state, a quiet centered message.
- `{ status: 'error', message }`: the message in the destructive color and a Retry button.

`BoardStates` in `src/renderer/src/components/board/BoardStates.tsx` draws the three states, so every board shows them the same way.

## Boundaries

- A board reads only through the engine bridge. It never imports `src/server` code; only the bridge's types cross.
- Today, Funnel and My channel are read-only, Rivals writes only through `addChannelAction`, Plan only through `movePlanCardAction`, `createPlannedPostAction`, `cookPlanCardAction`, `markPlanCookingAction`, `clearPlanCookingAction` and `draftPublish`, Gate 1 only through `approvePlanChanges` and `undoPlanApproval`, and Gate 2 only through `approveGateDraft` and `rejectGateDraft`. Every sum, rate and count they show is computed in `src/server/queries/`; the renderer formats and sorts.
- A board writes only through calls `ENGINE_CALLS` exposes. The Agents board creates and revokes tokens.

## Invariants

- A bridge result `{ ok: false, error }` becomes the error state with the bridge's message. A thrown invoke also becomes the error state. A board never shows stale rows as if they were current after a failed load.
- Board tabs are virtual: `isVirtualEditorFile` is true for `mode: 'board'`. They have no path header, no file watcher, no git status and no path context-menu items, and `isMobilePublishableOpenFile` never sends them to a paired phone.
- A funnel gap is never 0: a step with no source reads "<source> not connected", one with no number reads "no data yet", and a total over only some keywords reads "missing N keywords".
- A number whose source's newest pull failed or was partial is marked where it shows.
- Plan never schedules, unschedules or publishes: a reel armed with Instagram keeps its day, a new reel has no `scheduledAt`, and Publish only stores a Gate 2 draft.
- Gate 2 is the only path to publish from the app, and it records who proposed and who approved.
- Gate 1 diffs against the live version and records who approved.
- A new MCP token lives only in the Agents board's component state until Done; `listMcpTokens` never returns a token or its hash.
- A board tab is not restored after a restart. Only `mode: 'edit'` files persist in the workspace session (`src/renderer/src/lib/workspace-session.ts`), as with markdown preview tabs.
- The app menu path does nothing when no worktree is active. This is a known gap: with no project open there is no tab bar to hold the board.

## Verify

`.claude/skills/verify/features/boards.md` runs journeys `today-01`, `own-01`, `rivals-01`, `plan-01`, `cook-01` and `agents-01`, and `.claude/skills/verify/features/baseline.md` runs `baseline-v2`, which shoots every v2 screen; `.claude/skills/verify/features/funnel.md` runs `funnel-01`, which ends on the Funnel board. Cases are in `scripts/e2e/cases/boards.md`.
