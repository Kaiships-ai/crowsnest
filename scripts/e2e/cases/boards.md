# Boards cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Board tab | Opens a crowsnest board as a tab (`data-testid="board-tab"`) in the workspace | ● | `src/renderer/src/components/board/BoardView.tsx`, `src/renderer/src/lib/open-board-tab.ts` | not restored after restart |
| 2 | Channels board | Lists tracked channels (`data-testid="board-channels-row"`) with handle, display name, followers, median views, 30-day outliers | ● | `src/renderer/src/components/board/ChannelsBoard.tsx` | none |
| 3 | Load states | Loading (`data-testid="board-state-loading"`), empty (`data-testid="board-state-empty"`), error with Retry (`data-testid="board-state-error"`, `data-testid="board-retry"`), Refresh in the ready state (`data-testid="board-refresh"`) | ● | `src/renderer/src/components/board/BoardStates.tsx`, `src/renderer/src/components/board/use-board-load.ts` | none |
| 4 | New-tab menu entry | "+" menu, Lead Studio group, one item per board (`data-testid="new-tab-board"`) | ● | `src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx` | none |
| 5 | App menu entry | Top-level Boards menu, one item per board, sends `ui:openBoard` | ● | `src/main/menu/register-app-menu.ts` | does nothing with no active worktree |
| 6 | Vault board | One row per connector (`data-testid="vault-row"`, `data-connector-id`, `data-state`): state, last pull, next 05:00 pull, Graph calls left, the problem with its fix (`vault-problem`). Kiểm tra (`vault-test`), Kéo lại (`vault-pull`), Sửa (`vault-edit`) | ● | `src/renderer/src/components/board/VaultBoard.tsx`, `src/server/queries/vault-board.ts` | a pull-again outcome is forgotten on restart |
| 7 | Secret entry | Sửa opens one password field per manifest secret (`vault-secret-field`, `vault-secret-input`, `vault-secret-save`), saves through write-only `setConnectorSecret`, shows "đã lưu · nguồn <source>" (`vault-secret-status`) | ● | `src/server/actions/secrets-actions.ts` | no clear button |
| 8 | Agents board | Token MCP: list, Tạo shows the token once with a copy button (`agents-token-create`, `agents-new-token`), Thu hồi with an inline confirm (`agents-revoke`, `agents-revoke-confirm`). Nhật ký: the journal newest first (`agents-journal-row`) with a caller filter (`agents-caller-filter`) | ● | `src/renderer/src/components/board/AgentsBoard.tsx` | shows the newest 200 journal rows only |

## boards: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked. Journey `board-01` runs BOARDS-01 to BOARDS-04 and BOARDS-07, `vault-01` runs VAULT-01 to VAULT-04, and `agents-01` runs AGENTS-01 to AGENTS-04, each on a seeded lane (`app-up.sh --seed`).

| ID | P | Needs | Claim | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- |
| BOARDS-01 | P0 | seed | The "+" menu opens the channels board with the seeded channel | 1. Click "+" in the tab bar.<br>2. Click Channels. | A board tab shows a row for `@e2e_fixture_creator`. | 🟢 `board-01` |
| BOARDS-02 | P1 | seed | Opening the same board again reuses its tab | 1. Open Channels twice from "+". | One board view. | 🟢 `board-01`, and vitest (`open-board-tab.test.ts`) |
| BOARDS-03 | P0 | seed | A failed query shows the error state | 1. Rename the `channels` table in the lane DB.<br>2. Click Refresh. | The error state shows the engine message and a Retry button. | 🟢 `board-01`, and vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-04 | P0 | seed | Retry recovers once the query works | 1. Rename the table back.<br>2. Click Retry. | The rows return. | 🟢 `board-01`, and vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-05 | P2 | empty DB | Zero channels shows the empty state | 1. Open Channels on an empty DB. | "No tracked channels yet." | 🟢 covered by vitest (`ChannelsBoard.test.tsx`) |
| BOARDS-06 | P2 | open project | The app menu opens the board | 1. Boards menu, Channels. | The board opens in the active group. | unit: `src/main/menu/register-app-menu.test.ts` checks the click sends `channels`; the native click is not reachable over CDP |
| BOARDS-07 | P1 | seed | Each value sits under its header | 1. Open Channels from "+". | Each header cell and the row cell in the same position overlap on x. | 🟢 `board-01` |
| VAULT-01 | P0 | seed | The Vault board lists every connector | 1. Click "+" in the tab bar.<br>2. Click Vault. | One row per `listConnectors` entry, in the same order, each with a state. | 🟢 `vault-01` |
| VAULT-02 | P0 | seed | Sửa saves a secret and never shows it | 1. Sửa on Umami.<br>2. Type a value, Lưu. | "đã lưu · nguồn keychain", the field is empty, the value is in no page HTML and no bridge read; the lane DB has a sealed row and no plaintext. | 🟢 `vault-01`, and vitest (`engine-calls.test.ts`, `VaultBoard.test.tsx`) |
| VAULT-03 | P0 | none | A field the manifest does not declare is refused | 1. Call `setConnectorSecret("umami", "IG_GRAPH_TOKEN", v)`. | `{ ok: false, error: "umami has no field IG_GRAPH_TOKEN" }`, nothing stored. | 🟢 `vault-01`, and vitest (`engine-calls.test.ts`) |
| VAULT-04 | P1 | seed | Kiểm tra shows the connection check | 1. Kiểm tra on Umami. | "umami is not connected" under the row. | 🟢 `vault-01` |
| VAULT-05 | P1 | none | State follows the last pull | Run pulls that complete, fail, come back partial, or ran in an earlier slot. | chạy, lỗi, partial, cũ; a newer Kéo lại wins over the slot row. | 🟢 vitest (`vault-board.test.ts`) |
| AGENTS-01 | P0 | seed | An MCP call shows in the journal with its caller | 1. `mcp.sh --app crowsnest_save_funnel`.<br>2. Open Agents from "+". | The newest row is `local crowsnest_save_funnel`. | 🟢 `agents-01` |
| AGENTS-02 | P1 | seed | The caller filter keeps one caller | 1. Click `local` in the filter. | Only `local` rows. | 🟢 `agents-01`, and vitest (`AgentsBoard.test.tsx`) |
| AGENTS-03 | P0 | seed | Tạo shows a token once | 1. Type a name, Tạo.<br>2. Xong. | The token shows with Chép, calls the MCP with 200, and is gone from the page after Xong; `listMcpTokens` never carries it. | 🟢 `agents-01`, and vitest (`AgentsBoard.test.tsx`) |
| AGENTS-04 | P0 | seed | Thu hồi confirms, then the token gets 401 | 1. Thu hồi, then confirm. | Before the confirm the token still works; after it the row is revoked and the MCP answers 401. | 🟢 `agents-01` |
