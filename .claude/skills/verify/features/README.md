# crowsnest feature map

One file per user-facing feature of the Lead Studio Electron app, driven with `app-drive.sh` (see [app-shell.md](app-shell.md)). Each file names how to get to the feature, the journey that runs it, and what proves it works.

| Feature | Where | Journey | File |
|---|---|---|---|
| Lead Studio app shell: window, terminal, split, MCP, engine bridge, `cn-media:` | Electron app, `pnpm dev` | `app-drive.sh shell-01`, `bridge-01`, `media-01` | [app-shell.md](app-shell.md) |
| Boards: board tab, channels board, load states, new-tab and app menu entries | Electron app, tab bar "+" menu | `app-drive.sh board-01` | [boards.md](boards.md) |
| Funnel and metric ledger: `crowsnest_funnel`, bridge `getFunnel` and `getMetricLedger` | App MCP and engine bridge | `app-drive.sh funnel-01` | [funnel.md](funnel.md) |

The Next.js screens (Tuần này, Feed, Kênh, Khám phá, Cài đặt) are deleted. Boards live in [boards.md](boards.md).
