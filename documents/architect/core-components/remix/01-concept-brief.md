# remix: concept brief

`documents/architect/core-components/remix/`

Status: shipped and in daily use, with three known bugs open (a failed research assembly can strand the stage on its loading skeleton, regenerating the outline leaves stale script variants in place with no warning, and Quick Remix is not blocked when the model proxy is down the way the other generation controls are).

## 1. What it is

Remix is the six-stage studio at `/feed/{videoId}/remix` that turns one analyzed source video into a script in the buyer's own voice. The six stages are prompt, research, hook, style, script, and finish, and the studio ends with a script on the plan, ready to cook. There is one remix session per source video (`remixSessions`): arriving opens the existing session or creates a fresh one at the prompt stage, so returning resumes where the buyer left off. The stages share a client shell (`src/components/remix/remix-studio.tsx`) that owns the stepper, the Back, Restart, and Continue controls, the source context rail, the run log, and the Quick Remix shortcut that runs every generation stage in one pass. Each stage autosaves its own edits, and every generation attempt, success or failure, writes a `remixRuns` row that the run log reads back.

Three of the six stages call a model through the [llm layer](../llm/01-concept-brief.md): hook (opening lines), style (the beat outline), and script (three variants). Prompt, research, and finish make no model call: prompt is a short form, research assembles locally from records the sidecar and analysis already wrote, and finish is bookkeeping.

## 2. Why it exists

The product's promise is not "find a good reel" but "turn a good reel into your next script." Analysis produces an outlier worth copying; remix is the bridge from that outlier to text the buyer can actually record, grounded in the source's own hook pattern and structure but rewritten for the buyer's niche and persona. Splitting it into six visible, resumable stages exists because the pipeline is slow and fails often, a model call per generation stage: a buyer can stop after any stage, a failed generation leaves the prior value intact and a logged trace rather than a dead end, and Quick Remix collapses the whole thing to one click for anyone who does not want to steer each stage.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Remix session | The one `remixSessions` row per source video, a mutable scratchpad holding topic, niche, target length, research notes, hook options, chosen hook, style vault item, outline, variants, and chosen variant index. `getOrCreateSession` reuses the latest row by `sourceVideoId` rather than creating a second one. |
| Furthest stage vs. active stage | `remixSessions.stage` records the furthest stage the session has reached; the studio's local `activeStage` is whichever stage is on screen right now. Continue and Quick Remix are the only things that advance the furthest stage; Back and a stepper click move only the active stage. |
| Run log | The `remixRuns` table, one row per generation attempt (hook, style, or script), written on both success and failure by the generation call itself. It is the studio's own status surface and survives a Restart, which only resets `stage`. |
| Quick Remix | A single server call from the prompt stage that runs research, then hooks (auto picking the first), then outline, then variants in sequence, landing the session at stage script with every earlier stage still reachable. |
| Proxy down inference | The studio has no live ping to the model proxy. It reads the last three run log rows for a connection style failure and blocks the hook, style, and script stages until a later attempt succeeds. |
| Chosen hook / chosen variant | `chosenHook` stores the picked hook's raw text, not a reference to any vault item. `chosenVariantIndex` is null until the user actually picks or saves a variant, and null is never coerced to a default; the finish view shows an explicit placeholder instead of a plausible looking guess. |
| Reconciliation | `reconcileAttachedScript`, run every time `finishRemix` runs, makes sure the `scripts` row a plan carries matches the session's currently chosen variant, writing a fresh script row when the two have drifted apart. |
| Draft plan vs. dated plan | Finishing a remix creates an undated draft `plannedPosts` row (or reuses one already linked to the session). The script stage's own "Add to plan" control is a second, separate path that creates a dated plan directly. A session can reach both; finish reuses whichever plan is already linked. |

## 4. How it fits in the system

Remix sits between analysis and the plan. It reads a video's row, its `video_analyses` row, and its transcript, all written earlier by ig-sync and analyze, and it reads saved posts and vault hook and style templates as reference material. It writes nothing back to those upstream tables. What it produces, a `scripts` row and a `plannedPosts` row, is what studio later cooks: the session itself is disposable working state, and the finished script and the plan carry copies of the text, so deleting a session costs only run provenance, not the work. An idea from the ideas inbox can seed a session's starting topic, but the inbox itself belongs to [mine](../mine/01-concept-brief.md).

## 5. Dependency map

### Upstream (what remix depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | Every table remix reads and writes: `remixSessions`, `remixRuns`, `scripts`, `plannedPosts`, plus reads of `videos`, `videoAnalyses`, `transcripts`, `vaultItems`, `savedPosts`, `appSettings`, and `idea`. |
| video_analyses (written by [analyze](../analyze/01-concept-brief.md)) | The source video's hook type, structure segments, and why it worked, the grounding for every generation stage. |
| transcripts (written by the sidecar sync) | The transcript excerpt research assembles and, per structure beat, the words said. |
| vault (`vaultItems`) | Hook and style templates a stage can seed a generation from instead of the source's own pattern. |
| similar.ts (`getSimilarOutliers`) | The top similar tracked outliers research assembles as reference material. |
| persona.ts (`getPersona`) | The audience, voice, and do/don't lines appended onto every generation prompt. |
| [llm layer](../llm/01-concept-brief.md) (`getLlm`, `hasLlmKey`) | The model call itself; decides direct API versus local proxy and owns the missing-key versus proxy-down distinction. |
| App settings (niche profile) | Read once per generation call and shown as a read only chip on the prompt stage, so the chip can never drift from what is actually sent. |

### Downstream (what depends on remix)

| Consumer | What it reads |
| --- | --- |
| [studio](../studio/01-concept-brief.md) | Cooks the planned post remix's finish stage creates or reuses; remix does not own what happens after finish. |
| The plan and calendar (owned by [mine](../mine/01-concept-brief.md)) | The `plannedPosts` row remix writes, dated or undated. |
| The vault | The `scripts` row remix writes when a variant is saved or reconciled. |
| Ideas inbox (owned by [mine](../mine/01-concept-brief.md)) | `seedSessionFromIdea` links an idea to the session it spawns; the idea is marked scripted. |

### External

| Dependency | Role |
| --- | --- |
| None directly | Remix makes no external call of its own. Every model call goes through the [llm layer](../llm/01-concept-brief.md), which owns the direct Anthropic API versus local proxy decision. |

## 6. Boundaries

Remix owns the session lifecycle, the six stages, research assembly, the three generation stages, the run log, and the two writes that outlive the session: a `scripts` row and a `plannedPosts` row. The session itself is disposable working state; the finished script and the plan carry copies of the text, so deleting a session costs only run provenance. It does not own analysis (the source's hook type, structure segments, and why it worked are read from `video_analyses`, written by [analyze](../analyze/01-concept-brief.md)), the vault templates it seeds from, the model transport (the [llm layer](../llm/01-concept-brief.md) decides direct API versus proxy and owns the missing-key versus proxy-down distinction), or what happens after finish. Finish creates an undated draft planned post and links into `/mine/{postId}/studio`; cooking that post into a shot list belongs to [studio](../studio/01-concept-brief.md), not here. Ideas can seed a session's topic (`seedSessionFromIdea`), but the inbox itself is the [mine](../mine/01-concept-brief.md) surface.
