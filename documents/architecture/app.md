# App

Lead Studio is crowsnest: one Electron app at the repo root. Its workspace (terminal, chat, browser tab, split panes and the agent table) is a one-time copy of Orca (MIT, Lovecast Inc) under a new identity, and crowsnest's `src/server` runs in its main process. `pnpm dev` opens it; it is not packaged yet. Crowsnest boards open as workspace tabs; see [boards](boards.md).

## What it holds

The app keeps its state in its own user data dir, `~/Library/Application Support/lead-studio` in dev. The single-instance lock, the runtime CLI socket (`o-<pid>-*.sock`) and `mcp.port`, the port of the app's MCP, live there. `mcp.port` is rewritten on every launch and removed on quit.

The app opens the database of the checkout it runs from, `data/crowsnest.db`, directly. `CROWSNEST_DB_PATH` overrides it; verify lanes set it to a copy in the lane's user data dir. `MEDIA_ROOT` points at the checkout's `data/media` unless the environment sets it.

## Crowsnest server in the main process

`startCrowsnest` in `src/main/crowsnest/start.ts` runs after the ready-phase runtime services (`src/main/startup/main-process-ready.ts`). It does not block the window, and a failure only logs `[crowsnest] start failed`. In order, it:

1. sets `CROWSNEST_DB_PATH` and `MEDIA_ROOT` when unset, which `src/server` reads at import time;
2. registers the engine bridge (below), then imports `src/server/start.ts` and calls `startInApp`, which applies the `drizzle/` migrations and starts the jobs;
3. serves the MCP at `http://127.0.0.1:<mcp.port>/api/mcp` (`src/main/crowsnest/mcp-http.ts`) with the 38 `crowsnest_*` tools;
4. serves stored assets on `cn-media://asset/<assetId>` through `src/server/media/serve.ts`, with byte ranges.

The `.mcp.json` entry `lead-studio` runs `scripts/lead-studio-mcp.mjs`, a stdio server that forwards each message to the port in `mcp.port` (`LEAD_STUDIO_USER_DATA` names another user data dir). With no app listening it answers each request with a -32000 "Lead Studio is not running" error, and it deletes a `mcp.port` left by an app that died without its quit hook.

`server.ts` is a headless host for the packaged Kit's LaunchAgent: the same MCP and all three jobs on `PORT`, with no window.

### Engine bridge

The renderer reaches the engine through one IPC channel, `crowsnest:call`, as `window.api.crowsnest.call(name, ...args)`. `ENGINE_CALLS` in `src/server/bridge/engine-calls.ts` is the only list of what it can call. Each entry is keyed by the engine export name and pairs a zod tuple for the arguments with the function. The compiler rejects a tuple the function cannot take. The preload bridge (`src/preload/api/crowsnest-bridge.ts`) holds no list, and the renderer type (`src/preload/api/crowsnest-api.ts`) derives arguments and return values from `ENGINE_CALLS` with type-only imports. To expose another engine function, add one entry to `ENGINE_CALLS`. `getMetricLedger` returns the metric ledger (`src/server/metrics/ledger.ts`) read only, so a board shows each metric's label and target from the same place `getFunnel` computes from.

