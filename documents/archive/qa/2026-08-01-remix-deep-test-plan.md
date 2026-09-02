# Remix studio deep test plan, 2026-08-01

Follow-up to the earlier smoke run's note about a stale "Connection error" sitting
in the Hook stage's run log from a prior offline 9router session. That note is the
seed for this plan's most severe finding: reading the code shows that entry is not
just cosmetic leftover, it is load-bearing. Once written, nothing in this app ever
clears it, and everything downstream treats its mere presence as current truth.

The chain, confirmed by reading the code, not guessed:

- `src/components/remix/remix-studio.tsx:125` computes exactly one `proxyDown`
  boolean per page load: `runs !== null && isProxyLikelyDown(runs)`. That single
  value is handed unchanged to `StageHook` (`:214`), `StageStyle` (`:227`), and
  `StageScript` (`:238`), so the three stages are not evaluated independently.
- `src/components/remix/run-log-view.ts:77-79` (`isProxyLikelyDown`) looks at the
  three most recent rows in the whole session's run log, regardless of age, and
  returns true if any of them look like a connection failure.
- When `proxyDown` is true, each generation stage renders
  `src/components/remix/generation-blocked.tsx`'s "proxy-down" branch
  (`:43-59`) instead of its normal controls. That branch has no button, no retry
  action, nothing but static text telling the user to go start the proxy in a
  terminal.
- `src/server/services/remix.ts:181-194` (`getOrCreateSession`) reuses the same
  session row for a video indefinitely, at any stage, forever. There is no
  "start a new attempt" affordance anywhere in this surface.

Put together: the only way a new run row gets written is by successfully
reaching a stage's Generate button, and the only way to reach that button is for
`proxyDown` to already be false. A single connection failure, on any one of the
three generation stages, permanently locks all three generation stages for that
video's session, including ones that were never even attempted, with no
in-app recovery path. A page reload does not help, since it re-reads the same
run log rows. This reads as the actual root cause behind the smoke run's
observation, not a rendering quirk.

This plan tests that finding plus 8 others turned up in the same read of
`src/app/(shell)/feed/[videoId]/remix/page.tsx`, `src/components/remix/*`, and
`src/server/services/remix.ts`, `src/server/queries/remix-runs.ts`,
`src/server/services/similar.ts`, `src/server/db/schema.ts`.

Every case here is read-only against `http://localhost:3000`. None of them click
a Generate/Regenerate/Write script/Quick Remix control, since those spend real
LLM quota through the 9router proxy. Cases that need a mid-pipeline session state
a fresh dev DB is unlikely to already have (a session sitting mid-Style, two
sessions racing for one video) are marked "needs fixture" and get a
code-reading verdict instead of a browser step list. Where a case's fixture
requirement is uncertain (depends on what state the shared dev DB happens to be
in), Steps branch on what is actually found.

## Bug candidates found in this read

1. **Most severe.** Global, unscoped, permanent proxy-down lock. `proxyDown`
   (`remix-studio.tsx:125`) is one value shared by Hook/Style/Script
   (`:214`, `:227`, `:238`), sourced from `isProxyLikelyDown`
   (`run-log-view.ts:77-79`), which never expires a stale row by age. Combined
   with `getOrCreateSession` reusing sessions forever (`remix.ts:181-194`) and
   `generation-blocked.tsx`'s proxy-down branch (`:43-59`) having no retry
   button, a single old connection failure permanently blocks generation on a
   video with no way back in through the UI. Likely real, high severity.

2. **High.** `handleContinue` and `handleRestart` (`remix-studio.tsx:140-166`)
   both call `patchSession(...)`, updating the local "furthest stage reached"
   state, and then `await updateStageAction(...)` without checking `.ok` and
   without the `autosave()` wrapper every other write in this file uses
   (compare `:86-90`, and every stage component's own writes, e.g.
   `stage-prompt.tsx:55`, `stage-hook.tsx:90`). A failed persist here leaves the
   UI showing progress that a reload will silently discard, with zero toast:
   the one write path in the whole studio that doesn't tell the user when it
   fails. Likely real.

