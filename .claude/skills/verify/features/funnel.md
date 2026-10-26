# Funnel and metric ledger

Every funnel number (views, follows, link in bio taps, keyword comments, DMs, gift page visits, checkouts, purchases, and the rates between them) is defined once in `METRIC_LEDGER` (`src/server/metrics/ledger.ts`). The MCP tool `crowsnest_funnel` and the bridge call `getFunnel` both compute from it, `getMetricLedger` returns the ledger to a board, and `getFunnelBoard` feeds the Funnel board. Architecture: `documents/architecture/boards.md` for the board. Architecture: `documents/architecture/data.md`.

## Sub-features

- `crowsnest_save_funnel`: an agent appends funnel snapshots per keyword.
- `crowsnest_funnel` and bridge `getFunnel`: every ledger metric per keyword, with target and status `value`, `missing` or `not-connected`.
- Bridge `getMetricLedger`: the ledger, read only.
- Funnel board: `funnel-step` (`data-step-id`, `data-status`) with a `kit-bar` and a `kpi-value` (`data-state`), `funnel-rate`, `funnel-keywords` with `funnel-keyword-row` (`data-row-key`), `funnel-coverage-visits`, `funnel-coverage-orders`, one `source-tag` per block, `open-sources` on a not connected step.

## How to get to it (user POV)

Click Funnel in the sidebar, or "+" in the tab bar and Funnel under Lead Studio. Today shows the same totals. An agent reads it over the app's MCP.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh funnel-01 [run-id]
.claude/skills/verify/scripts/mcp.sh --app crowsnest_funnel '{}'
.claude/skills/verify/scripts/app-down.sh
```

`funnel-01` prints `ok: the bridge returns the metric ledger`, `ok: an agent saves funnel rows over MCP`, `ok: MCP and the bridge read the same ledger numbers`, `ok: a metric with no source reads not-connected, never 0`, and saves `funnel-01.png`. It then opens Funnel from "+" and prints `ok: open Funnel from the new-tab menu and see the six steps under one source tag` (DMs match `getFunnelBoard`, the `LEDGER01` row shows), `ok: a step with no source shows Polar not connected with a Sources link, never 0`, `ok: the not connected badge opens Settings > Sources`, and saves `funnel-01-board-dark.png` and `funnel-01-board-light.png`. It reads the MCP port from `data/verify/app/mcp.port`.

## Gotchas

- The journey writes one `reel_funnel` row (keyword `LEDGER01`) to the lane DB. A fresh `app-up.sh --seed` resets it.
- The target check reads the ledger through the bridge and compares, so it holds whatever the targets are. The proof that a changed target reaches both paths is `src/server/metrics/ledger.test.ts`.
