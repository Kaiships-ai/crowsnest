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
| 5 | Crowsnest MCP | Serves the 38 `crowsnest_*` tools on 127.0.0.1, port in `<userData>/mcp.port` | ● | `studio/src/main/crowsnest/mcp-http.ts` | none |
| 6 | Media | Serves stored assets on `cn-media://asset/<id>` with byte ranges | ● | `studio/src/main/crowsnest/start.ts` | no board uses it yet |
| 7 | Single writer | Runs publish, sync and own-measure jobs only with `LEAD_STUDIO_PRIMARY=1`; otherwise refuses Instagram fetches | ● | `src/server/start.ts` | the app takes over publishing in a later step |

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

### mcp-parity: app MCP answers like :3001

1. `up.sh` at trunk (or any `:3001` on the same seed), then `APP_REAL_DB=<that e2e.db> app-up.sh --real` at head.
2. For `tools/list`, `crowsnest_plans`, `crowsnest_feed`, `crowsnest_channels`: `mcp.sh <tool>` and `mcp.sh --app <tool>`.
3. Pass: each pair is byte-equal and `tools/list` has 38 `crowsnest_*` tools.

### media-01: cn-media assets

1. `app-up.sh --seed`, insert a `media_assets` row for a file under the checkout media dir.
2. `CN_MEDIA_ASSET=<id> app-drive.sh media-01`.
3. Pass: `ok: missing asset is 404`, `ok: asset 200`, `ok: asset range 206`.

### No double publish

1. Copy `data/crowsnest.db` and its `-wal`, add a `planned_posts` row with `state` `scheduled` and `scheduled_at` now, and launch with `APP_REAL_DB=<copy> app-up.sh --real`, `LEAD_STUDIO_PRIMARY` unset.
2. Wait ten minutes.
3. Pass: `host.log` says `jobs off`, the row is still `scheduled` with `attempt_count` 0 and the same `updated_at`, and :3000 is untouched.

### Cold start

1. `app-drive.sh --timing 3`.
2. Pass: the median Lead Studio cold start to first contentful paint is at most 1.5x Orca.app's.