3. **Medium.** `getOrCreateSession` (`remix.ts:181-194`) is a plain
   select-then-insert with no transaction, and `remix_sessions` has no unique
   index or constraint on `sourceVideoId` (`src/server/db/schema.ts:250-264`).
   Two concurrent requests for the same never-remixed video (two tabs opened at
   once, for instance) can each see "no existing session" and each insert one,
   leaving two session rows for one video. Whichever was updated more recently
   silently wins every later `getOrCreateSession` call, orphaning the other
   tab's in-progress state with no warning. Plausible, needs a race to trigger,
   see the needs-fixture note below.

4. **Medium.** `canContinue` for the Research stage is hardcoded `true`
   (`remix-studio.tsx:136`), the only one of the five gates that isn't a real
   condition. A user can click Continue to Hook while
   `session.researchNotes` is still `null` and `StageResearch` is showing its
   loading skeleton (`stage-research.tsx:61-69`). Probably intentional,
   research is framed as optional groundwork the later stages read
   defensively (`session.researchNotes?.facts || undefined`, `remix.ts:272`,
   `:318`, `:367`), but it is the one gate in the stepper that isn't actually
   gating anything, worth confirming live.

5. **Low.** `StageResearch`'s auto-build effect (`stage-research.tsx:44-57`)
   has no failure branch. If `buildResearchAction` returns `{ ok: false }`, the
   `.then()` callback does nothing: no toast, no fallback copy, and the stage
   is stuck on "Assembling research from the source video..." forever with no
   sign anything went wrong.

6. **Low.** `getSimilarOutliers` (`src/server/services/similar.ts:62-98`) has
   no minimum-similarity floor. Every analyzed, non-deleted video other than the
   source is a candidate, ranked by `scoreSimilarity` (`:27-34`) then
   `outlierScore`, including a candidate that scores exactly 0 (no shared
   hookType, no shared tags at all). In a small dataset this can surface a
   video with nothing in common with the source under the label "Similar
   tracked outliers" (`stage-research.tsx:159-179`), with no on-screen signal
   that its relevance is zero.

7. **Low.** `handleQuickRemix` (`remix-studio.tsx:168-183`) checks
   `result.ok` from `quickRemixAction` but not from the follow-up
   `getOrCreateSessionAction` refetch (`:176-181`, `if (refreshed.ok) {...}`
   with no `else`). If that second call fails, the UI keeps showing
   pre-Quick-Remix state with no error toast even though the database was
   actually fully updated by the first call. Needs fixture (a way to make the
   second call fail independently of the first) to confirm live; noted for the
   record.

8. **Informative, likely by design.** Only "furthest stage reached"
   (`session.stage`) is persisted; the stage the user is actively looking at is
   not. `activeStage`'s initial value on every mount is
   `deepLinkSeed.activeStage`, which resolves to `session.stage` absent a deep
   link (`deep-link.ts:65`). So clicking Back to review an earlier stage, then
   reloading the page, snaps forward to the furthest stage again rather than
   staying where you were looking. Not obviously a bug, "resume where you left
   off" is a documented goal (`remix.ts:178-179`), but it means "where you
   left off" means furthest, not last-viewed, which is worth confirming matches
   intent.

9. **Needs fixture, noted for the record.** `canContinue`'s Style-stage check
   is `Boolean(session.outline)` (`remix-studio.tsx:138`), a truthy-object
   check. `session.outline = { beats: [] }` is a truthy object, so a Style
   generation that (or a manual edit that) leaves zero beats would still pass
   the gate into Script. Cannot be produced without a real generation call or
   direct DB seeding; not exercised by this plan.

## A. The permanent proxy-down lock (candidate 1)

### TC-RX-A1: A video with a prior connection failure loads straight into the block, on every generation stage
Steps:
1. Find a video whose remix session already has a Hook-, Style-, or
   Script-stage run log entry reading roughly "Connection error" (the smoke
   run's own video is the known candidate; if unsure which one, open
   `/feed/[videoId]/remix` for a video you know was remixed during an earlier
   offline-proxy session).
2. Land on the Hook stage. Read the panel.
3. Click the stepper's "Style" segment (only enabled if Style is within the
   furthest reached stage). Read the panel.
