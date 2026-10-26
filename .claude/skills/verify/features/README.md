# crowsnest feature map

One file per user-facing feature of the Lead Studio Electron app, driven with `app-drive.sh` (see [app-shell.md](app-shell.md)). Each file names how to get to the feature, the journey that runs it, and what proves it works.

| Feature | Where | Journey | File |
|---|---|---|---|
| Lead Studio app shell: window, terminal, split, MCP, engine bridge, `cn-media:` | Electron app, `pnpm dev` | `app-drive.sh shell-01`, `bridge-01`, `media-01` | [app-shell.md](app-shell.md) |
| Boards: board tab, Hôm nay, Kênh tôi (with Sau reel), Đối thủ (with add channel), Vault (connector state, Sửa secret entry) and Agents (journal, tokens) boards, load states, new-tab and app menu entries | Electron app, tab bar "+" menu | `app-drive.sh own-01`, `rivals-01`, `today-01`, `vault-01`, `agents-01` | [boards.md](boards.md) |
| Funnel and metric ledger: `crowsnest_funnel`, bridge `getFunnel`, `getMetricLedger` and `getFunnelBoard`, the Phễu board | App MCP, engine bridge, Electron app | `app-drive.sh funnel-01` | [funnel.md](funnel.md) |
| Connectors and keychain secrets: bridge `listConnectors`, `testConnector`, boot migration | Engine bridge | `app-drive.sh connectors-01` | [connectors.md](connectors.md) |
| Gate levels and agent journal: `TOOL_LEVELS`, `agent_actions`, bridge `listAgentActions` | App MCP and engine bridge | `app-drive.sh gates-01` | [gates.md](gates.md) |
| MCP agent tokens: bearer check, `local` token file, bridge `listMcpTokens`, `createMcpToken`, `revokeMcpToken` | App MCP and engine bridge | `app-drive.sh tokens-01` | [tokens.md](tokens.md) |
| Daily pull and Graph hour budget: the 05:00 pull, catch-up, bridge `pullAgain` | Main process jobs, engine bridge | `schedule-lane.sh` (runs `schedule-01`) | [schedule.md](schedule.md) |

The Next.js screens (Tuần này, Feed, Kênh, Khám phá, Cài đặt) are deleted. Boards live in [boards.md](boards.md).