Every call returns `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. The codes are `unknown_call`, `bad_args`, `failed`, and `untrusted_sender`. `value` is the engine function's own result, so an action that reports its own `{ ok: false }` still arrives as a bridge `ok: true`. The handler in `src/main/crowsnest/engine-ipc.ts` exists before the engine finishes starting. A call made earlier waits until migrations have run, and a call after a failed start gets `failed`.

`ENGINE_CALLS` leaves out anything that writes outside the Mac (publish, DM, Graph POST, ChatbotX) until gate 2 exists, and secret read-back, clear and token rotation. Plan approve and undo are there only as Gate 1's `approvePlanChanges` and `undoPlanApproval`, which record the approver on the version and journal the call as caller `kai` at gate `gate1` (`asOperator`); the bare `approvePlanVersionAction` and `undoPlanVersionAction` stay out. The one secret write it has is the write-only `setConnectorSecret` that Settings > Sources uses (see [connectors](connectors.md)). It leaves out the calls that only the deleted Next screens used.

### How the main build gets `src/server`

The main bundle compiles `src/server` with its pure JS dependencies (drizzle-orm, the MCP SDK, zod, p-queue). `electron.vite.config.ts` maps `@/` to `src/` for main and keeps `better-sqlite3` external. Its binary is N-API, so the same build loads in Node for the tests and in Electron, with no Electron rebuild. `config/tsconfig.node.json` maps `@/*` the same way, so the main typecheck follows the imports into `src/server`; `config/tsconfig.crowsnest.json` checks the rest of `src/server`, `src/lib`, `src/kai-cli` and `scripts/`. In the renderer `@/` is `src/renderer/src`. The web tsconfigs (`config/tsconfig.web.json`, `config/tsconfig.tc.web.json`) also map `@/server/*` and each `src/lib` file the engine imports by exact name, so the bridge's renderer type resolves and a renderer `@/lib` file never shadows one. Only types cross, so no `src/server` code reaches the renderer bundle.

## Identity

| Key | Value | Where |
| --- | --- | --- |
| App id | `ai.kaiships.leadstudio` | `config/electron-builder.config.cjs`, `src/shared/local-build-compatibility-contract.json` |
| Product name and URL scheme | Lead Studio, `leadstudio://` | `config/electron-builder.config.cjs` |
| Dev user data dir | `lead-studio` | `src/main/startup/configure-process.ts`, `src/cli/runtime/launch-user-data-path.ts`, `config/scripts/orca-dev.mjs` |
| App name and keychain item | dev: Lead Studio Dev, `Lead Studio Dev Safe Storage`; packaged: Lead Studio | `src/main/startup/dev-instance-identity.ts` |
| Dev Electron bundle | `ai.kaiships.leadstudio.dev`, Lead Studio Dev | `config/scripts/dev-electron-bundle-identity.mjs` |
| Window title | Lead Studio | `src/renderer/index.html`, `src/main/window/createMainWindow.ts` |
| CLI command | `lead` (packaged, `/usr/local/bin/lead`), `lead-dev` (dev, the shim in `<user data>/cli/bin`) | `package.json`, `src/main/cli/cli-install-constants.ts`, `src/main/runtime/orchestration/cli-command.ts` |
| Home dir | `~/.lead-studio`: agent hook scripts, keybindings, the hook install lock, API key and credential files | `src/main/agent-hooks/installer-utils.ts`, `src/main/agent-hooks/runtime-home-hook-command.ts`, `src/main/keybindings/keybinding-file.ts` |

## Shell

The left sidebar keeps Orca's Search row, then Lead Studio's rows (`LeadStudioNavRows` in `src/renderer/src/components/sidebar/LeadStudioNavRows.tsx`): Today; Insight: Funnel, My channel, Rivals; Create: Plan, Studio; System: Sources, Agents. A board row opens its board in the active workspace and is marked while that board is the active tab. Sources opens Settings > Sources. Studio has no board yet and shows Soon. Below the rows sits Orca's workspace list, titled Workspaces.

Lead Studio drops these Orca surfaces: the Tasks, Automations and Orca Mobile rows and the onboarding checklist entry (`SidebarNav.tsx`), the workspace kanban toggle (`SidebarToolbar.tsx`), the floating terminal button (`AppWorkspaceShell.tsx`), the feature tips Orca opened on its own at launch (`use-onboarding-and-feature-tips.ts`), and the Help menu's Orca links: Send Feedback, Milestones, Docs, Changelog, GitHub, Discord and X (`SidebarSettingsHelpMenu.tsx`). Their code stays; nothing renders them.

Settings lists only the panes a creator needs (`leadStudioSettingsSections` in `src/renderer/src/lib/lead-studio-settings-allowlist.ts`, applied in `useSettingsNavigationMetadata`, so the sidebar, search and Cmd+J agree): Agents, AI Provider Accounts, General, Sources, Terminal, Browser, Appearance, Input & Editing, Notifications, Shortcuts, macOS Permissions, Privacy & Telemetry and Advanced. Run with `VITE_LEAD_STUDIO_ALL_SETTINGS=1` to list every Orca pane. A deep link to a hidden pane still opens it.

The visual system is Orca's: tokens in `src/renderer/src/assets/main.css` and the `ui/` primitives; see `DESIGN.md`.

## Menus and visible names

The app menu has a top-level Boards menu that opens boards ([boards](boards.md)). Menus, window titles, the tray and the titlebar app name say Lead Studio: Explore Lead Studio, Getting Started with Lead Studio, Show Lead Studio Mobile Button, Open Lead Studio, the tray tooltip, the Lead Studio Agent Dashboard and Lead Studio Space Beta windows, and the tray notice. Only the English fallbacks and locale values changed; code identifiers and i18n keys (`menu.exploreOrca`, `tray.openOrca`) still say Orca. Other in-app copy still says Orca.

## Boundaries

- One toolchain: pnpm and node 24 at the root. `scripts/heavy.sh` runs every heavy script one at a time per machine, niced, and exits with the PATH fix when `node` is another major.
- crowsnest's own code (`src/server`, `src/lib`, `src/kai-cli`, `scripts/`) keeps its style: oxlint runs its correctness rules there with Orca's style rules off, the code-quality audits skip it, and oxfmt ignores it. Its tests are the `crowsnest` vitest project in `config/vitest.config.ts`, with its own `@` alias and setup (`src/test/setup-env.ts`), on Node for `better-sqlite3`.
- Lead Studio leaves agent config files alone, such as `~/.claude/settings.json` and `~/.codex/hooks.json`. Agent status hooks default to off (`agentStatusHooksEnabled: false` in `src/shared/default-global-settings.ts`), so startup neither installs nor removes managed hook entries there. With hooks on, its entry would replace Orca.app's, because the matcher in `src/main/agent-hooks/installer-utils.ts` keys on the script name, not its folder. A backlog issue tracks an entry that coexists with Orca.app's; until then, keep hooks off.
- Remote and WSL hosts keep Orca's `~/.orca` layout and the `orca` command there.

## Invariants

- The app reads Instagram: sync and own-channel measurement run unless `LEAD_STUDIO_READ_JOBS=0`, which only a verify lane sets so nothing rewrites its seed. It never auto-publishes until the publish step ships: `startInApp` starts the publish scheduler only with `LEAD_STUDIO_PUBLISH_JOBS=1`. `src/server/start.test.ts` checks both.
- Lead Studio never opens or writes the installed Orca.app profile, lock, socket, keychain item, `~/.orca` or `/usr/local/bin/orca`. Changing a value in the identity table must keep it distinct from Orca's. Lane 2 in `scripts/e2e/cases/app.md` checks that `~/.orca` is unchanged after `pnpm dev`.
- The renderer is untrusted. The bridge answers only the app window (`isTrustedBrowserRenderer`), and `src/main/crowsnest/engine-ipc.test.ts` checks that another window or a webview guest is refused. It parses every argument against its tuple before the engine runs. It never sets, clears or returns a secret. Status reads return `configured` and `source`. A thrown error message, and the `error` of an engine result with `ok: false`, have every stored secret value of 8 or more characters replaced with `[redacted]`. `src/server/bridge/engine-calls.test.ts` checks the parsing, runs every read on fixture rows and checks that none returns a stored secret, and checks that no gated call (publish, the bare approve and undo actions, secret writes, IG login, sidecar) is exposed and that Gate 1's approve records and journals kai.
- Agents in a Lead Studio terminal run `lead-dev`, which reaches this instance through `ORCA_USER_DATA_PATH`. Dev mode is detected by `lead-studio` in that path (`src/cli/handlers/orchestration/runtime-compatibility.ts`). Orca's bundled agent skill guides still say `orca`.

## Verify

The verify skill launches the app with Playwright `_electron.launch` and drives it with journeys. See `.claude/skills/verify/features/app-shell.md` and the cases in `scripts/e2e/cases/app.md`.
