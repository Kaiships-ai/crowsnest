# Phase 0: 9router supervisor and sync auto-analyze

Two independent features from the Crowsnest Phase 0 roadmap. Both land on the branch
`feat/phase0-9router-supervisor-and-auto-analyze`.

Design decisions (locked with Kai, 2026-08-12):
1. Item 1 is a full supervisor: the app spawns and auto-restarts 9router, modeled on the
   IG sidecar supervisor. Plus a real status probe and an on/off toggle in Settings.
2. Item 3 auto-analyze runs in the sync pass, capped at 10 outliers per run, threshold
   outlierScore >= 3, cancelable, and downloads before it analyzes.

## Context

Local-first outlier research tool. Next.js 16, drizzle + better-sqlite3, vitest, Python
instagrapi sidecar under services/ig. 9router is a local LLM proxy on port 20128 that
all AI features route through. Repo root: /Users/kienbeovl/Desktop/entrepreneur/sandcastle-clone.

Read AGENTS.md first: this is a modified Next.js. Read node_modules/next/dist/docs/ before
router code.

The 9router launch command (from the crowsnest-up skill, verified):

```bash
/opt/homebrew/bin/9router --tray --no-browser --skip-update > "$HOME/.crowsnest/9router.log" 2>&1 &
```

Bare `9router` opens a browser and exits; `--tray` is the persistent background server.
Health: `curl http://localhost:20128` returns a non-000 HTTP code (307 when up) after a
second or two of boot.

## Global constraints

- npm and node are not on the Bash PATH inside subagents. Prefix commands with
  `export PATH="/opt/homebrew/bin:$PATH"`.
- Design system: radius 0, no shadows. Do not introduce rounded corners or shadows in new
  UI. Match the existing Settings section components.
- Prose in .md files outside docs/superpowers/plans/ must pass the humanizer hook (no em
  dashes, no en dashes, straight quotes). This plan file is exempt. Code comments follow
  the same rule anyway.
- Do not broad-kill processes (`pkill -f 9router` risks nuking unrelated things). The
  supervisor tracks its own child by PID, exactly like sidecar/control.ts.
- Never run the dev server from the Bash tool (sandboxed Bash reaps it). Verify with
  vitest, not by booting the app. Visual QA is the controller's job, done later in the
  connected browser.
- Both features must leave the existing test suite green.

## Task 1: 9router supervisor, status probe, and Settings control

### What exists (from recon, verify before relying)

- LLM client: `src/server/llm/client.ts`. `CompatLlmClient` at :137. `getLlm()` at
  :232-241 reads `process.env.LLM_BASE_URL` (:236) and picks compat vs native on
  `isCompatMode()` (:219-221 = `Boolean(process.env.LLM_BASE_URL)`). Singleton reset:
  `resetLlmClient()` (:249).
- Env var: `LLM_BASE_URL` (NOT ANTHROPIC_BASE_URL). Value `http://localhost:20128`
  (.env.local:21). Read from `process.env` directly in `client.ts:236`,
  `src/app/(shell)/page.tsx:39`, `src/app/(shell)/feed/[videoId]/remix/page.tsx:15`.
- Existing ping: `LlmClient.ping()` is a $0 count_tokens call (client.ts:44-52, compat
  impl :183-188). Server action `testAnthropicKeyAction()` at
  `src/server/actions/settings-actions.ts:96-105`.
- Status classifier: `src/components/status/dependency-status.ts`, `classifyLlmStatus()`
  at :131-163, `withTimeout()` :180, `LLM_PING_TIMEOUT_MS = 6000` :203. Important: in
  proxy mode a passing ping is only `"reachable_unverified"`, never `"up"` (:157-159),
  because 9router answers count_tokens locally while `/v1/messages` can be 410. There is
  no probe today that verifies real generation.
- Live model reality (memory, verify): the only live models route to a text-only
  deepseek. No vision. So the generation probe must send a tiny TEXT prompt, never image
  content.
- Process supervisor template: `src/server/sidecar/control.ts`. `spawn("uv", ...)` :38-58,
  PID file `data/sidecar.pid`, `sidecarPidAlive()` via `process.kill(pid, 0)` :62-72,
  `stopSidecar()` :74-85. Driver actions: `src/server/actions/sidecar-actions.ts`,
  `startSidecarAction` with post-spawn `waitForHealthy` poll :25-33, :42-56. THIS IS THE
  TEMPLATE. Copy its structure.
- Settings persistence: key/value rows in the `app_settings` drizzle table
  (`src/server/db/schema.ts`). Resolver `src/server/settings/index.ts`: precedence
  DB > env > default (:8-30), key map `DB_KEY` :101-117, per-key zod `SCHEMA` :138-156,
  `WIRED` honesty flags :198-214, `getSettingsWithSource()` :278-285, `validateSetting`
  :297.
- Settings actions: `getAppSettingsAction()` (settings-actions.ts:120-122),
  `updateAppSettingsAction(patch)` :181-213 (validates, upserts in a transaction via
  `upsertSettingSync` :66-73).
