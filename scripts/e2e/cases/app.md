# App cases

## Built features

Lead Studio, the Electron app at the repo root, opened with `pnpm dev`. Driven with `.claude/skills/verify/scripts/app-drive.sh`.

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Window | Opens a window titled Lead Studio | ● | `src/renderer/index.html` | none |
| 2 | Terminal | Runs a shell in a terminal tab of the active worktree | ● | `tests/e2e/helpers/terminal.ts` | none |
| 3 | Split | Splits the active terminal pane | ● | `src/renderer/src/constants/terminal.ts` | none |
| 4 | Side by side with Orca.app | Uses its own user data dir, lock, socket, keychain item, `~/.lead-studio` and CLI name | ● | `src/main/startup/configure-process.ts` | none |
| 5 | Crowsnest MCP | Serves the 38 `crowsnest_*` tools on 127.0.0.1, port in `<userData>/mcp.port` | ● | `src/main/crowsnest/mcp-http.ts` | none |
| 6 | Media | Serves stored assets on `cn-media://asset/<id>` with byte ranges | ● | `src/main/crowsnest/start.ts` | no board uses it yet |
| 7 | Jobs | Opens the checkout's `data/crowsnest.db` directly; runs sync and own-measure, and the publish scheduler only with `LEAD_STUDIO_PUBLISH_JOBS=1` | ● | `src/server/start.ts`, `src/main/crowsnest/start.ts` | the publish step turns publishing on |
| 8 | Engine bridge | `window.api.crowsnest.call` runs an engine query or local action from the renderer, with typed errors | ● | `src/server/bridge/engine-calls.ts` | no board uses it yet |

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

1. With Orca.app open, run `pnpm dev` from a clean worktree.
2. Type `echo hi` in the terminal, split the pane, open a browser tab.
3. Pass: the terminal prints `hi`, Orca.app keeps its own window, profile and CLI socket, and `~/.orca` is unchanged: `find ~/.orca -newer <stamp>` lists nothing, where `<stamp>` is a file touched just before `pnpm dev`. With a fresh profile, `~/.claude/settings.json` is also unchanged, since agent status hooks default to off.

### mcp-tools: app MCP lists its tools

1. `app-up.sh --seed`.
2. `mcp.sh tools/list`.
3. Pass: 38 `crowsnest_*` tools.

### Launcher with a stale port

1. Write a `mcp.port` naming a port nothing listens on into a temp dir.
2. Pipe a `tools/list` request into `LEAD_STUDIO_USER_DATA=<dir> node scripts/lead-studio-mcp.mjs`.
3. Pass: stdout has a -32000 "Lead Studio is not running" error for id 1, and `mcp.port` is gone.

### media-01: cn-media assets

1. `app-up.sh --seed`, insert a `media_assets` row for a file under the checkout media dir.
2. `CN_MEDIA_ASSET=<id> app-drive.sh media-01`.
3. Pass: `ok: missing asset is 404`, `ok: asset 200`, `ok: asset range 206`.

### bridge-01: engine bridge from the renderer

1. `app-up.sh --seed`.
2. `app-drive.sh bridge-01`.
3. Pass: `getChannelsList` returns `@e2e_fixture_creator`, `getChannelDetail` returns its 30 videos, `getSecretStatusAction` shows `IG_GRAPH_TOKEN` configured without the seeded value, `getChannelDetail(42)` is `bad_args`, `publishNowAction` is `unknown_call`, and the journey saves `bridge-01.png`.

### No double publish

1. Copy `data/crowsnest.db` and its `-wal`, add a `planned_posts` row with `state` `scheduled` and `scheduled_at` now, and launch with `APP_REAL_DB=<copy> app-up.sh --real`, `LEAD_STUDIO_PUBLISH_JOBS` unset.
2. Wait ten minutes.
3. Pass: `host.log` says `publish jobs off`, and the row is still `scheduled` with `attempt_count` 0 and the same `updated_at`.

### Cold start

1. `app-drive.sh --timing 3`.
2. Pass: the median Lead Studio cold start to first contentful paint is at most 1.5x Orca.app's.
