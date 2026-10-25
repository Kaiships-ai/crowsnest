# App

Lead Studio is crowsnest: one Electron app at the repo root. Its workspace (terminal, chat, browser tab, split panes and the agent table) is a one-time copy of Orca (MIT, Lovecast Inc) under a new identity, and crowsnest's `src/server` runs in its main process. `pnpm dev` opens it; it is not packaged yet. Crowsnest boards are built into it step by step.

## What it holds

The app keeps its state in its own user data dir, `~/Library/Application Support/lead-studio` in dev. The single-instance lock, the runtime CLI socket (`o-<pid>-*.sock`) and `mcp.port`, the port of the app's MCP, live there. `mcp.port` is rewritten on every launch and removed on quit.

The app opens the database of the checkout it runs from, `data/crowsnest.db`, directly. `CROWSNEST_DB_PATH` overrides it; verify lanes set it to a copy in the lane's user data dir. `MEDIA_ROOT` points at the checkout's `data/media` unless the environment sets it.

## Crowsnest server in the main process

`startCrowsnest` in `src/main/crowsnest/start.ts` runs after the ready-phase runtime services (`src/main/startup/main-process-ready.ts`). It does not block the window, and a failure only logs `[crowsnest] start failed`. In order, it:

1. sets `CROWSNEST_DB_PATH` and `MEDIA_ROOT` when unset, which `src/server` reads at import time;
2. imports `src/server/start.ts` and calls `startInApp`, which applies the `drizzle/` migrations and starts the jobs;
3. serves the MCP at `http://127.0.0.1:<mcp.port>/api/mcp` (`src/main/crowsnest/mcp-http.ts`) with the 38 `crowsnest_*` tools;
4. serves stored assets on `cn-media://asset/<assetId>` through `src/server/media/serve.ts`, with byte ranges.

The `.mcp.json` entry `lead-studio` runs `scripts/lead-studio-mcp.mjs`, a stdio server that forwards each message to the port in `mcp.port` (`LEAD_STUDIO_USER_DATA` names another user data dir). With no app listening it answers each request with a -32000 "Lead Studio is not running" error, and it deletes a `mcp.port` left by an app that died without its quit hook.

`server.ts` is a headless host for the packaged Kit's LaunchAgent: the same MCP and all three jobs on `PORT`, with no window.

### How the main build gets `src/server`

The main bundle compiles `src/server` with its pure JS dependencies (drizzle-orm, the MCP SDK, zod, p-queue). `electron.vite.config.ts` maps `@/` to `src/` for main and keeps `better-sqlite3` external. Its binary is N-API, so the same build loads in Node for the tests and in Electron, with no Electron rebuild. `config/tsconfig.node.json` maps `@/*` the same way, so the main typecheck follows the imports into `src/server`; `config/tsconfig.crowsnest.json` checks the rest of `src/server`, `src/lib`, `src/kai-cli` and `scripts/`. In the renderer `@/` is `src/renderer/src`.

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

## Boundaries

- One toolchain: pnpm and node 24 at the root. `scripts/heavy.sh` runs every heavy script one at a time per machine, niced, and exits with the PATH fix when `node` is another major.
- crowsnest's own code (`src/server`, `src/lib`, `src/kai-cli`, `scripts/`) keeps its style: oxlint runs its correctness rules there with Orca's style rules off, the code-quality audits skip it, and oxfmt ignores it. Its tests are the `crowsnest` vitest project in `config/vitest.config.ts`, with its own `@` alias and setup (`src/test/setup-env.ts`), on Node for `better-sqlite3`.
- Lead Studio leaves agent config files alone, such as `~/.claude/settings.json` and `~/.codex/hooks.json`. Agent status hooks default to off (`agentStatusHooksEnabled: false` in `src/shared/default-global-settings.ts`), so startup neither installs nor removes managed hook entries there. With hooks on, its entry would replace Orca.app's, because the matcher in `src/main/agent-hooks/installer-utils.ts` keys on the script name, not its folder. A backlog issue tracks an entry that coexists with Orca.app's; until then, keep hooks off.
- Remote and WSL hosts keep Orca's `~/.orca` layout and the `orca` command there.

## Invariants

- The app reads Instagram: sync and own-channel measurement always run. It never auto-publishes until the publish step ships: `startInApp` starts the publish scheduler only with `LEAD_STUDIO_PUBLISH_JOBS=1`. `src/server/start.test.ts` checks both.
- Lead Studio never opens or writes the installed Orca.app profile, lock, socket, keychain item, `~/.orca` or `/usr/local/bin/orca`. Changing a value in the identity table must keep it distinct from Orca's. Lane 2 in `scripts/e2e/cases/app.md` checks that `~/.orca` is unchanged after `pnpm dev`.
- Agents in a Lead Studio terminal run `lead-dev`, which reaches this instance through `ORCA_USER_DATA_PATH`. Dev mode is detected by `lead-studio` in that path (`src/cli/handlers/orchestration/runtime-compatibility.ts`). Orca's bundled agent skill guides still say `orca`.

## Verify

The verify skill launches the app with Playwright `_electron.launch` and drives it with journeys. See `.claude/skills/verify/features/app-shell.md` and the cases in `scripts/e2e/cases/app.md`.
