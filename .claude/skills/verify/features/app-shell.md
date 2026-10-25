# App shell

Lead Studio is the Electron app at the repo root, Orca's workspace under its own identity: terminal, chat, browser tab, split panes and the agent table. Crowsnest's `src/server` runs in its main process on the checkout's `data/crowsnest.db`; no crowsnest board lives in it yet.

## Sub-features

- Window titled Lead Studio (`src/renderer/index.html`, `src/main/window/createMainWindow.ts`).
- Terminal tab in the active worktree, typed into through xterm's helper textarea.
- Split of the active terminal pane, through the same split request the pane menu sends (`src/renderer/src/constants/terminal.ts`).
- Crowsnest MCP at `http://127.0.0.1:<port>/api/mcp`, the port in `<userData>/mcp.port` (`src/main/crowsnest/mcp-http.ts`). 38 `crowsnest_*` tools.
- `cn-media://asset/<assetId>` serves stored assets with byte ranges (`src/main/crowsnest/start.ts`).
- Jobs: sync and own-measure always run and reach Instagram; the publish scheduler runs only with `LEAD_STUDIO_PUBLISH_JOBS=1` (`src/server/start.ts`).
- Identity apart from the installed Orca.app: user data dir `lead-studio`, app id `ai.kaiships.leadstudio`, keychain item `Lead Studio Dev Safe Storage`, dev bundle id `ai.kaiships.leadstudio.dev`, home dir `~/.lead-studio`, CLI `lead-dev` in its terminals.

## How to get to it (user POV)

`pnpm dev` from the repo root (node 24). It builds `out/` and opens the window on the checkout's `data/crowsnest.db`; the dev runner logs `[orca-dev] Remote debugging on http://127.0.0.1:<port>`. Add a project with the sidebar plus button to get a terminal. `Cmd+D` splits the terminal and `Cmd+Shift+B` opens a browser tab.

## Setup

- `pnpm install` once at the root, under node 24 (`export PATH=/opt/homebrew/opt/node@24/bin:$PATH`), with Xcode command line tools. `postinstall` rebuilds node-pty for Electron.
- Run heavy commands through the pnpm scripts, which go through `scripts/heavy.sh` (node 24 check, heavy lock, vitest at 2 workers). On node 22 about 116 of Orca's own unit tests fail; `heavy.sh` refuses it.
- `pnpm dev` and `app-up.sh` both write `out/`. `app-up.sh` builds with `--mode e2e` so `window.__store` is exposed. Do not run both from one worktree at once.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh                  # build (e2e mode) + launch, prints "app: ready"
.claude/skills/verify/scripts/app-up.sh --seed           # app DB = fresh scripts/seed-e2e.ts seed
APP_REAL_DB=<db> .claude/skills/verify/scripts/app-up.sh --real  # app DB = copy of <db> (default data/crowsnest.db)
.claude/skills/verify/scripts/mcp.sh --app tools/list    # app MCP, port from data/verify/app/mcp.port
.claude/skills/verify/scripts/mcp.sh --app crowsnest_plans
CN_MEDIA_ASSET=<asset id> .claude/skills/verify/scripts/app-drive.sh media-01 [run-id]
APP_SKIP_BUILD=1 .claude/skills/verify/scripts/app-up.sh # reuse out/
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh close-terminal [run-id]  # negative control
.claude/skills/verify/scripts/app-drive.sh --console      # host log
.claude/skills/verify/scripts/app-drive.sh --timing 3     # cold start vs Orca.app
.claude/skills/verify/scripts/app-down.sh
```

`shell-01` prints `ok: window`, `ok: terminal echo`, `ok: split` and saves `shell-01.png`. After `close-terminal`, a rerun of `shell-01` fails with `FAIL: terminal echo`.

`media-01` fetches `cn-media://asset/no-such-asset` from the renderer and expects 404. With `CN_MEDIA_ASSET` it also expects a 200 body and a 10-byte 206 for `bytes=0-9`. The seed has no assets; insert a `media_assets` row into the lane's `<userData>/crowsnest.db` (the user data dir `app-up.sh` prints) pointing at a file under the checkout media dir.

`app-host.mjs` waits for `mcp.port` before `app: ready`, so a crowsnest start failure shows as `crowsnest MCP never wrote mcp.port` with `[crowsnest] start failed` in `host.log`.

## Gotchas

- The CLI socket lives in the user data dir and macOS caps a socket path at 104 bytes, so `app-host.mjs` uses a short temp dir. A long one fails with `EINVAL` on `listen`.
- Add project opens a native folder picker that CDP cannot drive. A scripted lane adds the repo with `window.api.repos.add({ path })`, the call the picker makes.
- In-app copy still says Orca (sidebar header, empty state, Orca Mobile). Only the window title, dock name and identity are renamed so far.
- `mcp.sh --app` is the only target. The app's MCP refuses non-local Host and Origin headers.
- A lane never opens the checkout's `data/crowsnest.db`: `app-host.mjs` sets `CROWSNEST_DB_PATH` to `<userData>/crowsnest.db` in a fresh temp user data dir, copied from the seed (`--seed`) or `APP_REAL_DB` (`--real`) with `scripts/copy-db.ts`, or empty. `pnpm dev` does open the checkout's DB.
- Launching from inside an Orca terminal inherits `ELECTRON_RUN_AS_NODE`; `app-host.mjs` strips it, as Orca's e2e does.
- Lead Studio writes `~/.lead-studio`, never `~/.orca`. It also leaves agent config files such as `~/.claude/settings.json` alone: agent status hooks default to off, because with them on each app's hook install replaces the other's entry. A profile created before that default still holds `agentStatusHooksEnabled: true`; turn it off in Settings or start from a fresh `lead-studio` user data dir.
- The in-terminal CLI is `lead-dev` (and `lead`). The shims live under the `lead-studio` user data dir, so they reach this app, not Orca.app. Orca's bundled agent skill guides still say `orca`. On zsh with Orca.app's CLI installed, `orca` in a Lead Studio terminal resolves to `/usr/local/bin/orca` first, as it does in upstream Orca dev; use `lead-dev`.
