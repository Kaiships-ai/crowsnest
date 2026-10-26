# Funnel and metric ledger

Every funnel number (views, follows, link in bio taps, keyword comments, DMs, gift page visits, checkouts, purchases, and the rates between them) is defined once in `METRIC_LEDGER` (`src/server/metrics/ledger.ts`). The MCP tool `crowsnest_funnel` and the bridge call `getFunnel` both compute from it, `getMetricLedger` returns the ledger to a board, and `getFunnelBoard` feeds the Phễu board. Architecture: `documents/architecture/boards.md` for the board. Architecture: `documents/architecture/data.md`.

## Sub-features

- `crowsnest_save_funnel`: an agent appends funnel snapshots per keyword.
- `crowsnest_funnel` and bridge `getFunnel`: every ledger metric per keyword, with target and status `value`, `missing` or `not-connected`.
- Bridge `getMetricLedger`: the ledger, read only.
- Phễu board: `funnel-step` (`data-step-id`, `data-status`), `funnel-rate`, `funnel-keyword-row` (`data-keyword`), `funnel-coverage-visits`, `funnel-coverage-orders`, `source-label`, `reading-not-connected`, `open-vault`.

## How to get to it (user POV)

Open a project, click "+" in the tab bar, then Phễu under Lead Studio. Hôm nay shows the same totals. An agent reads it over the app's MCP.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh funnel-01 [run-id]
.claude/skills/verify/scripts/mcp.sh --app crowsnest_funnel '{}'
.claude/skills/verify/scripts/app-down.sh
```

`funnel-01` prints `ok: the bridge returns the metric ledger`, `ok: an agent saves funnel rows over MCP`, `ok: MCP and the bridge read the same ledger numbers`, `ok: a metric with no source reads not-connected, never 0`, and saves `funnel-01.png`. It then opens Phễu from "+" and prints `ok: open Phễu from the new-tab menu and see the six steps, each with its source` (DMs match `getFunnelBoard`, the `LEDGER01` row shows), `ok: a step with no source shows chưa nối and a Vault link, never 0`, `ok: the Vault link opens the Vault board`, and saves `funnel-01-board-dark.png` and `funnel-01-board-light.png`. It reads the MCP port from `data/verify/app/mcp.port`.

## Gotchas

- The journey writes one `reel_funnel` row (keyword `LEDGER01`) to the lane DB. A fresh `app-up.sh --seed` resets it.
- The target check reads the ledger through the bridge and compares, so it holds whatever the targets are. The proof that a changed target reaches both paths is `src/server/metrics/ledger.test.ts`.
