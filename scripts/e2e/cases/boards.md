# Boards cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Board tab | Opens a crowsnest board as a tab (`data-testid="board-tab"`) in the workspace | ● | `src/renderer/src/components/board/BoardView.tsx`, `src/renderer/src/lib/open-board-tab.ts` | not restored after restart |
| 2 | Channels board | Lists tracked channels (`data-testid="board-channels-row"`) with handle, display name, followers, median views, 30-day outliers | ● | `src/renderer/src/components/board/ChannelsBoard.tsx` | none |
| 3 | Load states | Loading (`data-testid="board-state-loading"`), empty (`data-testid="board-state-empty"`), error with Retry (`data-testid="board-state-error"`, `data-testid="board-retry"`), Refresh in the ready state (`data-testid="board-refresh"`) | ● | `src/renderer/src/components/board/BoardStates.tsx`, `src/renderer/src/components/board/use-board-load.ts` | none |
| 4 | New-tab menu entry | "+" menu, Lead Studio group, one item per board (`data-testid="new-tab-board"`) | ● | `src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx` | none |
| 5 | App menu entry | Top-level Lead Studio menu, one item per board, sends `ui:openBoard` | ● | `src/main/menu/register-app-menu.ts` | does nothing with no active worktree |

## boards: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked. Journey `board-01` runs BOARDS-01 to BOARDS-04 on a seeded lane (`app-up.sh --seed`).

| ID | P | Needs | Claim | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- |
| BOARDS-01 | P0 | seed | The "+" menu opens the channels board with the seeded channel | 1. Click "+" in the tab bar.<br>2. Click Channels. | A board tab shows a row for `@e2e_fixture_creator`. | not run |
| BOARDS-02 | P1 | seed | Opening the same board again reuses its tab | 1. Open Channels twice from "+". | One board view. | 🟢 covered by vitest (`open-board-tab.test.ts`) |
| BOARDS-03 | P0 | seed | A failed query shows the error state | 1. Rename the `channels` table in the lane DB.<br>2. Click Refresh. | The error state shows the engine message and a Retry button. | 🟢 component covered by vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-04 | P0 | seed | Retry recovers once the query works | 1. Rename the table back.<br>2. Click Retry. | The rows return. | 🟢 component covered by vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-05 | P2 | empty DB | Zero channels shows the empty state | 1. Open Channels on an empty DB. | "No tracked channels yet." | 🟢 covered by vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-06 | P2 | open project | The app menu opens the board | 1. Lead Studio menu, Channels. | The board opens in the active group. | not run: a native menu click is not reachable over CDP |
