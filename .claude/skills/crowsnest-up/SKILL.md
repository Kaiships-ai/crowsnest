---
name: crowsnest-up
description: Boot the crowsnest local stack (9router, dev server on 3000, connected browser). User-invoked only.
disable-model-invocation: true
---

# crowsnest-up

Bring the crowsnest dev stack up in one shot and leave it running. Three
services: 9router (LLM proxy on 20128), the Next dev server on port 3000, and a
connected headed browser pointed at the app.

Every step is idempotent: check if the thing is already up before starting it.
Never broad-kill (`pkill -f next-server` nukes unrelated servers and starts a
restart loop). If a service is up, leave it. If a port is held by something
that is not ours, stop and report, do not kill it.

Project root: the repo this skill lives in (`git rev-parse --show-toplevel`).
Dev log: `$HOME/.crowsnest/dev-3000.log`

## Step 1: 9router (LLM proxy on 20128)

Check first, start only if down.

Start in tray mode. Bare `9router` opens a browser and exits ("Exiting...");
`--tray` is the persistent background server.

```bash
code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:20128 2>/dev/null)
if [ -n "$code" ] && [ "$code" != "000" ]; then
  echo "9router already up (HTTP $code)"
else
  mkdir -p "$HOME/.crowsnest"
  /opt/homebrew/bin/9router --tray --no-browser --skip-update > "$HOME/.crowsnest/9router.log" 2>&1 &
  disown 2>/dev/null || true
  echo "9router started (tray)"
fi
```

Completion: `curl http://localhost:20128` returns a non-000 code (307 when up).
Check with a short poll, not a single shot, since tray boot takes a second or
two. If it stays 000, read `$HOME/.crowsnest/9router.log` and report. Do not
retry more than once.

## Step 2: Dev server on 3000 (run it in an orca pane)

The dev server MUST run in a real orca terminal pane, not from a Bash tool
call. This shell runs with `CLAUDE_CODE_SANDBOXED=1`; a backgrounded
`npm run dev` from the tool gets reaped within a minute or two (log ends
mid-request, no crash trace). An orca pane runs in a real shell that
survives.

First check port 3000:

- Already serving (HTTP 200 on `http://localhost:3000`): skip to Step 3.
- Held by something else: stop, report what holds it (`lsof -nP -iTCP:3000 -sTCP:LISTEN`), do not kill.
- Down: open a pane and run the dev server in it.

Open the pane and capture its handle. Prefer splitting off the current pane
for this worktree (`orca terminal list` gives its handle); if no pane exists
yet for this worktree, `orca terminal create` opens one directly. Then send
the command — do not rely on a `--command` passed to split/create surviving
the pane, verify with `send` instead:

```bash
REPO="$(git rev-parse --show-toplevel)"
CUR=$(orca terminal list --worktree "path:$REPO" --json 2>/dev/null | jq -r '.result.terminals[0].handle // empty')
if [ -n "$CUR" ]; then
  SURF=$(orca terminal split --terminal "$CUR" --direction vertical --json 2>&1 | jq -r '.result.split.handle // empty')
else
  SURF=$(orca terminal create --worktree "path:$REPO" --title "crowsnest-dev-3000" --json 2>&1 | jq -r '.result.terminal.handle // empty')
fi
echo "dev pane: $SURF"
# tui-idle can time out even on a plain idle prompt; treat it as best-effort,
# not a gate — do not skip the send on timeout.
orca terminal wait --terminal "$SURF" --for tui-idle --timeout-ms 15000 >/dev/null 2>&1 || true
orca terminal send --terminal "$SURF" --text 'cd "$(git rev-parse --show-toplevel)" && PORT=3000 npm run dev' --enter
```

Then verify it comes up AND survives. Poll for ~20s:

```bash
for i in $(seq 1 6); do
  sleep 4
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null)
  echo "t=$((i*4))s HTTP=$code"
done
```

Completion: the last three polls all read 200. If it never reaches 200, read
the pane with `orca terminal read --terminal "$SURF" --screen --json` and
report what it shows (compile error, wrong cwd, port conflict). Do not fall
back to nohup, it will not stay up.

## Step 3: Connect browser and open the app

Launch browse with cwd = a repo SUBDIR (`.gstack/browse-cwd`).

- Visible headed window: the Chromium survives headed only when cwd is UNDER the
  repo path. From `$HOME` or `/tmp` the headed window dies within seconds and
  browse falls back to an invisible headless-shell. A repo subdir counts as under
  the repo, so headed survives.
- Sidebar Claude auth: the sidebar Claude Code 401 (a Claude Max session routed
  through 9router) is fixed at the source. The app's LLM proxy env var is named
  `LLM_BASE_URL`, not `ANTHROPIC_BASE_URL`, and the key lives in the db, so
  `.env.local` carries nothing Claude Code honors. The browse server can no
  longer leak an override into the sidebar. The subdir cwd is belt and suspenders.

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
REPO="$(git rev-parse --show-toplevel)"
SUB="$REPO/.gstack/browse-cwd"; mkdir -p "$SUB"
# clean any old browse server + chromium first
pkill -f "browse/src/server.ts" 2>/dev/null || true
pkill -f "browse/src/terminal-age" 2>/dev/null || true
pkill -f "chrome-headless-shell" 2>/dev/null || true
rm -f "$REPO/.gstack/browse.json" 2>/dev/null || true
for _LF in SingletonLock SingletonSocket SingletonCookie; do rm -f "$HOME/.gstack/chromium-profile/$_LF" 2>/dev/null; done
# BROWSE_CLAUDE_DANGEROUS=1 runs the sidebar Claude with
# --dangerously-skip-permissions (no permission prompts). Requires the one-line
# edit in gstack browse terminal-agent.ts that reads this var; see memory
# [[gstack-browse-cwd-trick]] / the sidebar-dangerous note.
( cd "$SUB" && BROWSE_CLAUDE_DANGEROUS=1 "$B" connect )
"$B" focus 2>&1
"$B" goto http://localhost:3000 2>&1
"$B" url 2>&1
```

Use `localhost`, never `127.0.0.1`: Next 16 silently blocks Server Actions from
the wrong origin.

Completion, all three must hold:
- `pgrep -f 'Chrome for Testing' | wc -l` is greater than 0 (headed and visible;
  if it is 0 and `chrome-headless-shell` is running, the headed window died,
  recheck the cwd is the repo subdir).
- `browse url` reads `http://localhost:3000/...`, not `chrome-error://`.
- `ps eww -p "$(pgrep -f browse/src/terminal-age | head -1)" | tr ' ' '\n' | grep -c ANTHROPIC_`
  is 0 (sidebar Claude clean, runs on Claude Max).

## Done

Report the final state as three lines: 9router (up/failed), dev server on 3000
(up and stable / exited, with cause), browser (connected and showing the app /
not). If any step failed, name the failing step and the log line, do not paper
over it.
