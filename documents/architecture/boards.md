# Boards

A board is a crowsnest screen that opens as a tab in the Lead Studio workspace. The first board is `channels`, a list of the tracked channels.

## What it holds

A board holds no data of its own. Each board reads the engine through the engine bridge (`window.api.crowsnest.call`, see [app](app.md)) every time it mounts, and on Retry or Refresh. The `channels` board calls `getChannelsList` and shows each row's handle, display name, follower count, median views and 30-day outliers.

A board tab is an editor-family open file (`src/renderer/src/store/slices/editor/types/open-file.ts`) with `mode: 'board'` and a `boardId`. Its tab content type stays `editor`. Its `filePath` is the synthetic id `board::<id>`, and its label is the board's label.

## Board registry

`LEAD_STUDIO_BOARDS` in `src/shared/lead-studio-boards.ts` lists every board as `{ id, label }` and defines `BoardId`. Main (the Boards app menu) and the renderer (the new-tab menu) both read this one list. `BOARD_VIEWS` in `src/renderer/src/components/board/BoardView.tsx` is a `Record<BoardId, Component>`, so the compiler rejects a listed board with no view. Adding a board is one entry in the list plus one component in the record.

## Opening a board

- The tab bar "+" menu (`src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx`) has a Lead Studio group with one item per board. It opens the board in that tab bar's worktree and group.
- The app menu has a top-level Boards menu (`src/main/menu/app-menu-lead-studio.ts`, built in `src/main/menu/register-app-menu.ts`) with one item per board. A click sends `ui:openBoard` with the board id to the main window (`src/main/startup/main-process-i18n-menu.ts`). The preload listener (`src/preload/api/ui-bridge-state-and-menu-commands.ts`) drops any id not in `LEAD_STUDIO_BOARDS`, and the renderer (`src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts`) opens the board in the active worktree's active group.

Both paths call `openBoardTab` in `src/renderer/src/lib/open-board-tab.ts`, which calls the store's `openFile`. `openFile` reuses an open tab with the same path and mode, so a board has at most one tab per worktree.

## Load state

`useBoardLoad` in `src/renderer/src/components/board/use-board-load.ts` owns the call and a `retry`. Its state is a union:

- `{ status: 'loading' }`: a spinner.
- `{ status: 'ready', rows }`: the rows. Zero rows is the empty state, a quiet centered message.
- `{ status: 'error', message }`: the message in the destructive color and a Retry button.

`BoardStates` in `src/renderer/src/components/board/BoardStates.tsx` draws the three states, so every board shows them the same way.

## Boundaries

- A board reads only through the engine bridge. It never imports `src/server` code; only the bridge's types cross.
- A board writes nothing. Write actions come later, through calls `ENGINE_CALLS` exposes.

## Invariants

- A bridge result `{ ok: false, error }` becomes the error state with the bridge's message. A thrown invoke also becomes the error state. A board never shows stale rows as if they were current after a failed load.
- Board tabs are virtual: `isVirtualEditorFile` is true for `mode: 'board'`. They have no path header, no file watcher, no git status and no path context-menu items, and `isMobilePublishableOpenFile` never sends them to a paired phone.
- A board tab is not restored after a restart. Only `mode: 'edit'` files persist in the workspace session (`src/renderer/src/lib/workspace-session.ts`), as with markdown preview tabs.
- The app menu path does nothing when no worktree is active. This is a known gap: with no project open there is no tab bar to hold the board.

## Verify

`.claude/skills/verify/features/boards.md` runs journey `board-01`. Cases are in `scripts/e2e/cases/boards.md`.
