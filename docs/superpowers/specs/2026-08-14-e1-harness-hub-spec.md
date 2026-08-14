# E1 harness hub spec

Status: draft, awaiting Kai's wireframe approval before build.
Roadmap: E1 is step 1 of 4 (E1 harness, D1 create-run tracking, E2 workspace out of vault, E3 commands and skills into Crowsnest). See the 2026-08-13 cook roadmap handoff for the locked decisions this spec implements.

## Goal

Turn the cook spawn into a declared harness profile. Today the cook is spawned from hard-coded arguments in `session.ts`. E1 replaces that with a profile object that carries every knob the cook needs (model, cwd, plugin dir, permission mode, scrubbed env, hooks-off settings) and a lifecycle that survives a stop and a close without leaking child processes.

E1 is groundwork. The cook's own behavior does not change: same command, same output, same render. What changes is how it is launched and controlled.

## Non-goals

- No create-run tracking. That is D1.
- No moving the workspace out of the vault. That is E2.
- No plugin dir contents, no brief.md writer, no craft folding. That is E3.
- The profile declares a `pluginDir` field in E1, but E1 leaves it unset (the cook still finds `/ksa:cooking` by cwd-walk into the vault, exactly as today). E3 fills it in.

## Current state (grounded)

- `src/server/terminal/session.ts:33` spawns `binary` with a fixed arg list `["--dangerously-skip-permissions"]`, cwd from `opts.cwd`, env from `scrubbedTerminalEnv()`. No model flag, no plugin dir, no settings override.
- `src/server/terminal/session.ts:23` `scrubbedTerminalEnv()` strips credential-looking keys and every `CLAUDE_CODE_*` key. Keep this; the profile reuses it.
- `src/server/terminal/ws.ts:55` calls `createTerminalSession({ cwd: dir })`, wires `onData`, `onExit`, `ws.on("message")`, `ws.on("close")`. On close it calls `session?.kill()` and `renderWatch.stop()`.
- `src/server/terminal/render-watch.ts` polls every 700ms from session start until the render lands or the session exits. The poll runs the whole session, not only while a cook is in flight.
- `src/server/terminal/pty-perms.ts` already chmods the node-pty prebuilds.
- `session.ts` binary default is `/Users/kienbeovl/.local/bin/claude`, overridable by `CLAUDE_BINARY_PATH`.

## What E1 builds

### 1. Harness profile object

A plain data object that fully describes one cook spawn. Proposed shape:

```ts
export interface HarnessProfile {
  model?: string;              // maps to --model; unset means the CLI default
  cwd: string;                 // the sandbox dir
  pluginDir?: string;          // maps to --plugin-dir; UNSET in E1, filled by E3
  permissionMode: "bypassPermissions"; // maps to --permission-mode
  settingsJson: string;        // serialized object passed to --settings (hooks-off, see below)
  env: NodeJS.ProcessEnv;      // scrubbedTerminalEnv() output
}
```

A builder turns the profile into the argv the pty spawns:

```ts
export function buildHarnessArgs(p: HarnessProfile): string[] {
  const args: string[] = ["--permission-mode", p.permissionMode, "--settings", p.settingsJson];
  if (p.model) args.push("--model", p.model);
  if (p.pluginDir) args.push("--plugin-dir", p.pluginDir);
  return args;
}
```

Decision to confirm at build time: whether `--permission-mode bypassPermissions` replaces `--dangerously-skip-permissions` cleanly, or whether the cook still needs the old flag. The handoff's Plan B says bypassPermissions is the intended path. Verify the spawned cook still runs unattended (no permission prompt) with the new flag before deleting the old one.

### 2. Hooks off via a targeted --settings override