4. Click "Script" the same way, if reachable.
Expected: every one of Hook/Style/Script that renders shows the
`GenerationBlocked` "proxy-down" copy ("... is blocked, nothing answered at
<proxy URL>" or the no-URL fallback), not the normal generate controls, even
for a stage that itself never had a failed attempt. Confirms the single shared
`proxyDown` flag applies uniformly (finding 1).

### TC-RX-A2: The block has no retry action anywhere in its own surface
Steps:
1. From the blocked state in TC-RX-A1, read every interactive element on the
   page: buttons, links.
Expected: the only clickable elements are unrelated to retrying generation
(the stepper's own segments, Back/Restart in the footer, the "Add API key in
Settings" link on the no-key branch if that ever shows instead). The
proxy-down branch itself (`generation-blocked.tsx:43-59`) contributes zero
buttons. There is no "Retry" or "Check connection" control anywhere on the
blocked stage.

### TC-RX-A3: A page reload does not clear the block
Steps:
1. From the blocked state in TC-RX-A1, hard-reload the page.
2. Re-check the Hook stage.
Expected: still blocked, same copy. The run log driving `proxyDown` is
unchanged by a reload (it is the same DB rows), so this should reproduce
identically. If reload does clear it, the finding needs revising; check
whether the run log actually shows a newer, successful row that this test
missed.

### TC-RX-A4: The run log itself still shows the old failure, dated
Steps:
1. From the blocked Hook stage, scroll to the run log panel below the (empty)
   stage body.
2. Read the top-most (newest) row's relative time and detail text.
Expected: a row reading roughly "Connection error" or similar, with a relative
time that is old (hours/days, not "just now", since no new attempt has been
made). This is the direct, visible evidence for finding 1: the block is being
driven by a run that is not recent.

## B. Stepper gating and furthest-stage persistence

### TC-RX-B1: Stages past the furthest reached are disabled, not just unstyled
Steps:
1. On a session that has only reached "prompt" or "research" (a lightly-used
   video, if one exists; otherwise use any session and note its furthest
   stage), inspect the Hook/Style/Script stepper segments.
Expected: segments beyond the furthest reached stage render with the dimmed
`text-muted-foreground/50` treatment and are non-interactive (`disabled`,
`stepper.tsx:47`); clicking them does nothing, no navigation, no console
error.

### TC-RX-B2: Reached stages stay clickable to jump backward
Steps:
1. On a session with furthest stage "hook" or later, click "Prompt" in the
   stepper from a later stage.
2. Click back to whatever the furthest stage is.
Expected: navigation between any two reached stages works via the stepper with
no data loss; the Prompt stage still shows its previously-entered topic when
revisited (see section F for the corresponding write path).

### TC-RX-B3: Reload snaps back to the furthest stage, not the last-viewed one (candidate 8)
Steps:
1. On a session whose furthest stage is "style" or "script", start on that
   furthest stage, then click back in the stepper to "hook" (an earlier, also
   reached stage).
2. Hard-reload the page.
Expected per the code read: the page reloads directly onto the furthest stage
(e.g. "style"), not back onto "hook" where you last were looking, because only
`session.stage` (furthest) is persisted and `activeStage` always initializes
from it (`deep-link.ts:65`). If it instead reopens on "hook," the finding needs
revising; there would have to be a persistence path for `activeStage` this
read missed.

## C. Session identity and reuse

### TC-RX-C1: Revisiting a video's remix page reuses the same session, not a fresh one
Steps:
1. Open `/feed/[videoId]/remix` for a video with an existing session (any
   stage past "prompt", so there's a visible topic or hook to check).
2. Note the topic text and furthest stage shown.
3. Navigate away (e.g. Back to Video Detail), then return to the same remix
   URL.
Expected: identical topic text and identical furthest stage both times, same
underlying session row, per `getOrCreateSession`'s "reuse the latest session
for this video" behavior (`remix.ts:181-194`).

### TC-RX-C2: A different video's remix page never shows another video's session state
Steps:
1. Open `/feed/[videoIdA]/remix`, note the topic/hook/stage shown.
2. Open `/feed/[videoIdB]/remix` for a second, unrelated video.
Expected: video B's studio starts from its own independent state (a brand new
"prompt" stage session if B was never remixed before, or its own separately
progressed session if it was); nothing from video A's topic, hooks, or run
log appears. Confirms sessions are correctly scoped by `sourceVideoId`, not
accidentally shared.

### TC-RX-C3 (needs fixture): Two tabs opening the same fresh video's remix page at once can create two sessions
Steps: not run, requires opening the exact same never-before-remixed video in
two browser contexts within the same race window, which is not reliably
reproducible through sequential manual browsing.
Code-reading verdict: plausible per finding 3. `getOrCreateSession` does a
plain `SELECT` then `INSERT` with no transaction, and `remix_sessions` carries
no unique constraint on `sourceVideoId` (`schema.ts:250-264`) to catch this at
the database layer either. Left as a documented gap, not a pass/fail.

## D. Run log scoping and display

### TC-RX-D1: The run log is per-session, not global across videos
Steps:
1. Open the remix page for a video that has run log entries (from section A or
   C), read the entries shown.
2. Open a different video's remix page.
Expected: the second video's run log shows only its own entries (or "No
generation attempts yet.", `run-log.tsx:32`), never a row that belongs to the
first video's session. Confirms `getRemixRunLog` correctly filters by
`sessionId` (`remix-runs.ts:24-29`), not by some broader scope.

### TC-RX-D2: Run log entries are newest first
Steps:
1. On a session with two or more run log entries, read their relative-time
   labels top to bottom.
Expected: strictly newest-to-oldest ordering (`getRemixRunLog`'s
`orderBy(desc(startedAt))`, `remix-runs.ts:29`). If a session only has one
entry, this case is inconclusive; needs a session with 2+ attempts to verify
ordering meaningfully.

### TC-RX-D3: The run log survives navigating away and back (it's not held in React state alone)
Steps:
1. Note the exact run log entries on a session with at least one entry.
2. Navigate to Video Detail and back, or hard-reload.
Expected: identical entries, same relative order; the log is fetched fresh
from `getRemixRunLogAction` on every mount (`remix-studio.tsx:111-119`), not
carried only in client memory, so it should be indistinguishable before and
after.

### TC-RX-D4: The Prompt stage never shows a run log panel
Steps:
1. Land on the Prompt stage of any session.
Expected: no run log panel is visible at all; `remix-studio.tsx:245` only
renders `<RunLog>` when `activeStage !== "prompt"`. This is by design (Prompt
never generates anything), included here only to confirm the guard actually
holds in the live UI.

## E. Research stage

### TC-RX-E1: Research auto-assembles on first visit without any Generate click
Steps:
1. Visit the Research stage of a session that has never had research built
   (`session.researchNotes` still null, most likely a session still on
   "prompt").
2. Watch what renders immediately after navigating in.
Expected: a brief "Assembling research from the source video..." skeleton
(`stage-research.tsx:61-69`), then the real panel (source analysis, transcript
excerpt, facts box, vault posts, similar outliers) with zero LLM calls
involved; `buildResearch` is pure DB assembly (`remix.ts:211-216`). This
should be safe to trigger freely; it never touches `getLlm()`.

### TC-RX-E2: Revisiting an already-built Research stage does not rebuild it
Steps:
1. From TC-RX-E1's now-built state, navigate away (e.g. to Hook) and back to
   Research.
Expected: no "Assembling..." skeleton flashes again; `session.researchNotes` is
already non-null, so the auto-build effect's early return
(`stage-research.tsx:45`) skips straight to the real panel, and the facts text
(if any was typed) is unchanged.

### TC-RX-E3: An unanalyzed source video shows a labeled empty state, not a blank panel
Steps:
1. Find a video with no `video_analyses` row (never run through Analyze) and
   open its Research stage.
Expected: "No analysis yet, analyze the source video from Video Detail first
for richer research." (`stage-research.tsx:100`) for the Source analysis
block, and "Analyze more videos to see patterns here." (`:178`) for Similar
tracked outliers; both empty states are consistent with each other, since
`getSimilarOutliers` also requires the source video to have an analysis row
(`similar.ts:62-68`) before returning anything. If either message appears
without the other, the finding that they share one root cause needs revising.

### TC-RX-E4: An empty Vault shows a labeled empty state, not a blank panel
Steps:
1. On the Research stage, read the "Saved from your vault" section.
Expected: if the Vault has no saved posts, "Your vault is empty. Save a post
from the feed to give research something to pull from." (`stage-research.tsx:
148-155`), with a working link to `/feed`. If the Vault has posts, up to 5
appear (`page.tsx:20`'s `RESEARCH_VAULT_LIMIT`), most-recent-first.

### TC-RX-E5 (needs fixture): Similar outliers with zero real overlap still display as "similar" (candidate 6)
Steps: not run, requires a dataset with exactly one or two other analyzed
videos, at least one sharing zero tags/hookType with the source, which this
plan cannot guarantee exists in the current dev DB without inspecting scores
directly.
Code-reading verdict: plausible per finding 6, `getSimilarOutliers` has no
score floor (`similar.ts:86-97`), so any analyzed candidate can appear. Worth
a quick DB check (not a browser action) before ruling on this one: compare the
`similar` array's `outlierScore`/implied tag overlap against what actually
renders for a source video known to have few analyzed peers.

## F. Autosave: consistent vs. silent failure paths (candidate 2, 7)

### TC-RX-F1: Editing the topic and blurring shows no error under normal conditions
Steps:
1. On the Prompt stage, click into the topic field, change the text, then
   click elsewhere (blur).
Expected: no toast appears (autosave succeeded silently, which is the correct
happy path; `autosave()` only surfaces failures, `autosave.ts:13-21`).
Reload the page and confirm the edited topic persisted.

### TC-RX-F2: Continue and Restart do not use the same failure-surfacing path as every other write (code-reading only)
Steps: not directly triggerable without simulating a server failure (killing
the DB mid-request), which is out of scope for a read-only pass.
Code-reading verdict: per finding 2, `handleContinue` and `handleRestart`
(`remix-studio.tsx:140-166`) are the only writes in this file that skip both
the `.ok` check and the `autosave()` wrapper every other stage/field-level
write uses. Recorded here so a future pass with fault-injection capability has
a specific target.

### TC-RX-F3: Restart resets the stepper without discarding generated content
Steps:
1. On a session that has reached at least "hook" (has `chosenHook` and/or
   `hookOptions` set), click "Restart" in the footer.
2. Note the stepper's furthest-reached indicator.
3. Click forward (via the stepper, since it should be reachable again) back to
   Hook.
Expected: the furthest-reached indicator resets to "Prompt" (`remix-studio.tsx:
160-166` only ever patches `stage`), but the Hook stage's previously generated
options and chosen hook are still shown when you navigate back to it; Restart
does not clear `hookOptions`/`chosenHook`/`outline`/`variants`, only the stage
pointer. If the hook options are gone after Restart, this finding is wrong and
Restart is destructive in a way the code comment
(`remix.ts` / `remix-studio.tsx:155-159`) doesn't say it is.

## G. Vault template deep links

### TC-RX-G1: A valid `?hook=` id on a fresh session jumps straight to Hook
Steps:
1. From a Vault hook template card (or by constructing the URL directly once
   you have a real vault item id), visit
   `/feed/[videoId]/remix?hook=[vaultItemId]` for a video whose session is
   still fresh (stage "prompt").
Expected: the studio opens directly on the Hook stage (not Prompt), and the
"Seed from a Vault hook" select is pre-set to that item
(`deep-link.ts:56-58`, `remix-studio.tsx:216`).

### TC-RX-G2: The same deep link on a session with real progress does not jump the stage
Steps:
1. Visit the same `?hook=` URL for a video whose session has already reached
   "style" or later.
Expected: per `deep-link.ts:57` (`isFresh = session.stage === "prompt"`), the
studio should open on the session's actual furthest stage, not jump to Hook;
progress is not disturbed by an old deep link. The hook id is still honored if
and when Hook is visited, though (see G1's select pre-set behavior).

### TC-RX-G3: An id that doesn't match any real vault item is silently ignored
Steps:
1. Visit `/feed/[videoId]/remix?hook=not-a-real-id` for a fresh session.
Expected: no crash, no jump to Hook; the studio opens on its normal stage
(`deep-link.ts:47-50` only honors an id that matches an item in the passed-in
vault list). This is the one deep-link case explicitly designed to fail closed
rather than half-apply.

## H. Prompt stage and Quick Remix gating

### TC-RX-H1: Quick Remix is disabled without a topic or without an LLM key
Steps:
1. On the Prompt stage, clear the topic field entirely (if the app allows an
   empty value) and blur.
2. Read the Quick Remix button's disabled state.
Expected: disabled whenever `topic` is empty, `hasLlmKey` is false, or a run
is already pending (`stage-prompt.tsx:126`). Do not click it even when
enabled; this plan does not exercise Quick Remix, since it triggers three
LLM calls in sequence (`remix.ts:471-483`).

### TC-RX-H2: The topic field prefills from the source video's caption, once
Steps:
1. Open the Prompt stage of a session that has never had a topic set
   (`session.topic` still null).
Expected: the field is pre-filled with "<source caption> - for my niche"
(`stage-prompt.tsx:43`), and reloading the page afterward shows the same text
persisted (not regenerated); `stage-prompt.tsx:52-57`'s effect writes it once
via `autosave`, so a second visit reads it back from the session, not from a
fresh computation off the caption.

### TC-RX-H3: The no-key Alert and the Quick Remix gate agree with each other
Steps:
1. If ANTHROPIC_API_KEY is unset in this environment, read the Prompt stage.
Expected: the "Add your Claude API key" Alert (`stage-prompt.tsx:116-124`) is
visible, and Quick Remix is disabled for the same reason. If a key is
configured, neither should appear/apply; confirm the Alert's presence and the
button's disabled state move together, never independently.

## Non-browser findings carried over for the record

- Finding 3 (race on `getOrCreateSession`, no unique constraint on
  `sourceVideoId`) and finding 9 (`Boolean(outline)` accepting an empty-beats
  outline) are both real code-level observations that this plan cannot exercise
  live without either a timing race or a real/seeded generation. Listed here so
  they aren't lost, not scored pass/fail; see TC-RX-C3 and the candidate list
  above.
- Finding 6 (no similarity floor in `getSimilarOutliers`) is testable live only
  with knowledge of the current dev DB's actual analyzed-video set; see
  TC-RX-E5.
- Finding 7 (Quick Remix's silent refetch-failure swallow) needs a way to fail
  the second of two sequential server actions independently of the first,
  which is not reachable through normal UI interaction.

Everything else in this plan is read-only against a running `localhost:3000`
dev server: no Generate/Regenerate/Write script/Quick Remix click, no
Continue/Restart click that isn't itself the thing under test, no commit.

## Verification, code + DB, 2026-08-01

Read-only pass: no browser opened, no app code edited, no writes to
`data/crowsnest.db`, no LLM calls triggered. All 9 code candidates re-read
against current `src/` and cross-checked with `sqlite3 -readonly` queries
against the live dev DB (3 `remix_sessions` rows, 8 `remix_runs` rows, 3
`video_analyses` rows at the time of this pass).

**1. Most severe, global proxyDown lock.** CONFIRMED, with one important
correction to the severity claim. Code is exactly as described:
`remix-studio.tsx:125` (`proxyDown = runs !== null && isProxyLikelyDown(runs)`),
fanned out unchanged to `StageHook`/`StageStyle`/`StageScript` at `:214`,
`:227`, `:238`; `run-log-view.ts:77-79` scans only `runs.slice(0, 3)`, no age
check; `generation-blocked.tsx:43-59`'s proxy-down branch has zero
`<Button>`/`<Link>` elements (only the no-key branch at `:36-38` has one);
`remix.ts:181-194` reuses a session forever with no "new attempt" path.
DB check against `isProxyLikelyDown`'s exact predicate (its own most recent 3
`remix_runs` rows by `startedAt`, any `outcome='error'` with a connection-ish
message):
```sql
SELECT id, session_id, stage, outcome, started_at, detail
FROM remix_runs ORDER BY session_id, started_at DESC;
```
Session `93dd4b08` (source video `a0ed7179`, the plan's own "smoke run"
candidate) has 2 "Connection error." hook rows from 2026-07-31T00:34, but also
3 success rows from 2026-08-01T10:51:10/19/45 (hook, then style, then script,
the exact sequence `quickRemix()` in `remix.ts:471-483` writes) that are now
the 3 most recent rows for that session. Per `isProxyLikelyDown`'s own "most
recent 3" rule, this session's `proxyDown` currently evaluates `false`, it
self-healed. The other 2 sessions (`da2909fb`: no runs yet; `30c59e7a`: 3
success-only runs) were never blocked. No session in the current dev DB
reproduces the blocked state, so TC-RX-A1 through A4 need a fresh fixture
(kill the proxy, trigger one real failed attempt) to run live.
More importantly, the DB evidence surfaces an escape hatch the finding did
not account for. `StagePrompt` (`remix-studio.tsx:196-204`) is never passed
`proxyDown`, so Quick Remix stays clickable regardless of the flag, and its
underlying `generateHooks`/`generateOutline`/`generateVariants` calls
(`remix.ts:471-483`) are exactly what produced the 3 fresh success rows above.
So the lock is not actually "no way back in through the UI": Quick Remix,
launched from the never-gated Prompt stage, is a real (if undocumented and
side-effect-heavy, since it burns 3 LLM calls) recovery path once the proxy
is back up. The core defect (one stale row can block a stage that never
itself failed, no in-surface retry, no age check) stands as read.

**2. `handleContinue`/`handleRestart` skip `.ok` and `autosave()`.** CONFIRMED,
pure code, no data dimension. `remix-studio.tsx:140-148` (`handleContinue`)
and `:160-166` (`handleRestart`) both call bare
`await updateStageAction(...)` with the result discarded. Every other write in
this surface wraps the call: the deep-link effect at `:86-90`
(`autosave(updateStageAction(...))`), `stage-prompt.tsx:55` and `:68`,
`stage-hook.tsx:90`, all use `autosave()`, which is the only place a toast
fires on failure (`autosave.ts:13-21`, not independently re-read this pass but
uncontested by the plan). No SQL check applies here; this is a control-flow
gap, not a data claim.

**3. `getOrCreateSession` race, no unique constraint on `sourceVideoId`.**
CONFIRMED as a static schema fact, not exercised (agrees with the plan's own
"needs fixture" framing). `remix.ts:181-194` is a plain `SELECT ... ORDER BY
updatedAt DESC LIMIT 1` then `INSERT`, no transaction. Schema check:
```
grep -n "remixSessions\|uniqueIndex" src/server/db/schema.ts
```
confirms `remixSessions` (`schema.ts:250-265`) has no third
`(t) => [...]` argument at all, unlike `channels` (`uniqueIndex
"channels_platform_handle"`, `:69`), `videos` (`:126`), or `savedPosts`
(`uniqueIndex "saved_posts_video"`, `:318`), which all do use that pattern.
So there is no DB-level constraint that would catch two concurrent inserts
for one `sourceVideoId`. DB currently has zero duplicate-`sourceVideoId`
sessions (`SELECT source_video_id, COUNT(*) FROM remix_sessions GROUP BY
source_video_id HAVING COUNT(*) > 1` returns empty), consistent with a race
that needs concurrency to trigger, not proof against it.

**4. `canContinue`'s Research gate hardcoded `true`.** CONFIRMED, pure code.
`remix-studio.tsx:136`: `(activeStage === "research" && true)` is the literal
text, the only disjunct in the `canContinue` expression (`:134-138`) that
is not a real predicate on session state.

**5. `StageResearch`'s auto-build has no failure branch.** CONFIRMED, pure
code. `stage-research.tsx:47-53`: the `buildResearchAction(session.id).then`
callback checks `if (cancelled) return;` then `if (result.ok) {...}`, with no
`else` and no `.catch`, and no toast import anywhere in this file. A
`{ ok: false }` result or a thrown promise leaves `session.researchNotes`
null forever, so the stage is stuck on the "Assembling research..." skeleton
(`:61-69`, guarded by `session.researchNotes === null`) with no visible
failure signal.

**6. `getSimilarOutliers` has no similarity floor.** CONFIRMED as code, NOT
REPRODUCED in current data. `similar.ts:86-97`'s `.map/.sort/.slice` chain
never filters on `score`; a 0-score candidate would pass through unchanged.
DB check: computed `scoreSimilarity` by hand from the 3 `video_analyses` rows
currently in the DB (`hook_type`, `format_tags`, `style_tags`,
`structure_segments`, read via `SELECT ... FROM video_analyses`), matching
`scoreSimilarity`'s own formula (`similar.ts:27-34`: hookType match = 3, plus
1 per shared distinct structure label, format tag, and style tag):
- `a0ed7179` vs `a68a0361`: hookType differs; structure labels shared
  (Hook, Build, Payoff, CTA) = 4; format tags shared (explainer) = 1; style
  tags shared = 0. Score 5.
- `a0ed7179` vs `ed0022ae`: structure labels shared (Hook, CTA) = 2; format
  tags shared = 0; style tags shared (direct-address) = 1. Score 3.
- `a68a0361` vs `ed0022ae`: structure labels shared (Hook, CTA) = 2; format
  tags shared (talking-head) = 1; style tags shared = 0. Score 3.
No pair scores 0 in the current 3-video analyzed set, so `getSimilarOutliers`
would not currently surface a zero-overlap "similar" result for any of these
3 videos, matching the plan's own TC-RX-E5 "needs fixture" call. The missing-
floor defect in the code is real; it just is not triggered by what is in the
dev DB right now (the dataset is too small and too on-topic for two videos to
share literally nothing).

**7. `handleQuickRemix`'s refetch failure is swallowed.** CONFIRMED, pure
code. `remix-studio.tsx:176-181` reads: `const refreshed = await
getOrCreateSessionAction(...); ...; if (refreshed.ok) { setSession(...);
setActiveStage(...); }`, with no `else` and no toast, while `result.ok` from
the first call (`quickRemixAction`, `:170-174`) is checked and does toast on
failure. Matches the plan's description exactly. Not independently
triggerable read-only (needs the second call to fail independently of the
first), so left as code-confirmed only, per the plan's own note.

**8. Only furthest stage persisted, not last-viewed.** CONFIRMED, pure code.
`remix-studio.tsx:76`: `useState<RemixStage>(deepLinkSeed.activeStage)` is
the only initializer for `activeStage`, and `deep-link.ts:65`
(`resolveDeepLinkSeed`'s return) sets `activeStage: shouldJump && targetStage
? targetStage : opts.session.stage`. Absent a deep-link jump, it is always
`session.stage`, i.e. furthest reached, never a separately-persisted
last-viewed stage. `remix.ts:177-179`'s comment ("resume where you left off"
being the intended UX for session reuse) is the documented intent this
behavior is consistent with, per the plan's own framing.

**9. `canContinue`'s Style gate, `Boolean(session.outline)` accepts
empty-beats.** CONFIRMED as code, NOT REPRODUCED in current data.
`remix-studio.tsx:138`: `(activeStage === "style" && Boolean(session.outline))`
is a truthy-object check, so `{ beats: [] }` would pass. DB check:
`SELECT outline FROM remix_sessions` on the 2 sessions with a non-null
outline shows 20 beats (`93dd4b08`) and 5 beats (`30c59e7a`) respectively.
Neither is empty, so this gap is not currently observable live. Matches the
plan's own "cannot be produced without a real generation call or direct DB
seeding" note for TC-RX-B/candidate 9.

### Summary

- CONFIRMED (code-verified, all 9): candidates 1, 2, 3, 4, 5, 6, 7, 8, 9.
- Of those, candidates 1, 6, and 9 have a live-data component that does not
  currently reproduce against the dev DB as it stands (session self-healed,
  dataset too small, no empty-beats outline exists). Noted inline above,
  each with the exact query used.
- NEEDS BROWSER: none of the 9 candidates strictly require a browser to
  confirm or reject at the code, schema, and data level. TC-RX-A1 through A4
  do need a browser once a fresh "proxy actually down" fixture exists (kill
  the 9router proxy, trigger one failed Hook/Style/Script attempt, then
  reload), since that state does not currently exist in this DB.