- Concrete toggle end to end (the pattern to copy): `notifyOnSuccess`. UI
  `src/components/settings/runs-alerts-section.tsx` `<Switch checked={notifyOnSuccess}>`
  at :132, `save()` calls `updateAppSettingsAction({ ..., notifyOnSuccess })` :64-68.
  Consumed at `sync-engine.ts:302` via `getSetting("notifyOnSuccess")`.
- Settings page: `src/app/(shell)/settings/page.tsx` (sections :25-37,
  `dynamic = "force-dynamic"` :42, reads via `getAppSettingsAction()` :61).
- Sidecar UI section for layout reference: `src/components/settings/` (find the sidecar
  control section that shows Connected/Disconnected plus start/stop buttons and copy its
  visual structure).

### Requirements

1. New supervisor module `src/server/llm/router-control.ts` (mirror
   `src/server/sidecar/control.ts`):
   - `startRouter()`: idempotent. If already reachable (HTTP probe on the base URL host,
     non-000), do nothing and report already-up. Else `spawn` the 9router binary with args
     `["--tray", "--no-browser", "--skip-update"]`, detached, stdout/stderr to
     `$HOME/.crowsnest/9router.log` (create the dir). Write the child PID to
     `data/9router.pid`. Return a discriminated result, same style as the sidecar actions.
     Resolve the binary path from an env var `ROUTER_BIN` if set, else default
     `/opt/homebrew/bin/9router`. Derive the health URL from `LLM_BASE_URL` (fallback
     `http://localhost:20128`).
   - `routerPidAlive()`: read `data/9router.pid`, `process.kill(pid, 0)`, same as
     `sidecarPidAlive()`.
   - `stopRouter()`: read the pid file, kill only that pid, remove the pid file. Never
     broad-kill.
   - `routerReachable(timeoutMs)`: a plain HTTP GET on the health URL, resolves to a
     boolean, non-000 is reachable.
   - `waitForRouterHealthy(timeoutMs)`: poll `routerReachable` until true or timeout, like
     the sidecar's `waitForHealthy`.
   - Do NOT import better-sqlite3 or Next server-only APIs the sidecar control does not;
     match the sidecar module's import surface so it stays usable from a server action.
2. A real generation probe. Add to the status layer (extend
   `src/components/status/dependency-status.ts` or add a sibling): a function that sends a
   tiny text generation through `getLlm()` (a 1-token prompt, text only, short max tokens)
   and returns `"up"` only if generation actually returns text, else the existing
   `reachable_unverified` / `down` states. Reuse `withTimeout` and a sane timeout
   (reuse or extend `LLM_PING_TIMEOUT_MS`). This upgrades the honesty gap the recon named:
   count_tokens 200 is not proof generation works.
3. Server actions in `src/server/actions/` (a new `router-actions.ts` or extend
   settings-actions), mirroring `sidecar-actions.ts`:
   - `startRouterAction()`: calls `startRouter()`, then `waitForRouterHealthy`, returns
     the action-result union already used in the repo (see the shared action-result helper
     the deep-review PR extracted; find it and use it).
   - `stopRouterAction()`.
   - `getRouterStatusAction()`: returns { pidAlive, reachable, generationOk } using the
     probe, for the Settings panel to render live.
4. A settings toggle `routerAutoManage` (boolean, default false to stay safe), following
   the `notifyOnSuccess` end to end pattern: add to `DB_KEY`, `SCHEMA`, `WIRED`, resolver
   defaults, and a `Switch` in a new `src/components/settings/router-section.tsx`. When on,
   the app is allowed to auto-start and auto-restart 9router. When off, the app only
   observes and reports status, never spawns.
5. The auto-restart watchdog. When `routerAutoManage` is on: on app boot / first status
   read, if the router is not reachable, `startRouter()`. Keep it simple and safe: a single
   guarded restart attempt per status check with a cooldown (do not hot-loop). Do NOT build
   a separate cron; hook it into the existing status read path or a lightweight interval
   guarded by the toggle. Never restart when the toggle is off.
6. Settings UI: `router-section.tsx` shows live status (a colored dot plus a label:
   Down / Reachable, generation unverified / Up), the `routerAutoManage` toggle, and
   Start / Stop / Restart buttons wired to the actions. Radius 0, no shadow, matching the
   sidecar section. Add the section to `settings/page.tsx`.

### Test requirements

- Unit test `router-control.ts` the way `sidecar/control.ts` is tested (find the sidecar
  control test and mirror it): pid file read/write, `routerPidAlive` with a fake pid,
  `startRouter` idempotency when already reachable (mock the reachability probe), and that
  `stopRouter` kills only the tracked pid. Mock `spawn` and `process.kill`; do not spawn a
  real process in tests.
- Unit test the generation probe: mock `getLlm()` to return text (up), to throw (down),
  and to answer count_tokens but fail generation (reachable_unverified).
- Do not test the React components with a browser; the controller does visual QA.

## Task 2: auto-analyze in the sync pass