The cook must not fire this app's SessionStart hooks (the ADHD, caveman, superpowers, humanizer, last30days injectors), which pollute the cook's context. Locked decision B5: do this with a targeted `--settings` override carrying an explicit empty SessionStart hooks block. NOT `--bare` (forces API-key auth, breaks Claude Max). NOT `--setting-sources user` (would strip Crowsnest's own humanizer hooks in `.claude/settings.json`).

Proposed settings payload:

```json
{ "hooks": { "SessionStart": [] } }
```

Open question for build: confirm that a `--settings` object is merged as an additional, highest-precedence source and that an empty array for `SessionStart` overrides (not appends to) the inherited hooks. If merge semantics append instead of replace, the payload needs whatever the CLI's documented override form is. Read `node_modules/@anthropic-ai/claude-code` docs or the claude-api skill before assuming. Do not ship this on a guess; add a test that spawns the cook and asserts no SessionStart hook output appears in the first frames.

### 3. Process group and concurrency queue

- Spawn the cook in its own process group so a Stop kills the whole tree (ffmpeg, kokoro, any sub-agent children), not just the top claude process. node-pty on darwin gives the child its own session; confirm `child.kill()` reaches descendants, and if not, kill the process group by pgid.
- Add a small concurrency queue (p-queue) so two simultaneous cooks degrade gracefully instead of thrashing. Concurrency limit is a config value; start at 1 or 2, confirm with Kai in the wireframe.
- This is blocker B3's spawn half. The ws-survival half (cook survives tab close) is D1, not E1, because it needs the run record to reattach to.

### 4. Watchdog timeout and perf pass

- A watchdog timer per session that kills a cook stuck past a timeout. In E1 the watchdog is a plain timeout (gate-aware watchdog is D1; do not build the waiting-state logic here). Pick a generous default so a normal cook never trips it.
- Gate the render poll: `watchForRender` should run only while a cook is in flight, not for the whole session. Wire start and stop to the cook's active window.
- Prune the renders dir so old renders do not accumulate.
- Stream the sha256 in `AssetStore.put` instead of buffering the whole file (the put already reads bytes and hashes; make it streaming so a big render does not block).
- One `AbortController` per session owns the timers (watchdog, poll) so a single abort tears them all down.

### 5. session.ts spawns from a profile

`createTerminalSession` takes a `HarnessProfile` (or an opts object that carries one) instead of `{ cwd }`. It calls `buildHarnessArgs(profile)` for the argv and uses `profile.env`. `ws.ts` builds the profile from config plus the resolved sandbox dir and passes it in.

## Acceptance criteria

1. A cook launched from the studio still runs end to end: the sandbox renders, `/ksa:cooking` injects, a real claude session cooks, the render watcher captures the dropped MP4 and serves it at `/api/media/<id>`. Same as the verified-live behavior today, no regression.
2. The spawned cook shows no SessionStart hook output (no ADHD, caveman, superpowers, humanizer banners) in its terminal frames.
3. Crowsnest's own humanizer hook in `.claude/settings.json` still fires for the main app session (the override is scoped to the cook spawn only, not global).
4. Pressing Stop kills the cook and its children; no orphaned ffmpeg or kokoro process survives (verify with `ps` after a Stop).
5. The render poll is not running when no cook is in flight (verify it is stopped between cooks).
6. `AssetStore.put` streams the hash; a large render does not block the event loop measurably.
7. Two cooks started close together both complete; neither corrupts the other's sandbox or render.
8. Unit tests: `buildHarnessArgs` produces the expected argv for a profile with and without model and pluginDir; the settings payload disables SessionStart hooks.

## Test plan

- Extend `session.test.ts` for `buildHarnessArgs` and profile-to-argv mapping.
- A live smoke run of one cook (criteria 1 to 4) since the hook-suppression and process-group behavior are not unit-testable in isolation.
- A concurrency test (criterion 7) with two trivial cooks.

## Files touched

- `src/server/terminal/session.ts` (profile, argv builder, process group, spawn from profile)
- `src/server/terminal/ws.ts` (build profile, gate render poll to the cook window, AbortController wiring)
- `src/server/terminal/render-watch.ts` (start/stop gating, prune)
- `src/server/media/asset-store.ts` (stream the sha256 in put)
- `src/server/config.ts` (concurrency limit, watchdog timeout, model default)
- new: a harness profile module (or colocated in session.ts)
- p-queue added to dependencies

## Open questions to settle before build

1. `--permission-mode bypassPermissions` vs keeping `--dangerously-skip-permissions`. Verify unattended run.
2. `--settings` merge precedence and whether an empty array overrides inherited hooks. Read the CLI docs, add an assertion.
3. node-pty process-group kill on darwin: does `child.kill()` reach descendants, or is a pgid kill needed?
4. Concurrency limit default (1 or 2), and watchdog timeout default. Confirm with Kai.
