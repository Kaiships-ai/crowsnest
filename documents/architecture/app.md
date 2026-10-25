# App

Lead Studio is the Electron app crowsnest is becoming. It lives in `studio/`, not `app/`, because Next.js ignores `src/app` when a root `app/` directory exists. It is Orca (MIT, Lovecast Inc) brought in as a squashed `git subtree` from Orca commit `b46be798ed4`. It runs locally with `npm run studio` and is not packaged. It is Orca's workspace under a new identity (terminal, chat, browser tab, split panes and the agent table), with crowsnest's `src/server` running in its main process. Crowsnest boards move into it in later steps.

## What it holds

The app keeps its state in its own user data dir, `~/Library/Application Support/lead-studio` in dev. The single-instance lock and the runtime CLI socket (`o-<pid>-*.sock`) live there, so they follow the dir. Two crowsnest files live there too:

- `crowsnest.db`, the app's own copy of the checkout's `data/crowsnest.db`. It is copied once, on the first launch that finds no copy, main file first and then its `-wal` (`studio/src/main/crowsnest/copy-db.ts`). If the main file's size or mtime changes during the copy, because :3000 wrote to it, the copy is retried once; a second change fails the crowsnest start with a message to stop :3000 and relaunch. The copy is migrated on every launch. The app never opens `data/crowsnest.db` itself, which stays with the Next.js server on :3000.
- `mcp.port`, the port of the app's MCP, rewritten on every launch and removed on quit.

Media files are not copied. `MEDIA_ROOT` points at the checkout's `data/media` unless the environment sets it.

## Crowsnest server in the main process

`startCrowsnest` in `studio/src/main/crowsnest/start.ts` runs after the ready-phase runtime services (`studio/src/main/startup/main-process-ready.ts`). It does not block the window, and a failure only logs `[crowsnest] start failed`. In order, it:

1. copies the DB as above and sets `CROWSNEST_DB_PATH` and `MEDIA_ROOT`, which `src/server` reads at import time;
2. imports `src/server/start.ts` and calls `startInApp`, which applies the `drizzle/` migrations;
3. serves the MCP at `http://127.0.0.1:<mcp.port>/api/mcp` (`studio/src/main/crowsnest/mcp-http.ts`), the same handler and the same 38 `crowsnest_*` tools as :3000;
4. serves stored assets on `cn-media://asset/<assetId>` through the Next media route's own `GET` and `HEAD` handlers, with byte ranges.

The `.mcp.json` entry `lead-studio` runs `scripts/lead-studio-mcp.mjs`, a stdio server that forwards each message to the port in `mcp.port` (`LEAD_STUDIO_USER_DATA` names another user data dir). With no app listening it answers each request with a -32000 "Lead Studio is not running" error, and it deletes a `mcp.port` left by an app that died without its quit hook. The `crowsnest` entry still points at :3000.

### How the main build gets `src/server`

The main bundle compiles `src/server` from the repo root with its pure JS dependencies (drizzle-orm, the MCP SDK, zod, p-queue) resolved from the root `node_modules`. `studio/electron.vite.config.ts` maps `@/` to the root `src/`, aliases `next/cache` and `next/server` to the no-op shims in `studio/src/main/crowsnest/next-shims.ts` (`revalidatePath` and `after` are the only Next calls reachable from the MCP), and keeps `better-sqlite3` external. At runtime `require("better-sqlite3")` resolves to the root package. Its binary is N-API (version 10), so the same build loads in Node for `npm test` and in Electron 43, and no Electron rebuild is needed. `studio/config/tsconfig.node.json` maps `@/*` the same way, so the studio typecheck follows the imports into `src/server`.

## Identity

