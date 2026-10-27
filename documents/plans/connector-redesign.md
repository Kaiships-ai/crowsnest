---
status: active
components: [connectors]
backlog: none
owner: null
shipped: null
---

# Connector redesign plan

Settings > Sources gets four cards that each show one state, test a key only when Kai presses Test connection, and pull numbers only when Kai presses Pull.
A pull shows the current channel, x of N, the elapsed time and a Stop button, then a summary, and it stops cleanly on an Instagram limit or an empty Graph budget.
The rule is that nothing pulls or tests on its own, and a partial pull never shows as success.
The PRs land in this order. PR-1 (#234), PR-2 (#235 fixed), PR-3 sidecar card, PR-4 Graph card, PR-5 Umami card, PR-6 Polar card, PR-7 remove Groq, PR-8 maintain the connector part of the verify skill.
The approved prototype is https://claude.ai/artifact/JUAatWEbZW1VYkoUZKtAk3 and every card PR builds to it.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-stack.md` from the installed plugin, with the changes in `.agents/playbooks/lead-studio-v1.md`. Every PR here has an external surface (the real database, a migration, the sidecar process, or an outbound call), so every PR is tier complex. Kai merges every PR. Each PR stops at merge-ready after the review gate.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write this exact text into the standing orders and restate it in your todolist. "Plan `documents/plans/connector-redesign.md`. PRs in order PR-1 (#234), PR-2 (#235), PR-3, PR-4, PR-5, PR-6, PR-7, PR-8. Tests alone are not sufficient verification; a PR is verified only when its unit, live, and perf boxes are all checked. Kai merges every PR after screenshots beside the prototype and a video. Done when PR-8 is merged and the post-merge smoke on `main` passes."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `.claude/skills/verify/SKILL.md` in this repo
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/show-me-your-work/SKILL.md`
  - [ ] `.agents/playbooks/lead-studio-v1.md` in this repo
  - [ ] `skills/maintain-verification-skill/SKILL.md`
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing objective. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down ("onhold" or "dừng"), send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Owners run on `opus @medium` in their own worktree, never in Kai's checkout at `~/Desktop/kaiships/crowsnest`.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR-1 is first and targets `main`.
  - [ ] PR-2 after PR-1.
  - [ ] PR-3 after PR-2. It lands the shared pull-progress model that PR-4 and PR-5 reuse.
  - [ ] PR-4 after PR-3.
  - [ ] PR-5 after PR-4.
  - [ ] PR-6 after PR-2. It needs no pull progress.
  - [ ] PR-7 after PR-5, because PR-5 rewrites the funnel group where the Groq card sits.
  - [ ] PR-8 after PR-6 and PR-7 merge, so it audits the finished connector part.
- [ ] Hold the file boundaries. PR-3 alone touches `src/server/services/sync-engine.ts`. PR-4 alone touches `src/server/services/own-measure.ts`. PR-5 alone touches `src/server/connectors/umami/`. PR-6 alone touches `src/server/connectors/polar/`. PR-7 alone touches `src/server/transcribe/` and `src/server/connectors/groq/`. Only PR-3 adds a migration. PR-8 touches only `.claude/skills/verify/`.
- [ ] Hold the review gate. PR-1 through PR-7 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge. PR-8 changes no interaction and still waits for Kai's merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. In this repo they run in CI only (`scripts/heavy.sh` refuses them off CI), so the push to the PR branch is that run. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Before the code-ready report and babysit, and again after merge prep, record the base and head SHAs prepared by the topology owner under the execution playbook.
- [ ] Update `documents/architecture/connectors.md`, `scripts/e2e/cases/connectors.md` and `.claude/skills/verify/features/connectors.md` in the same PR, per CLAUDE.md and `scripts/check-verify-coverage.mjs`.

### Verdict and merge, for every PR

- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh swarm and a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] A clean verdict appends the PR to the linear stack on top of its parent. Kai reviews and merges bottom-up. A rebase that keeps the patch-id keeps the verdict only under the patch-id rule in `playbooks/shipping.md`; anything else goes back through a fresh swarm.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the skill path or exact commands recorded in this boot recipe.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Copy Kai's database, never open it. Run `sqlite3 ~/Desktop/kaiships/crowsnest/data/crowsnest.db ".backup /tmp/swarm-<pr-id>/worker-<n>/crowsnest.db"`.
- [ ] For a lane marked real sidecar, start the sidecar from the lane worktree with `cd services/ig && uv run python -m crowsnest_ig` and export `IG_SERVICE_URL` to its address. Real-sidecar lanes run one at a time, never in parallel, so one Instagram session never sees ten callers.
- [ ] For a lane marked fake sidecar, start `node .claude/skills/verify/scripts/fake-sidecar.mjs` in the mode the lane names and export `IG_SERVICE_URL` to it.
- [ ] Start the app with `APP_DEV=1 APP_REAL_DB=/tmp/swarm-<pr-id>/worker-<n>/crowsnest.db .claude/skills/verify/scripts/app-up.sh --real` and wait for its ready line.
- [ ] Deliver input only through `.claude/skills/verify/scripts/app-drive.sh <journey>`. Read-only diagnostics are `sqlite3 <copy> "select * from connector_status"` and the app log that `app-up.sh` prints.
- [ ] Stop with `.claude/skills/verify/scripts/app-down.sh`. It fails with `app: HOST CHANGED` when the run changed Kai's hooks, and that fails the lane.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Land the real-data connector fixes (PR-1)

**Depends on.** None. PR-1 is #234, already open and green on branch `KineBeo/connector-test`. Keep it unchanged.

**Files.**

- [ ] Edit `src/server/graph/client.ts`. No new change; the PR already drops `reposts` from reel insights.
- [ ] Edit `src/server/connectors/ig-sidecar/index.ts`. No new change; the PR already sends the saved session id.

**Build.**

- [ ] No new code. The owner rebases #234 on current `main` if `main` moved and confirms CI is green at the new head.

**You see.**

- [ ] On the Mine board, a pull of your own channel records reels with no `reposts` error in the app log.
- [ ] With an expired session id, the sidecar card says to sign in to Instagram again.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/graph/client.test.ts` passes in CI at the head SHA. Locally run `pnpm test --project crowsnest src/server/graph/client.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run a Graph pull of your own channel on the database copy at trunk and head. Trunk logs a refused `reposts` metric; head does not. Save `pr1-graph-pull.png`. Pass when head stores every reel and the log has no `reposts` error.
- [ ] Lane 2. Real sidecar. Save the real session id from the database copy, then pull one rival through the bridge `pullConnector`. Save `pr1-rival-pull.png`. Pass when the sidecar log shows the saved session id was used and the rival row updates.
- [ ] Lane 3. Fake sidecar in expired mode. Pull rivals. Save `pr1-expired.png`. Pass when the card text tells you to sign in to Instagram again.
- [ ] Lane 4. Run journey `sidecar-expired-01`. Save `pr1-sidecar-expired-01.png`. Pass when the journey exits 0.
- [ ] Lane 5. Run journey `schedule-01`. Save `pr1-schedule-01.png`. Pass when the journey exits 0 and the only refusal logged is `profile_activity` for reels.
- [ ] Lane 6. Open the Rivals board with no workspace open. Save `pr1-board-no-workspace.png`. Pass when the board opens.
- [ ] Lane 7. Run journey `connectors-01`. Save `pr1-connectors-01.png`. Pass when the journey exits 0.
- [ ] Lane 8. Run journey `sources-01`. Save `pr1-sources-01.png`. Pass when the journey exits 0.
- [ ] Lane 9. Run journey `umami-01`. Save `pr1-umami-01.png`. Pass when the journey exits 0.
- [ ] Lane 10. Quit and relaunch the app on the same copy. Save `pr1-relaunch.png`. Pass when Sources shows the same states as before the quit.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Graph calls used by one own-channel pull, read from `source_calls` on the copy.
- [ ] Probe. Pull your own channel at trunk, then head, then trunk, then head, each on a fresh copy.
- [ ] Baseline. Record the trunk call count first.
- [ ] Rule. Fail when head uses more than trunk plus 5 calls.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 3 screenshots into `test-shots/connector-redesign/pr1-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-1 into `main`.

## Show one saved state per card and remove the pull timers (PR-2)

**Depends on.** PR-1. PR-2 is #235 on branch `KineBeo/connector-status`. Keep its state table and timer removal, fix CI, and remove the card Pull button Kai rejected.

**Files.**

- [ ] Edit `src/server/queries/funnel-board.test.ts`.
- [ ] Edit `src/server/actions/graph-actions.test.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx`.
- [ ] Edit `.claude/skills/verify/features/connectors.md`.

**Build.**

- [ ] In `funnel-board.test.ts` line 94, replace state `"running"` with a `CardState` value (`"ready"`).
- [ ] In `graph-actions.test.ts`, mock `../services/connector-status` so the in-memory database needs no `connector_status` table.
- [ ] In `LeadSourcesPane.tsx`, remove the card Pull button and its blocking `pullConnector` call. No board pulls (a board's refresh only re-reads), so until PR-3, PR-4 and PR-5 add the card pull, pulls run only through the bridge or MCP. Kai lands PR-2 together with PR-3 so the app never lacks a rival pull.
- [ ] Re-approve the `today-01` screenshot baseline, because the Today heading changed.

**You see.**

- [ ] Each Sources card shows exactly one pill. No "Verified" badge, no "next 05:00", no card Pull button.
- [ ] After a day with the app open, `connector_status` has no row written by a timer.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/queries/vault-board.test.ts` keeps a partial pull after a passing check. Run `pnpm test --project crowsnest src/server/queries/vault-board.test.ts`.
- [ ] CI is green at the head SHA, including typecheck and `graph-actions.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open Sources on the copy at trunk and head. Trunk shows a card with two states at once and "next 05:00"; head shows one pill per card. Save `pr2-sources.png`. Pass when every head card has one pill and no timer text.
- [ ] Lane 2. Start the app and wait 3 minutes with no clicks. Save `pr2-idle.png`. Pass when the app log has no pull event and `connector_status` is unchanged.
- [ ] Lane 3. Run journey `card-state-01`. Save `pr2-card-state-01.png`. Pass when the journey exits 0.
- [ ] Lane 4. Run journey `card-state-02` (real quit and relaunch). Save `pr2-card-state-02.png`. Pass when the journey exits 0.
- [ ] Lane 5. Fake sidecar in partial mode. Pull rivals from the Rivals board, then re-check the sidecar key. Save `pr2-partial-kept.png`. Pass when the card stays Partial after the passing check.
- [ ] Lane 6. Fake sidecar in error mode. Pull rivals through the bridge. Save `pr2-error.png`. Pass when the card shows Error with one sentence that says what to do.
- [ ] Lane 7. Run journey `today-01`. Save `pr2-today-01.png`. Pass when the journey exits 0 against the re-approved baseline.
- [ ] Lane 8. Run journey `schedule-01`. Save `pr2-schedule-01.png`. Pass when a scheduled post still publishes, since the publish scheduler stays.
- [ ] Lane 9. Inspect the copy after migration. Save `pr2-migration.png` of the `sqlite3 .tables` output. Pass when `connector_status` exists and `daily_pulls` is gone.
- [ ] Lane 10. Open Sources and check every card for a Pull button. Save `pr2-no-card-pull.png`. Pass when no card has one.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from opening Settings > Sources to all four pills rendered, median of 10 opens.
- [ ] Probe. CDP timing in `app-drive.mjs`, 10 opens at trunk, 10 at head, interleaved by pairs.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Fail when the head median is more than 20 percent above trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 10 screenshots into `test-shots/connector-redesign/pr2-review-<slug>.png`, each beside wireframe C1.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr2-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-2 after PR-1.

## Make the sidecar card switch on, sample, and pull rivals with progress (PR-3)

**Depends on.** PR-2.

**Files.**

- [ ] Create `drizzle/0045_connector_pull_progress.sql` and its journal entry in `drizzle/meta/_journal.json`.
- [ ] Edit `src/server/db/schema.ts`.
- [ ] Edit `src/server/services/connector-status.ts`.
- [ ] Edit `src/server/queries/vault-board.ts`.
- [ ] Edit `src/server/connectors/types.ts`.
- [ ] Edit `src/server/connectors/ig-sidecar/index.ts`.
- [ ] Edit `src/server/services/sync-engine.ts`.
- [ ] Edit `src/server/actions/sync-actions.ts`.
- [ ] Edit `src/server/actions/sidecar-actions.ts`.
- [ ] Edit `src/server/bridge/engine-calls.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx`.
- [ ] Create `src/renderer/src/components/settings/source-pull-progress.tsx`.
- [ ] Create `.claude/skills/verify/scripts/app-journeys/sidecar-pull-01.mjs`.
- [ ] Edit `.claude/skills/verify/scripts/fake-sidecar.mjs`.

**Build.**

- [ ] In migration 0045, widen `connector_status.state` to off, not-connected, checking, ready, pulling, partial and error, and add `progress_done`, `progress_total`, `progress_label`, `started_at`, `retry_after` and `summary` (JSON).
- [ ] In `connector-status.ts`, add `recordPullStart`, `recordPullProgress` and `recordPullEnd`. A `pulling` row older than 10 minutes with no heartbeat reads as Partial, so a crash never leaves a card stuck.
- [ ] Add `sample()` to the adapter in `connectors/types.ts`, and implement it in `ig-sidecar/index.ts` as one profile fetch of your own handle.
- [ ] Every key dialog has a Test connection button that Kai presses. Nothing tests on paste or on save. Save stays disabled until a test passes. A Ready or Error card also has Test connection. For the sidecar, the test is `sample()`.
- [ ] Wire the switch to `startSidecarAction` and `stopSidecarAction`. Off writes state `off`.
- [ ] Start the card pull through `startSyncAction` and its jobId, not the blocking `pullConnector`. The card polls `getSyncProgressAction` once a second while the state is `pulling`.
- [ ] Wire Stop to `cancelSyncAction`. The engine finishes the current rival, then ends as Partial with the done count.
- [ ] In `sync-engine.ts`, stop the whole pull on the first `IG_RATE_LIMITED` and record `retry_after` from `retry_after_sec`. Do not wait and retry inside the pull.
- [ ] When the sidecar process dies during a pull, end as Partial with the done count.
- [ ] `source-pull-progress.tsx` renders the current channel, x of N, the elapsed time, Stop, the long-pull note after 2 minutes, and the summary. PR-4 and PR-5 reuse it.

**You see.**

- [ ] Switch off shows "The sidecar is off. Turn it on to connect Instagram." (C2).
- [ ] Pasting a session id and pressing Test connection shows Testing, then the sample `@handle · N followers · N posts` (C5, C6), and Save turns on.
- [ ] Pull rivals shows `Pulling @handle… 6 / 15 rivals 0:41` with Stop, then the summary with rivals updated, new reels and failed.
- [ ] Stop at 6 of 15 shows Partial, "6 rivals have new numbers. The other 9 keep their numbers".
- [ ] An Instagram limit at 9 of 15 shows Partial and "Pull the rest (6) · after 21:40" disabled until that time.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/services/connector-status.test.ts` gains a case where a stale `pulling` row reads as Partial with its done count. Run `pnpm test --project crowsnest src/server/services/connector-status.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Real sidecar. Pull rivals on the copy at trunk (through the bridge) and at head (from the card). Trunk has no card progress, so record that and gate the head behavior. Save `pr3-pull.png` mid-pull and `pr3-summary.png`. Pass when head shows the current rival, x of N rising, elapsed time and Stop, and ends with a summary whose updated count matches the rows changed in the copy.
- [ ] Lane 2. Real sidecar. Switch the sidecar off, then on. Save `pr3-off.png` and `pr3-on.png`. Pass when off shows C2 text and on reaches Not connected or Ready, and the sidecar process list matches the switch.
- [ ] Lane 3. Real sidecar. Save the real session id. Save `pr3-sample.png`. Pass when the card shows your own handle with a follower count equal to the sidecar `/profile` answer.
- [ ] Lane 4. Real sidecar. Start a pull, press Stop at about 5 of N. Save `pr3-stopped.png`. Pass when the card shows Partial with done equal to the rows updated in the copy and the other rivals unchanged.
- [ ] Lane 5. Fake sidecar in rate-limit mode at rival 9. Pull rivals. Save `pr3-limited.png`. Pass when the pull ends at 9, the card shows the retry time from `retry_after_sec`, and the button stays disabled until then.
- [ ] Lane 6. Fake sidecar in slow mode (10 seconds per rival). Pull 15 rivals. Save `pr3-long.png` after 2 minutes. Pass when the long-pull note appears and the pill stays Pulling.
- [ ] Lane 7. Fake sidecar. Kill the sidecar process during a pull. Save `pr3-off-mid.png`. Pass when the card shows Partial with the done count within 15 seconds.
- [ ] Lane 8. Fake sidecar in expired mode. Paste a session id and press Test connection. Save `pr3-expired.png`. Pass when the dialog shows C7 text, Save stays disabled, and no pull starts.
- [ ] Lane 9. Start a pull, open another settings page, come back. Save `pr3-return.png`. Pass when the card still shows progress and x of N kept rising.
- [ ] Lane 10. Start a pull, quit the app mid-pull, relaunch on the same copy. Save `pr3-crash.png`. Pass when the card shows Partial with the done count, not Pulling.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time per rival for a 15-rival pull against the fake sidecar at a fixed 1 second per answer, so polling cost shows and Instagram speed does not.
- [ ] Probe. Pull at trunk through the bridge, then at head from the card, interleaved 3 times each.
- [ ] Baseline. Record the trunk seconds per rival first.
- [ ] Rule. Fail when head is more than 10 percent slower per rival than trunk, or when the progress poll costs more than 1 call a second.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 4 and 5 screenshots into `test-shots/connector-redesign/pr3-review-<slug>.png`, each beside its prototype state.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-3 after PR-2.

## Make the Graph card check the token and pull your channel with progress (PR-4)

**Depends on.** PR-3.

**Files.**

- [ ] Edit `src/server/connectors/instagram-graph/index.ts`.
- [ ] Edit `src/server/services/own-measure.ts`.
- [ ] Edit `src/server/actions/graph-actions.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx`.
- [ ] Create `.claude/skills/verify/scripts/app-journeys/graph-pull-01.mjs`.
- [ ] Edit `.claude/skills/verify/scripts/fake-graph.mjs`.

**Build.**

- [ ] Test connection in the dialog calls `/me` and shows the user id and handle (C9). Save stays disabled until the test passes. A rejected token shows its error inside the dialog. The card keeps a Test connection button.
- [ ] Show the days left on the token when Graph returns an expiry; hide the line when it does not.
- [ ] In `runMeasure`, call `recordPullProgress` after each post with the post caption as the label, and check a cancel flag between posts.
- [ ] Turn `stoppedEarly: "budget"` into Partial with `retry_after` set to the oldest call in the last hour plus one hour, read from `source_calls`.
- [ ] Reuse `source-pull-progress.tsx` for progress, Stop, the long note and the summary.

**You see.**

- [ ] Pull my channel shows `Pulling post "…" 24 / 50 posts` with calls left this hour and Stop.
- [ ] An empty budget at 31 of 50 shows "Pulled 31/50 posts. The 200 calls for this hour are used up." and "Pull the rest (19) · after 22:05" (C11).

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/services/own-measure.test.ts` gains a case where the budget ends at post 31 and the result is Partial with a retry time one hour after the oldest call. Run `pnpm test --project crowsnest src/server/services/own-measure.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Real Graph token from the copy. Pull your own channel at trunk (bridge) and head (card). Trunk has no card progress, so record that and gate the head behavior. Save `pr4-pull.png` and `pr4-summary.png`. Pass when head shows x of N rising and the summary post count equals the rows written in the copy.
- [ ] Lane 2. Real Graph token. Paste it in the dialog and press Test connection. Save `pr4-token-check.png`. Pass when the dialog shows your handle and id from `/me` before Save.
- [ ] Lane 3. Fake Graph with a budget of 62 calls. Pull 50 posts. Save `pr4-partial.png`. Pass when the card shows Partial at the post where the budget ran out and the retry time from `source_calls`.
- [ ] Lane 4. Fake Graph. Press Stop at about 12 posts. Save `pr4-stopped.png`. Pass when the card shows Partial with the done count.
- [ ] Lane 5. Fake Graph returning an expired token error. Save `pr4-expired.png`. Pass when the card shows Error and tells you to get a new token.
- [ ] Lane 6. Fake Graph in slow mode. Save `pr4-long.png` after 2 minutes. Pass when the long-pull note appears.
- [ ] Lane 7. Paste an expired token in the dialog and press Test connection. Save `pr4-dialog-error.png`. Pass when the error shows inside the dialog and Save stays disabled. Then start a Graph pull and a rival pull together. Save `pr4-both.png`. Pass when both cards show their own progress.
- [ ] Lane 8. Quit mid-pull and relaunch. Save `pr4-crash.png`. Pass when the card shows Partial, not Pulling.
- [ ] Lane 9. Run journey `schedule-01`. Save `pr4-schedule-01.png`. Pass when the journey exits 0.
- [ ] Lane 10. Run journey `graph-pull-01`. Save `pr4-graph-pull-01.png`. Pass when the journey exits 0.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Graph calls and wall time for a 50-post pull against the fake Graph.
- [ ] Probe. Pull at trunk, then head, interleaved 3 times each.
- [ ] Baseline. Record the trunk calls and seconds first.
- [ ] Rule. Fail when head makes any extra Graph call per post, or is more than 10 percent slower.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2 and 3 screenshots into `test-shots/connector-redesign/pr4-review-<slug>.png`, each beside C9, C10, C11 or its prototype state.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-4 after PR-3.

## Connect Umami with an API key and pull the funnel with progress (PR-5)

**Depends on.** PR-4.

**Files.**

- [ ] Edit `src/server/connectors/umami/index.ts`.
- [ ] Edit `src/server/connectors/umami/pull.ts`.
- [ ] Edit `src/server/connectors/umami/umami.test.ts`.
- [ ] Edit `src/server/services/funnel.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx`.
- [ ] Edit `.claude/skills/verify/scripts/fake-umami.mjs`.

**Build.**

- [ ] Replace the username and password login in `pull.ts` with the API key sent as `Authorization: Bearer <key>`. Delete the `/api/auth/login` path.
- [ ] The dialog takes the Umami address and the key (C12). Test connection checks them. It lists websites from `/api/teams/<id>/websites` for each team plus `/api/websites`. One website is picked for you; two or more show a Website picker. Save stays disabled until the test passes. A 401 or an unreachable address shows its error inside the dialog.
- [ ] Report progress per events page of `/api/websites/<id>/events`, with Stop between pages.
- [ ] A 401 shows C13. A network failure shows "Cannot reach <address>".

**You see.**

- [ ] Test connection with the real key shows "Key works · website kai-ships-ai-website.vercel.app", and Save turns on.
- [ ] Pull funnel shows `page 7 / 19` and ends with a summary of gift page visits, email signups and checkout clicks.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/connectors/umami/umami.test.ts` gains a case where the key is sent as Bearer, the website is found under a team, and a 401 maps to the C13 message. Run `pnpm test --project crowsnest src/server/connectors/umami/umami.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Real Umami at `https://umami-kaiships.vercel.app` with the key from `.env` `UMAMI_TOKEN`. Trunk cannot use an API key, so record that and gate the head behavior. Save `pr5-pull.png` and `pr5-summary.png`. Pass when head pulls every page of the last 30 days and the summary counts match the funnel board.
- [ ] Lane 2. Real Umami. Fill the address and key, press Test connection. Save `pr5-connect.png`. Pass when the dialog names `kai-ships-ai-website.vercel.app`.
- [ ] Lane 3. Real Umami with a wrong key. Save `pr5-401.png`. Pass when the card shows C13.
- [ ] Lane 4. Fake Umami unreachable. Save `pr5-unreachable.png`. Pass when the card says it cannot reach the address.
- [ ] Lane 5. Real Umami. Press Stop at about page 5. Save `pr5-stopped.png`. Pass when the card shows Partial with the page count.
- [ ] Lane 6. Fake Umami with two websites. Save `pr5-pick.png`. Pass when the dialog asks you to pick one.
- [ ] Lane 7. Real Umami. Type a wrong address in the dialog and press Test connection. Save `pr5-bad-address.png`. Pass when the dialog says it cannot reach the address and Save stays disabled. Then run fake Umami in slow mode. Save `pr5-long.png` after 2 minutes. Pass when the long-pull note appears.
- [ ] Lane 8. Run journey `umami-01`, updated for the key. Save `pr5-umami-01.png`. Pass when the journey exits 0.
- [ ] Lane 9. Open the Funnel board after a pull. Save `pr5-funnel-board.png`. Pass when its numbers match the card summary.
- [ ] Lane 10. Quit and relaunch. Save `pr5-relaunch.png`. Pass when the card shows the same state and the key is still saved.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time to pull 30 days from the real Umami (19 pages at about 3 seconds each when measured by hand).
- [ ] Probe. Head pull 3 times against `https://umami-kaiships.vercel.app`. Trunk cannot pull with a key, so time the same pages with `curl` at trunk as the floor.
- [ ] Baseline. Record the `curl` floor first.
- [ ] Rule. Fail when the head pull takes more than the floor plus 15 percent, or more than 90 seconds end to end.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2 and 3 screenshots into `test-shots/connector-redesign/pr5-review-<slug>.png`, each beside C12, C13 or its prototype state.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-5 after PR-4.

## Test the Polar token from its dialog (PR-6)

**Depends on.** PR-2.

**Files.**

- [ ] Edit `src/server/connectors/polar/index.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx`.
- [ ] Create `.claude/skills/verify/scripts/fake-polar.mjs`.
- [ ] Create `.claude/skills/verify/scripts/app-journeys/polar-01.mjs`.

**Build.**

- [ ] Give Polar an adapter whose `test()` calls `GET /v1/organizations` with the token and returns the organization name.
- [ ] Test connection in the dialog shows the organization name. Save stays disabled until the test passes. A rejected token shows its error inside the dialog. The card has no Pull button and says pulling orders comes later.

**You see.**

- [ ] Pressing Test connection with a valid token shows Testing, then "Token works · organization <name>", and Save turns on.
- [ ] A rejected token shows "Polar rejected the token (401)".

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/connectors/polar/polar.test.ts` gains cases for a 200 with one organization and a 401. Run `pnpm test --project crowsnest src/server/connectors/polar/polar.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Enter a Polar token at trunk and head and test it. Trunk says Polar is not connected whatever the token; head checks it. Save `pr6-check.png`. Pass when head shows the organization name.
- [ ] Lane 2. Real Polar token, if Kai provides one. Save `pr6-real.png`. Pass when the organization name matches Polar. Without a token, the lane records that and uses the fake.
- [ ] Lane 3. Fake Polar 401. Save `pr6-401.png`. Pass when the card shows the rejected message.
- [ ] Lane 4. Fake Polar unreachable. Save `pr6-unreachable.png`. Pass when the card shows Error with what to do.
- [ ] Lane 5. Paste a wrong token in the dialog and press Test connection. Save `pr6-dialog-error.png`. Pass when the error shows inside the dialog, Save stays disabled, and Cancel leaves the card unchanged.
- [ ] Lane 6. Replace a valid token with a wrong one. Save `pr6-replace.png`. Pass when the card moves from Ready to Error.
- [ ] Lane 7. Quit and relaunch. Save `pr6-relaunch.png`. Pass when the state persists.
- [ ] Lane 8. Check every card for a Polar Pull button. Save `pr6-no-pull.png`. Pass when there is none.
- [ ] Lane 9. Run journey `polar-01`. Save `pr6-polar-01.png`. Pass when the journey exits 0.
- [ ] Lane 10. Run journey `sources-01`. Save `pr6-sources-01.png`. Pass when the journey exits 0.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from Save to the Ready pill against the fake Polar.
- [ ] Probe. 10 saves at head. Trunk has no check, so time a save at trunk to its Not connected pill as the floor.
- [ ] Baseline. Record the trunk floor first.
- [ ] Rule. Fail when the head median is above the floor plus 1.5 seconds.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 3 screenshots into `test-shots/connector-redesign/pr6-review-<slug>.png`, each beside C14 or its prototype state.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-6 after PR-2.

## Remove Groq and keep only local whisper (PR-7)

**Depends on.** PR-5.

**Files.**

- [ ] Delete `src/server/connectors/groq/index.ts` and `src/server/connectors/groq/manifest.ts`.
- [ ] Delete `src/server/transcribe/groq.ts` and `src/server/transcribe/groq.test.ts`.
- [ ] Edit `src/server/mcp/mcp-server.ts`, `src/server/providers/types.ts` and `src/server/connectors/registry.ts`.
- [ ] Edit `src/renderer/src/components/settings/LeadSourcesPane.tsx` and `src/renderer/src/i18n/locales/en.json`.
- [ ] Edit `documents/architecture/external-services.md`, `documents/architecture/mcp.md` and `documents/architecture/onboarding.md`.

**Build.**

- [ ] Find every caller with GitNexus `impact` on the Groq symbols, then delete them in one wave.
- [ ] Transcription calls local whisper only. A missing whisper says how to install it.

**You see.**

- [ ] Sources has no Groq card.
- [ ] Transcribing a reel from the MCP uses local whisper and returns text.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `src/server/connectors/registry.test.ts` lists the connectors without Groq. Run `pnpm test --project crowsnest src/server/connectors/registry.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Transcribe one reel through the MCP at trunk and head. Save `pr7-transcribe.png`. Pass when head returns text from local whisper and makes no request to Groq.
- [ ] Lane 2. Open Sources. Save `pr7-sources.png`. Pass when there is no Groq card.
- [ ] Lane 3. Copy with a saved Groq key. Start the app. Save `pr7-old-key.png`. Pass when the app starts with no error and the key is ignored.
- [ ] Lane 4. Hide the whisper binary from PATH. Transcribe. Save `pr7-no-whisper.png`. Pass when the error says how to install whisper.
- [ ] Lane 5. Run `bash .claude/skills/verify/scripts/mcp.sh` tool list. Save `pr7-mcp.png`. Pass when no tool mentions Groq.
- [ ] Lane 6. Run journey `connectors-01`. Save `pr7-connectors-01.png`. Pass when the journey exits 0.
- [ ] Lane 7. Run journey `sources-01`. Save `pr7-sources-01.png`. Pass when the journey exits 0.
- [ ] Lane 8. Run journey `today-01`. Save `pr7-today-01.png`. Pass when the journey exits 0.
- [ ] Lane 9. Search the built app bundle for `groq`. Save `pr7-grep.png`. Pass when nothing matches outside third-party code.
- [ ] Lane 10. Run the onboarding flow on a fresh copy. Save `pr7-onboarding.png`. Pass when no step asks for Groq.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds to transcribe one 60-second reel.
- [ ] Probe. Transcribe the same reel at trunk with Groq off and at head, 3 times each, interleaved.
- [ ] Baseline. Record the trunk local-whisper time first.
- [ ] Rule. Fail when head is more than 10 percent slower than trunk local whisper.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 2 screenshots into `test-shots/connector-redesign/pr7-review-<slug>.png`, lane 2 beside wireframe C1.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `test-shots/connector-redesign/pr7-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-7 after PR-5.

## Maintain the connector part of the verify skill (PR-8)

**Depends on.** PR-6 and PR-7.

**Files.**

- [ ] Edit `.claude/skills/verify/features/connectors.md`.
- [ ] Edit `.claude/skills/verify/features/funnel.md` where it describes the Umami pull.
- [ ] Edit `.claude/skills/verify/features/README.md`.
- [ ] Edit the connector journeys and fakes under `.claude/skills/verify/scripts/` that the live pass proves wrong.

**Build.**

- [ ] Run `/maintain-verification-skill` scoped to the connector features (`connectors.md` and the Umami part of `funnel.md`). Edit only `.claude/skills/verify/`, never product code.
- [ ] Index hygiene. Every connector journey (`connectors-01`, `sources-01`, `umami-01`, `sidecar-session-01`, `sidecar-expired-01`, `card-state-01`, `card-state-02`, `sidecar-pull-01`, `graph-pull-01`, `polar-01`) is listed once, with no entry for a deleted journey and none for Groq.
- [ ] Source wave. One read-only reader per connector (sidecar, Graph, Umami, Polar, the shared card state) on `sonnet @medium`. Each returns how the card works from source, cited drift, and one live recipe.
- [ ] Rewrite stale text the source wave proves wrong, such as the four Umami secrets with username and password, Re-check, the "Known product gaps" paragraph PR-1 fixed, and Groq.
- [ ] Bring the fakes up to the real services. `fake-umami.mjs` takes a Bearer key and lists the website under a team; `fake-sidecar.mjs` has rate-limit, slow and expired modes; `fake-graph.mjs` has a call budget; `fake-polar.mjs` answers `/v1/organizations`.
- [ ] Record a product gap the live pass finds as a GitHub issue labelled `backlog` and `area:connectors`, never as a doc fix.

**You see.**

- [ ] `features/connectors.md` describes the four cards as the approved prototype shows them, with Test connection, Pull progress, Stop, the summary and the limit states.
- [ ] Every connector journey passes on a fresh `run-all.sh`, and the run notes list each feature as covered or `verified-unreachable` with its prerequisite.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `bash scripts/skill-lint.sh`, `node scripts/check-doc-paths.mjs` and `node scripts/check-verify-coverage.mjs` pass locally and in CI.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `run-all.sh` at trunk and head. Save `pr8-run-all.png` of the report. Pass when head passes every connector journey and drops none that trunk passed.
- [ ] Lane 2. Real sidecar. Drive the sidecar card by the recipe in `connectors.md` alone, without reading code. Save `pr8-sidecar.png`. Pass when every step in the doc matches the screen.
- [ ] Lane 3. Real Graph token. Drive the Graph card by the doc alone. Save `pr8-graph.png`. Pass when every step matches.
- [ ] Lane 4. Real Umami. Drive the Umami card by the doc alone. Save `pr8-umami.png`. Pass when every step matches.
- [ ] Lane 5. Fake Polar. Drive the Polar card by the doc alone. Save `pr8-polar.png`. Pass when every step matches.
- [ ] Lane 6. Run `sidecar-pull-01` with the fake in rate-limit mode. Save `pr8-limited.png`. Pass when the journey exits 0 and the doc names the mode.
- [ ] Lane 7. Run `graph-pull-01` with the budget fake. Save `pr8-budget.png`. Pass when the journey exits 0.
- [ ] Lane 8. Run `umami-01` against the updated `fake-umami.mjs`. Save `pr8-umami-01.png`. Pass when it uses a Bearer key and finds the team website.
- [ ] Lane 9. Run `card-state-02`. Save `pr8-card-state-02.png`. Pass when the journey exits 0.
- [ ] Lane 10. Search `.claude/skills/verify/` for `Groq`, `UMAMI_PASSWORD` and `Re-check`. Save `pr8-grep.png`. Pass when nothing matches.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of the connector journeys inside `run-all.sh`.
- [ ] Probe. Run the connector journeys at trunk, then head, interleaved twice.
- [ ] Baseline. Record the trunk seconds first.
- [ ] Rule. Fail when head takes more than 20 percent longer, since harness fixes must not add waits.

**Review gate.** None. PR-8 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Kai merges PR-8 after PR-6 and PR-7.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Run the post-merge smoke on `main` (`app-up.sh --seed`, `app-drive.sh shell-01`, and the Sources journeys).
- [ ] Delete this plan in the last PR's follow-up, since it shipped.
- [ ] Reply to the operator with the report the execution playbook names, plus a table of work, output, evidence and status.

## Appendix A. Prototype evidence

The prototype is https://claude.ai/artifact/JUAatWEbZW1VYkoUZKtAk3, approved by Kai. It shows 55 states across the four cards, including every key-entry dialog with its checking, success and error forms,, marks each as a wireframe state (C2 to C14) or new, and plays nine journeys. A Playwright click-through of every journey at 1100 px dark and 400 px light found no script error and no sideways scroll.

Live checks of other systems, done before this plan.

- Umami at `https://umami-kaiships.vercel.app` accepts the `UMAMI_TOKEN` key as `Authorization: Bearer` (200) and refuses it as `x-umami-api-key` (401). `/api/websites` returns no website for this admin user; the one website, `kai-ships-ai-website.vercel.app`, is under team `kaiships` at `/api/teams/<id>/websites`. The events endpoint returned 1,825 events for the last 30 days at 100 per page in about 2.9 seconds a page.
- The sidecar was not running on port 8765 when checked, so the boot recipe starts it per lane.
- Code reading (no run) found that the rival pull already writes `sync_jobs` progress and supports `cancelSyncAction`, that the sidecar returns `retry_after_sec`, and that Graph gives no retry hint.

Unproven. Whether the sidecar switch works in the packaged Kit, where a launchd helper runs the sidecar. Whether Graph returns a token expiry for this token type. Whether Kai has a Polar token for lane 2 of PR-6.

## Appendix B. Alternatives rejected

- Close #235 and rebuild the state table inside PR-3 (option B). It redoes work that is right and needs only two test fixes, so Kai chose A.
- Keep #235's card Pull button until PR-3. Kai did not approve that Pull, so it leaves in PR-2. No board pulls, so PR-2 lands together with PR-3.
- A push channel from main to renderer for progress. Nothing like it exists, and a one-second poll of `getSyncProgressAction` already reads the same data.
- Wait and retry inside a pull on an Instagram limit. It holds the card in Pulling for up to 30 minutes and keeps calling a limited account.
- One big PR for all cards. Kai wants one card per PR, each usable end to end.

## Appendix C. Risks

- PR-3. Real-sidecar lanes share Kai's Instagram session. Run them one at a time and keep rate-limit, expired and crash lanes on the fake sidecar. The owner watches for `IG_RATE_LIMITED` in the real lanes and stops the lane if it appears.
- PR-4. Real Graph lanes spend Kai's 200 calls an hour. Only lanes 1 and 2 use the real token, and they never run in the same hour as Kai's own pull.
- PR-3. A crash mid-pull could leave a card in Pulling. The stale-heartbeat rule turns it into Partial; lane 10 proves it.
- PR-3. The migration changes `connector_status` on Kai's real database when he updates. The lanes run it on a copy first.
- PR-5. The Umami key is a secret. Lanes read it from `.env` and never print it; receipts show only its length.
- PR-8. A journey that passes only against a fake can hide drift from the real service. Lanes 2 to 4 drive the real sidecar, Graph and Umami by the doc alone.
- PR-7. Transcription loses its cloud fallback. Lane 4 proves the missing-whisper message.
- PR-3. The switch may not control the Kit's launchd sidecar. Recorded as unproven; the Kit is not shipping yet.

## Appendix D. Links and reading list

- Spec and wireframes C1 to C14, approved on 2026-10-27, and the prototype in Appendix A.
- `documents/architecture/connectors.md`, `documents/architecture/ig-sync.md`, `documents/architecture/jobs-and-failures.md`, `DESIGN.md` and `docs/STYLEGUIDE.md` before any edit.
- PR-3 gets `skills/how/SKILL.md` on the sync engine before editing, and `skills/interrogate/SKILL.md` on the migration and the stop rule.
- PR-4 gets `skills/interrogate/SKILL.md` on the budget retry time.
- PR-8 runs `skills/maintain-verification-skill/SKILL.md`.
- The root keeps a decision trail per `skills/show-me-your-work/SKILL.md` at `.audit/connector-redesign.tsv`.
