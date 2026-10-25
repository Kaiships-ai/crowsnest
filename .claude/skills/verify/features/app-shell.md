# App shell

Lead Studio is the Electron app in `studio/`, Orca's workspace under its own identity: terminal, chat, browser tab, split panes and the agent table. No crowsnest board lives in it yet.

## Sub-features

- Window titled Lead Studio (`studio/src/renderer/index.html`, `studio/src/main/window/createMainWindow.ts`).
- Terminal tab in the active worktree, typed into through xterm's helper textarea.
- Split of the active terminal pane, through the same split request the pane menu sends (`studio/src/renderer/src/constants/terminal.ts`).
- Identity apart from the installed Orca.app: user data dir `lead-studio`, app id `ai.kaiships.leadstudio`, keychain item `Lead Studio Safe Storage`, dev bundle id `ai.kaiships.leadstudio.dev`.

## How to get to it (user POV)

`npm run studio` from the repo root. It runs `pnpm --dir app dev`, which builds `studio/out/` and opens the window. Add a project with the sidebar plus button to get a terminal.

## Setup

- `pnpm install` once in `studio/` (pnpm 12, Xcode command line tools). `postinstall` rebuilds node-pty for Electron.
- Orca asks for Node 24. Node 22 installs, builds and runs the app; about 116 of Orca's own unit tests fail on Node 22 on this machine before and after the rename.
- `npm run studio` and `app-up.sh` both write `studio/out/`. `app-up.sh` builds with `--mode e2e` so `window.__store` is exposed. Do not run both from one worktree at once.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh                  # build (e2e mode) + launch, prints "app: ready"
APP_SKIP_BUILD=1 .claude/skills/verify/scripts/app-up.sh # reuse studio/out
.claude/skills/verify/scripts/app-drive.sh shell-01 [run-id]
.claude/skills/verify/scripts/app-drive.sh close-terminal [run-id]  # negative control
.claude/skills/verify/scripts/app-drive.sh --console      # host log
.claude/skills/verify/scripts/app-drive.sh --timing 3     # cold start vs Orca.app
.claude/skills/verify/scripts/app-down.sh
```

`shell-01` prints `ok: window`, `ok: terminal echo`, `ok: split` and saves `shell-01.png`. After `close-terminal`, a rerun of `shell-01` fails with `FAIL: terminal echo`.

## Gotchas

- The CLI socket lives in the user data dir and macOS caps a socket path at 104 bytes, so `app-host.mjs` uses a short temp dir. A long one fails with `EINVAL` on `listen`.
- Launching from inside an Orca terminal inherits `ELECTRON_RUN_AS_NODE`; `app-host.mjs` strips it, as Orca's e2e does.
- `~/.orca` (keybindings, agent hook scripts, some credential files) is shared with Orca.app, the same split upstream uses between `pnpm dev` and the packaged app. The verify launch isolates HOME, so it never touches it.
- The in-terminal agent CLI is still `orca-dev`. Its shim lives under the `lead-studio` user data dir, so it reaches this app, not Orca.app.