| Key | Value | Where |
| --- | --- | --- |
| App id | `ai.kaiships.leadstudio` | `studio/config/electron-builder.config.cjs`, `studio/src/shared/local-build-compatibility-contract.json` |
| Product name and URL scheme | Lead Studio, `leadstudio://` | `studio/config/electron-builder.config.cjs` |
| Dev user data dir | `lead-studio` | `studio/src/main/startup/configure-process.ts`, `studio/src/cli/runtime/launch-user-data-path.ts`, `studio/config/scripts/orca-dev.mjs` |
| App name and keychain item | dev: Lead Studio Dev, `Lead Studio Dev Safe Storage`; packaged: Lead Studio | `studio/src/main/startup/dev-instance-identity.ts` |
| Dev Electron bundle | `ai.kaiships.leadstudio.dev`, Lead Studio Dev | `studio/config/scripts/dev-electron-bundle-identity.mjs` |
| Window title | Lead Studio | `studio/src/renderer/index.html`, `studio/src/main/window/createMainWindow.ts` |
| CLI command | `lead` (packaged, `/usr/local/bin/lead`), `lead-dev` (dev, the shim in `<user data>/cli/bin`) | `studio/package.json`, `studio/src/main/cli/cli-install-constants.ts`, `studio/src/main/runtime/orchestration/cli-command.ts` |
| Home dir | `~/.lead-studio`: agent hook scripts, keybindings, the hook install lock, API key and credential files | `studio/src/main/agent-hooks/installer-utils.ts`, `studio/src/main/agent-hooks/runtime-home-hook-command.ts`, `studio/src/main/keybindings/keybinding-file.ts` |

## Boundaries

- Orca code changes only in `studio/`. `git subtree pull --prefix studio --squash` brings upstream changes, so edits there stay small and named.
- The root toolchain (npm, eslint, tsc, vitest, `scripts/check-doc-paths.mjs`) skips `studio/`. `studio/` has its own pnpm install and tests. Run every `studio/` command through `scripts/studio-run.sh`: it uses the node major that `studio/package.json` `engines` pins (from `/opt/homebrew/opt/node@<major>/bin`), takes the `scripts/heavy.sh` lock and caps vitest at 2 workers. `npm run studio` and `npm run studio:test` use it. `npm run studio` passes `--no-lock`, since the app stays open for hours.
- Lead Studio leaves agent config files alone, such as `~/.claude/settings.json` and `~/.codex/hooks.json`. Agent status hooks default to off (`agentStatusHooksEnabled: false` in `studio/src/shared/default-global-settings.ts`), so startup neither installs nor removes managed hook entries there. With hooks on, its entry would replace Orca.app's, because the matcher in `studio/src/main/agent-hooks/installer-utils.ts` keys on the script name, not its folder. A backlog issue tracks an entry that coexists with Orca.app's; until then, keep hooks off.
- Remote and WSL hosts keep Orca's `~/.orca` layout and the `orca` command there.

## Invariants

- Single writer. Until the app takes over publishing, the :3000 server owns `data/crowsnest.db` and the publish, sync and own-measure schedulers. The app starts those jobs only with `LEAD_STUDIO_PRIMARY=1`. Without it, `startInApp` also makes every fetch to `graph.instagram.com` and the instagrapi sidecar (`IG_SERVICE_URL`) fail, so no MCP tool reaches Instagram from the app. `src/server/start.test.ts` checks both. `server.ts` boots the same jobs through `startJobs`.

- Lead Studio never opens or writes the installed Orca.app profile, lock, socket, keychain item, `~/.orca` or `/usr/local/bin/orca`. Changing a value in the identity table must keep it distinct from Orca's. Lane 2 in `scripts/e2e/cases/app.md` checks that `~/.orca` is unchanged after `npm run studio`.
- Agents in a Lead Studio terminal run `lead-dev`, which reaches this instance through `ORCA_USER_DATA_PATH`. Dev mode is detected by `lead-studio` in that path (`studio/src/cli/handlers/orchestration/runtime-compatibility.ts`). Orca's bundled agent skill guides still say `orca`.

## Verify

The verify skill launches the app with Playwright `_electron.launch` and drives it with journeys. See `.claude/skills/verify/features/app-shell.md` and the cases in `scripts/e2e/cases/app.md`.