### What exists (from recon, verify before relying)

- `src/server/services/sync-engine.ts`. Auto-pass runs per channel inside `syncOneChannel`
  after scoring at :1407-1416, calling `generateIdeasForNewOutliers(channel.id, {shouldStop, tick})`
  (import :10). Gated off when the run is cancelled (:1407).
- `generateIdeasForNewOutliers` at `src/server/services/ideas.ts:156-214` inner-joins
  `video_analyses` (:174), so it only makes ideas from ALREADY-analyzed outliers. Fresh
  outliers with no analysis are skipped. That is the gap: nothing downloads/transcribes/
  analyzes in the sync path today.
- On-demand pipeline:
  - Download: `downloadVideoAction(videoId)` `src/server/actions/media-actions.ts:24-84`.
    Re-resolves the fresh IG URL (`igClient.resolveMedia`), then `ensureAsset(..., "video")`,
    sets `videos.videoAssetId` (:74-75). The sync-side eager equivalent is
    `tryEnsureAsset(item.videoUrl, "video", ...)` at `sync-engine.ts:1276`.
  - Transcribe: `getOrCreateTranscript(videoId)` `src/server/transcribe/index.ts:54-109`.
    Throws `VideoNotDownloadedError` if `!video.videoAssetId` (:70). Download must precede
    it.
  - Analyze: `getOrCreateAnalysis(videoId)` `src/server/services/analyze.ts:66-119`.
    Cache-first, calls `getOrCreateTranscript` on miss (:91-92), then
    `getLlm().generateParsed` (:97-105), inserts a `video_analyses` row (:107-116). Does
    NOT download; relies on `videoAssetId` being set.
- Outlier threshold used by the ideas pass: `threshold ?? 3`, `cap ?? 20`
  (`ideas.ts:166-167`), filter `gte(videos.outlierScore, threshold)` ordered desc
  (:175-183).
- Idea fill: `generateIdea(videoId)` `ideas.ts:73-133` inserts an `idea` row status
  "inbox". Partial unique index `idea_source_active`.
- Cancellation plumbing: the auto-pass already receives `{shouldStop, tick}`. Reuse it.
- `EAGER_VIDEO_DOWNLOAD`: `src/server/config.ts:59` (`boolish(false)`), read at
  `sync-engine.ts:1275`.

### Requirements

1. New function `autoAnalyzeNewOutliers(channelId, { shouldStop, tick })` in
   `src/server/services/` (a new `auto-analyze.ts`, or beside `generateIdeasForNewOutliers`
   in `ideas.ts` if that reads cleaner). It:
   - Selects unanalyzed outliers for the channel: `videos.outlierScore >= 3`, LEFT JOIN
     `video_analyses` where the analysis row is null, ordered by `outlierScore` desc,
     limited to 10.
   - For each, in order, respecting `shouldStop()` between items (cancelable):
     a. Ensure the video asset. If `videos.videoAssetId` is null, run the download step.
        Reuse the same download path `downloadVideoAction` uses (re-resolve the fresh IG
        URL then `ensureAsset`), NOT the raw stored URL, because IG URLs expire. Factor a
        shared helper if `downloadVideoAction` cannot be called directly from the service
        layer.
     b. `getOrCreateAnalysis(videoId)` (which transcribes on the way).
   - Per-item errors must not abort the whole pass. Catch, log via the existing sync log
     mechanism (see how `syncOneChannel` logs), skip to the next item.
   - Emit progress through `tick` the same way the ideas pass does, so the runs UI shows
     movement.
   - Return a small summary { attempted, analyzed, downloaded, failed } for the run log.
2. Wire it into `syncOneChannel` BEFORE `generateIdeasForNewOutliers`, inside the same
   cancellation gate (:1407), so that after auto-analyze fills `video_analyses`, the
   existing ideas pass turns those analyses into inbox ideas in the same run. Order:
   score, then auto-analyze, then generate ideas.
3. Cost guard: cap is 10 per channel per run, hard-coded is acceptable but prefer a named
   constant near the ideas pass constants. Threshold 3 to match the ideas pass. Do not add
   a settings key for this in this task (keep scope tight); a later task can expose it.
4. Respect existing behavior: if 9router is down, `getOrCreateAnalysis` will throw. Catch
   it per item so a dead router degrades gracefully (the pass logs failures and moves on)
   rather than killing the sync.

### Test requirements

- Unit test `autoAnalyzeNewOutliers` with a seeded in-memory / temp db the way other
  sync-engine and ideas tests seed data (find an existing ideas.ts or sync-engine test and
  mirror its setup):
  - selects only outliers with score >= 3 and no existing analysis, cap 10, order desc.
  - calls download only when `videoAssetId` is null.
  - a per-item throw does not abort the pass (mock `getOrCreateAnalysis` to throw on one
    item, assert the others still process and the summary counts the failure).
  - `shouldStop()` returning true stops the pass early.
- Mock the LLM and the download/transcribe so no network or real model is hit.
- Leave the existing sync-engine and ideas suites green.
