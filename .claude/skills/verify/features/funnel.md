# Funnel and metric ledger

Every funnel number (views, follows, link in bio taps, keyword comments, DMs, gift page visits, checkouts, purchases, and the rates between them) is defined once in `METRIC_LEDGER` (`src/server/metrics/ledger.ts`). The MCP tool `crowsnest_funnel` and the bridge call `getFunnel` both compute from it, and `getMetricLedger` returns the ledger to a board. Architecture: `documents/architecture/data.md`.

## Sub-features

- `crowsnest_save_funnel`: an agent appends funnel snapshots per keyword.
- `crowsnest_funnel` and bridge `getFunnel`: every ledger metric per keyword, with target and status `value`, `missing` or `not-connected`.
- Bridge `getMetricLedger`: the ledger, read only.

## How to get to it (user POV)

No board shows it yet; the Phễu and Hôm nay boards (W4) will read `getFunnel` and `getMetricLedger`. Today an agent reads it over the app's MCP.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh funnel-01 [run-id]
.claude/skills/verify/scripts/mcp.sh --app crowsnest_funnel '{}'
.claude/skills/verify/scripts/app-down.sh
```

`funnel-01` prints `ok: the bridge returns the metric ledger`, `ok: an agent saves funnel rows over MCP`, `ok: MCP and the bridge read the same ledger numbers`, `ok: a metric with no source reads not-connected, never 0`, and saves `funnel-01.png`. It reads the MCP port from `data/verify/app/mcp.port`.

## Gotchas

- The journey writes one `reel_funnel` row (keyword `LEDGER01`) to the lane DB. A fresh `app-up.sh --seed` resets it.
- The target check reads the ledger through the bridge and compares, so it holds whatever the targets are. The proof that a changed target reaches both paths is `src/server/metrics/ledger.test.ts`.
