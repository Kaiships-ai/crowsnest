# App cases

## Built features

Lead Studio, the Electron app in `studio/`, opened with `npm run studio`. Driven with `.claude/skills/verify/scripts/app-drive.sh`, not the browse CLI.

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Window | Opens a window titled Lead Studio | ● | `studio/src/renderer/index.html` | none |
| 2 | Terminal | Runs a shell in a terminal tab of the active worktree | ● | `studio/tests/e2e/helpers/terminal.ts` | none |
| 3 | Split | Splits the active terminal pane | ● | `studio/src/renderer/src/constants/terminal.ts` | none |
| 4 | Side by side with Orca.app | Uses its own user data dir, lock, socket, keychain item, `~/.lead-studio` and CLI name | ● | `studio/src/main/startup/configure-process.ts` | none |

## Test cases

### shell-01: window, terminal echo, split

1. `app-up.sh`, wait for `app: ready`.
2. `app-drive.sh shell-01`.
3. Pass: prints `ok: window`, `ok: terminal echo`, `ok: split`, saves `shell-01.png`, exits 0.

### shell-01 negative control

1. With the app up, `app-drive.sh close-terminal`.
2. `app-drive.sh shell-01`.
3. Pass: prints `FAIL: terminal echo` and exits 1.

### Beside Orca.app

1. With Orca.app open, run `npm run studio` from a clean worktree.
2. Type `echo hi` in the terminal, split the pane, open a browser tab.
3. Pass: the terminal prints `hi`, Orca.app keeps its own window, profile and CLI socket, and `~/.orca` is unchanged: `find ~/.orca -newer <stamp>` lists nothing, where `<stamp>` is a file touched just before `npm run studio`. With a fresh profile, `~/.claude/settings.json` is also unchanged, since agent status hooks default to off.

### Cold start

1. `app-drive.sh --timing 3`.
2. Pass: the median Lead Studio cold start to first contentful paint is at most 1.5x Orca.app's.
