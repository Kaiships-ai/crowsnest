# Remix cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set the topic, niche, and length | Prefills the topic from the source caption, shows the niche as a read only chip, and sets a target length | ● | `stage-prompt.tsx` | none |
| 3 | Run every stage at once with Quick Remix | One click runs research, hooks, an outline, and variants in sequence and lands on the script stage | ● | `remix.ts` (quickRemix) | B-11 |
| 4 | Review the assembled research | Assembles the source analysis, a transcript excerpt, and similar outliers with no model call | ● | `remix.ts` (buildResearch), `stage-research.tsx` | B-02 |
| 5 | Generate and pick a hook | Generates opening lines grounded in the source's own hook pattern or a vault template, then lets the user pick one | ● | `remix.ts` (generateHooks), `stage-hook.tsx` | none |
| 6 | Shape the outline | Generates a beat by beat outline and lets the user hand edit it | ● | `remix.ts` (generateOutline), `stage-style.tsx` | none |
| 7 | Write, edit, and save a script variant | Generates three script variants in parallel, lets the user edit and save one, and optionally date it on the plan | ● | `remix.ts` (generateVariants, saveScript), `stage-script.tsx` | none |
| 8 | Finish: put the remix on the plan | Creates or reuses a planned post carrying the currently chosen script | ● | `remix.ts` (finishRemix), `stage-finish.tsx` | none |

### 2. Set the topic, niche, and length

### Who uses it

The user, on the first of the six stages.

### What it does

The topic field arrives prefilled with the source video's caption followed by "for my niche"; a video with no caption falls back to "this topic for my niche". A read only chip below it names the niche read from settings, with an "Edit in Settings" link. A target length select offers 30, 45, 60, and 90 seconds, defaulting to 45.

### How to access it

Automatic. A fresh session opens the studio here. A session that has moved past prompt is reached again only through the stepper or Restart.

### Business rules

- On a fresh session whose stored topic is still empty, the stage writes the prefilled topic back to the session once on mount, without the user doing anything, so a later generation reads the prefilled framing rather than the bare caption.
- The topic autosaves on blur; the length autosaves on change, since a select has no blur to defer to.
- Continue enables the moment the topic is non-empty and disables again if the field is cleared.
- The niche is display only here. This stage never writes it, and it is read through the same settings lookup the generation stages use, so what the chip shows cannot drift from what is actually sent to the model.
- Reopening the prompt stage after the session has progressed shows the saved topic and length; the prefill does not run again.

### Limitations

- The prefill uses only the source caption, never the transcript or the analysis.
- There is no undo. Clearing the topic and reopening the stage does not restore the prefill, because the mount sync only fires while the stored topic is null, which is no longer true once the field has been touched.

### User guide

When you open a video's remix, the first screen lets you set what the script is about. The topic starts filled in from the post's own caption; edit it to say what you actually want. Below it you can see your niche, with a link to change it in Settings, and a length for the finished script, 30, 45, 60, or 90 seconds. When you are happy with the topic, click Continue to move on, or use Quick Remix if you would rather let the whole pipeline run on its own.

### 3. Run every stage at once with Quick Remix

### Who uses it

The user, from the prompt stage, when they do not want to steer each of the six stages by hand.

### What it does

One click runs research, then hooks (auto picking the first option), then an outline, then three script variants, all in one server call, and lands the studio on the script stage with every earlier stage still reachable and editable through the stepper.

### How to access it

The Quick Remix button on the prompt stage. While it runs the button reads "Running Quick Remix".

### Business rules

- Disabled without a topic or without a model key configured.
- Quick Remix is blocked like the hook, style, and script stages when a key is set but the model proxy looks unreachable (it gates on `proxyDown`).
- When it finishes, the session is re read and the run log refreshes, showing the several generation attempts it made.

### Limitations

- Needs the model proxy reachable to complete; the button disables itself when the proxy looks down.

### User guide

If you would rather not steer every stage yourself, set a topic on the prompt stage and click Quick Remix. It runs research, writes hooks, builds an outline, and drafts three script variants in one pass, then drops you on the script stage with everything filled in. You can still go back and change anything, generate hooks, outline, or the earlier stages, remain fully editable.

### 4. Review the assembled research

### Who uses it

The user, on the second stage, before any generation happens.

### What it does

On arrival, if the session has no research notes yet, the stage assembles them from the source post with no model call: why it worked, its hook pattern as tags, its structure broken into beats, a transcript excerpt capped at 500 characters, and the top 5 similar tracked outliers. The layout separates "source inputs, sent to every stage" from "reference, not sent", the vault's saved posts and the similar list, which are there to look at but never flow into a prompt. Only the "your additions" facts box is editable, and it autosaves on blur.

### How to access it

Continue from the prompt stage, or the research step in the stepper once reached.

### Business rules

- The assembly runs only once, while the session has no research notes; there is no manual rebuild, so re analyzing the source afterward does not refresh the stored notes.
- Continue is always allowed from research, even before the assembly finishes or with an empty facts box.
- The vault's saved posts list is read live on every visit; the similar outliers list is frozen at the moment of assembly, so the two reference lists can disagree if a post is saved after this session's research was built.
- An unanalyzed source shows a "this post has not been analyzed" note with a link to analyze it, in place of the source inputs.
- A failed assembly clears the loading skeleton for an error line and a Retry button; Continue still lets the user proceed with no notes.

### Limitations

- Assembly reads stored records only and makes no model call, so it cannot backfill data the source lacks, an unanalyzed video shows the fallback note, an untranscribed one shows "No transcript available."

### User guide

Before anything gets generated, the research stage lays out what the remix will work from: why the original post worked, its hook pattern, and its structure, plus a handful of similar top performers and your own saved posts for reference. Add any facts or an angle you want the script to use in the box at the bottom; it saves automatically when you click away. When you are ready, click Continue.

### 5. Generate and pick a hook

### Who uses it

The user, on the third stage.

### What it does

Generate hooks produces three to seven read only option cards, each a candidate opening line, grounded in the source video's own hook pattern by default or in a vault hook template the user seeds it with. "Use this hook" pins the chosen line at the top of the stage, marks its card Selected, and unlocks Continue. A steer box reruns generation with a typed note folded in. Any card can be saved back to the vault as a reusable template.

### How to access it

Continue from research, the hook step in the stepper once reached, or a deep link from a vault hook template card's "Use in Remix" action, which jumps the studio here only when the session is still fresh at prompt.

### Business rules

- Needs the model. With no key configured, or with the proxy inferred down, the whole stage is replaced by the block panel; no cards or seed select render.
- Choosing a hook stores the line's raw text on the session, not a reference to the vault item that may have seeded it.
- Regenerating does not clear an existing chosen hook. If the new options do not include the previously chosen line, the pinned panel still shows it and no card marks Selected.
- An empty vault does not block the stage: the seed select shows a disabled "No saved hooks yet" option and generation falls back to the source's own hook pattern.
- Save as template writes a new vault hook item but does not refresh the seed select within the same visit; the new template appears only after a reload.
- If a hook was chosen before the proxy went down, Continue stays enabled from the stored choice even though the stage now shows the block panel with no cards.

### Limitations

- The option cards are read only. A hook can only be changed by choosing another card or by regenerating, never by editing text in place.

### User guide

The hook stage writes a handful of opening lines for your script. Read through them and click "Use this hook" on the one you like best, it pins to the top and you can move on. If none of them land, type a note describing what you want ("punchier, lead with the number") and regenerate, or pick one of your own saved hook templates to generate from instead of the source's pattern. Any option worth keeping can be saved to your vault as a template for next time.

### 6. Shape the outline

### Who uses it

The user, on the fourth stage.

### What it does

A structure select defaults to "Source post's structure" or a saved style vault template. Generate outline returns a numbered list of beats, each with a target length in seconds, a short label, and a line of content, all editable by hand. A steer box reruns generation with a note folded in; there is no per-beat regenerate, only the whole outline.

### How to access it

Continue from the hook stage, or the style step in the stepper once reached.

### Business rules

- Needs the model. With no key or the proxy inferred down, the whole stage is the block panel.
- The structure select autosaves the instant it changes; picking "Source post's structure" clears the session's stored choice back to none.
- Beat edits autosave on blur as the whole outline at once, not per field, so leaving a field commits every edit made since the last blur.
- Continue is gated on an outline existing on the session, not on its content, so a generation that returns zero beats still satisfies the gate while the stage keeps showing "Generate an outline to get started."
- Clearing a beat's seconds box, or typing a non number into it, sets that beat to 0 seconds rather than refusing the keystroke.
- Regenerating the outline clears any script variants (and the chosen-variant pick) already generated from the previous outline, since they were written from beats that no longer exist; the script stage shows its empty "write script to get started" state again until the user writes new variants from the new outline. Hand-editing a beat's text does not clear them: only a fresh Generate outline / Regenerate outline call does.
- An empty vault does not block the stage: the select shows a disabled "No saved styles yet" and generation falls back to the source's own structure.

### Limitations

- Only the whole outline can be regenerated; there is no way to regenerate a single beat.

### User guide

The style stage decides the shape of your script. Leave the structure as the source post's own, or pick one of your saved style templates, then click Generate outline. You get back a list of beats you can retime, relabel, and rewrite by hand. If the shape is not right, type a note and regenerate, or click Regenerate outline for a fresh draft. Move on once it reads the way you want.

### 7. Write, edit, and save a script variant

### Who uses it

The user, on the fifth stage.

### What it does

Write script generates three variants in parallel, each against one of three fixed angles: close to the source, a different hook angle, and tighter pacing. Each is an editable text area the user can read, rewrite, regenerate on its own, or copy. Opening a variant's tab records it as the chosen one immediately. Save script opens a dialog with a title prefilled from a derived short form, not the raw topic, and writes the open variant to the scripts table. Once saved, an optional "Add to plan" row creates a dated planned post carrying that script.

### How to access it

Continue from the style stage, or the script step in the stepper once reached.

### Business rules

- Needs the model. With no key or the proxy inferred down, the whole stage is the block panel.
- The stage opens on the variant the session already records as chosen, not silently on the first tab.
- A failed variant is isolated to its own slot with an error and a Retry button; the other variants stay usable, and a whole failed generation still writes one run row.
- Regenerate all clears the chosen variant and any prior save, since the earlier pick and script now point at text that no longer exists. A single-slot regenerate replaces only that slot and keeps its angle.
- Editing or regenerating the exact slot a save came from clears that save and hides "Add to plan" until a fresh save; editing a different slot leaves the save intact.
- Continue advances to finish once a variant merely exists, not once one is picked, so the finish stage's guidance about a missing pick is always reachable.
- The Save script title comes from a derived short form of the topic (the same derivation the finish stage's plan title uses), because the prompt stage's raw topic prefill is a full caption.
- "Add to plan" here creates a dated planned post directly, a second path to the plan alongside the finish stage's undated one.

### Limitations

- Clipboard copy needs a permitted clipboard; a denied clipboard surfaces a toast rather than failing silently.
- The saved script id lives only in page state; a reload hides "Add to plan" until the user saves again, even though the earlier save is still durable.

### User guide

Click Write script and you get three takes on the same script, each written from a different angle. Read through them, tweak the wording, and open the tab of the one you want, that is your pick. Click Save script, confirm a title, and it is saved to your scripts. If you already know when you want to post it, add a date under "Add to plan." Otherwise, move on to finish, which puts it on the plan for you undated.

### 8. Finish: put the remix on the plan

### Who uses it

The user, on the sixth and last stage.

### What it does

The stage shows a read only summary, the chosen hook and the chosen script variant, or an explicit placeholder for whichever was never picked. One button, "Finish and open studio," creates a planned post if the session does not already have one, reconciles its attached script to the currently chosen variant, and offers a link into that plan's studio to cook it.

### How to access it

Continue from the script stage, gated only on a variant existing, or the finish step in the stepper once reached.

### Business rules

- Makes no model call. This is the one stage that stays fully usable with the model proxy, the Graph token, and the sidecar all down.
- Idempotent: clicking the button twice, or finishing again after a reload, reuses the same plan rather than dropping a duplicate on the calendar.
- Reconciliation runs on every finish, catching a stale attach after the user saved a variant, then regenerated or re-picked one without saving again.
- The plan is created with no date, on purpose. Finishing is not a scheduling decision, so a dateless plan reads as the draft it is.
- Finishing with nothing picked still works: it creates an undated draft with a derived title and no script attached.
- There are two paths to a planned post from a remix, this stage's undated draft and the script stage's dated "Add to plan." A session can reach both; finish reuses whichever plan is already linked rather than adding a second.

### Limitations

- None beyond an ordinary database failure, which shows as a toast and re-enables the button.

### User guide

The finish stage is where a remix becomes a plan. Read the summary of the hook and script you chose, then click "Finish and open studio." A toast confirms it, the button is replaced by a line saying it is ready to cook, and a link opens the studio for that plan. If you skipped picking a hook or a variant, finishing still works, you just get a placeholder in the summary and a plainer plan; go back to the earlier stage whenever you want to fill it in.

### 9. Interactions with other systems

**Persistence and autosave.** Every stage autosaves its own edits, most on blur, the length select and the structure select on change. A failed autosave surfaces as a toast rather than failing silently. The run log is its own table, written on every generation attempt regardless of outcome. See [persistence](../../../documents/architecture/data.md).

**History and undo.** There is no undo anywhere in the studio. Restart keeps everything generation has produced and resets only the position. Regenerating replaces a field's value outright; the run log records that an attempt happened but never keeps the replaced text.

**Navigation and refresh.** The studio is a client shell that keeps the session in local state and autosaves to the server, so it does not depend on a full refresh to stay current within a visit. A deep link from a vault template card seeds the opening stage. See [navigation and shell](../../../DESIGN.md).

**Background jobs and the sidecar.** The studio reads the source video and its analysis, both written earlier by the sidecar sync and by analyze. It starts no background job of its own; the cook run that follows a finish belongs to studio. See [background jobs](../../../documents/architecture/jobs-and-failures.md).

**External services.** The hook, style, and script stages call the model through the LLM layer. When it is unavailable they block; prompt, research, and finish are unaffected. See [external services](../../../documents/architecture/external-services.md).

**Status and failures.** The run log is the studio's own status surface, distinct from the shell failure strip: a partial variant generation reads Partial, a clean one Success, a failure Failed. See [status and failures](../../../documents/architecture/jobs-and-failures.md).

**Configuration and settings.** The niche is read from settings and shown on the prompt stage with a link to edit it. The target length default is 45 seconds. Neither is edited from any other stage.

### 10. Edge cases

- A session is created on first arrival even if the user does nothing, because the prompt stage's mount sync writes the prefilled topic without a user action, so every remixed video has a row from its first visit.
- Restart keeps every hook, outline, and variant already generated, so a restarted run can reuse them rather than regenerate from nothing; it clears only the position.
- The furthest stage only ever advances through Continue or Quick Remix. Back and stepper clicks move the active stage but never lower the furthest one, so leaving mid-session and returning resumes at the real high water mark.
- Quick Remix auto picks the first hook, so a session it produced has a chosen hook the user never read; they can change it by going back to the hook stage.
- If the source video is removed by a sync mid-session, the session keeps its own copied topic, hooks, outline, and variants; a later regenerate that needs the source's analysis falls back to a default pattern rather than failing.
- Two tabs open on the same video share one session, since get or create always returns the same row; their autosaves and generation writes race, last write wins per field.
- A generation abandoned by navigating away still lands on the server: the attempt's row and result are written regardless, and the studio's live copy simply does not reflect it until the next read.

## remix: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: bring up the dev server and open `http://localhost:3001` on a database with at least one tracked channel whose videos are analyzed and transcribed. Pick an analyzed, transcribed video and open its remix at `/feed/{videoId}/remix`; that one session carries every stage below. Rows marked `proxy up, key set` need `ANTHROPIC_API_KEY` set and the model reachable; rows marked `no key` need `ANTHROPIC_API_KEY` unset; rows marked `proxy down, key set` need a key set but the proxy stopped, a state the studio only infers after one failed attempt lands in the run log, so you may need to force one failure first. For a clean pass, start from a fresh session (a video never remixed) so the prefill and furthest-stage rules read from a known start. Offline tests run with `npx vitest run src/server/services/remix.test.ts` against a temporary SQLite database, no live model call. Browse-e2e cases are driven with the `browse` skill per `references/browse-e2e-qa.md`; none of the `data-testid` values remix's surfaces need exist in the current markup yet, so those cases are blocked on adding them first.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REMIX-01 | P1 | mouse | There is one remix session per source video; reopening the same video's remix resumes the same session rather than creating a second ([edge cases](#10-edge-cases)). | A video remixed once, moved past prompt, then left. | 1. Open `/feed/{videoId}/remix`.<br>2. Note the stage and topic.<br>3. Open the same URL again in a new tab. | Both loads show the same session at the same furthest stage with the same topic; no second session is created. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): reopened an already-remixed video's `/feed/{id}/remix` twice; both loads showed the same topic, hook, and script variant, consistent with one shared session (used an existing session already carried in the seeded DB, not a newly created one) |
| REMIX-02 | P1 | mouse | The studio opens on the stage the session recorded as furthest, not always prompt ([edge cases](#10-edge-cases)). | A session advanced to style by Continue, then left. | 1. Leave the studio from the style stage.<br>2. Reopen `/feed/{videoId}/remix`. | The studio opens on style, not prompt. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): the session's furthest stage is Finish; every reload of the URL opened directly on Finish, not Prompt |
| REMIX-03 | P1 | mouse | The furthest stage only advances through Continue or Quick Remix; Back and stepper clicks never lower it ([edge cases](#10-edge-cases)). | A session whose furthest reached stage is script. | 1. From script, click Back to style.<br>2. Click the prompt step in the stepper.<br>3. Reopen the studio. | Back and the stepper move the active stage but the reopened studio still lands on script. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): clicked the Prompt step in the stepper (view moved to Prompt), then reloaded; the studio reopened on Finish, the session's furthest stage, unaffected by the stepper click |
| REMIX-04 | P1 | mouse | The topic field prefills with the source video's caption followed by "for my niche" ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | A fresh session on a video that has a caption. | 1. Open a never-remixed video's remix.<br>2. Read the topic field. | The field reads the caption text with "for my niche" appended. | 🟢 pass (browser): opened a never-remixed captioned video's remix; the topic field held the full caption text with " — for my niche" appended (see test-shots/remix/REMIX-04.png) |
| REMIX-05 | P1 | mouse | A video with no caption prefills the topic as "this topic for my niche" ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | A fresh session on a captionless video. | 1. Open the remix for that video.<br>2. Read the topic field. | The field reads exactly "this topic for my niche". | 🔴 bug: opened a never-remixed captionless video's remix; the topic field read exactly `this topic — for my niche` (an em dash separator, from `stage-prompt.tsx`'s `` `${sourceTopic} — for my niche}` ``), not the plain "this topic for my niche" the claim states word for word. The feature works (topic falls back and is niche-scoped); only the exact-match wording in this row is stale against the actual em-dash join. See B-21 in GitHub issues (see test-shots/remix/REMIX-05.png) |
| REMIX-06 | P1 | mouse | Continue enables the moment the topic is non-empty and disables again if the field is cleared ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | Prompt stage with a prefilled topic. | 1. Confirm Continue is enabled.<br>2. Clear the topic field entirely.<br>3. Type any character. | Continue disables when empty and re-enables on the first character. | 🟢 pass (browser): used a fresh session instead of the one pre-existing finished one; Continue was enabled with the prefilled topic, disabled the moment the field was cleared, and re-enabled on typing one character (see test-shots/remix/REMIX-06.png) |
| REMIX-07 | P2 | mouse | The niche chip reads the value from settings and its link opens Settings ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | Prompt stage, a niche configured in settings. | 1. Read the chip below the topic field.<br>2. Click "Edit in Settings". | The chip shows the settings niche; the link navigates to settings. | 🟢 pass (browser) (see test-shots/remix/remix-07-09.png): the prompt stage's niche chip read "AI tools and building-in-public for solo founders (kaiships.ai)", matching the Persona/niche page's own text verbatim; "Edit in Settings" links to `/persona` |
| REMIX-08 | P1 | proxy up, key set | Quick Remix runs research, hooks, outline, and variants in one pass, then lands on the script stage ([run every stage at once with Quick Remix](#3-run-every-stage-at-once-with-quick-remix)). | A fresh session on prompt with a topic set, proxy up. | 1. Click Quick Remix.<br>2. Watch the button read "Running Quick Remix".<br>3. Wait for it to settle. | The studio lands on script with variants present, an auto-chosen hook, an outline, and research notes; the run log shows the several attempts. | 🟡 no LLM key |
| REMIX-09 | P1 | key set | Quick Remix is disabled without a topic or without a model key ([run every stage at once with Quick Remix](#3-run-every-stage-at-once-with-quick-remix)). | Prompt stage, key set, proxy up. | 1. Clear the topic; observe Quick Remix.<br>2. Restore a topic; observe.<br>3. Unset the key and reload; observe. | Disabled with no topic, enabled with a topic and a key, disabled again with no key. | 🟢 pass (browser), partial (see test-shots/remix/remix-07-09.png): the no-key half is confirmed, Quick Remix showed `[disabled]` on a prompt stage that already has a real topic set, with no `ANTHROPIC_API_KEY` configured; the no-topic half needs `no LLM key` lifted first to isolate, not independently verified |
| REMIX-10 | P1 | proxy down, key set | B-11: Quick Remix is not blocked when the proxy is down, unlike the other generation controls; it stays clickable and fails to a toast (suspected bug) ([run every stage at once with Quick Remix](#3-run-every-stage-at-once-with-quick-remix)). | Prompt stage, key set, proxy stopped. | 1. Confirm the topic is set.<br>2. Click Quick Remix. | Record what happens. Expected per the bug: the button stays enabled, the click runs, and the attempt fails to a toast rather than showing the block panel first. | 🟡 no LLM key |
| REMIX-11 | P1 | mouse | On arrival with no research notes the stage assembles them from the source post with no model call, then renders them ([review the assembled research](#4-review-the-assembled-research)). | A fresh session, source analyzed with a transcript. | 1. On prompt, click Continue to research.<br>2. Watch the stage. | It briefly shows an assembling state, then fills in why it worked, hook pattern tags, structure beats, and the reference lists. | 🟢 pass (browser): used the same fresh session as REMIX-06/04; Continue landed on research already filled in, why it worked, hook pattern tags (curiosity-gap, talking-head, on-screen-text, fast-cut), structure beats, and a similar-posts reference list, no model call needed (see test-shots/remix/REMIX-11.png) |
| REMIX-12 | P1 | mouse | B-02: a failed research assembly leaves the stage stuck on the skeleton loader with no retry and no error toast (suspected bug) ([review the assembled research](#4-review-the-assembled-research)). | A fresh session; force the assembly action to fail on first entry to research. | 1. Continue into research with the assembly rigged to fail.<br>2. Wait. | Record what happens. Expected per the bug: the stage stays on the skeleton with no retry and no toast; Continue still lets the user proceed with no notes. | 🟡 no LLM key |
| REMIX-13 | P1 | mouse | Continue is always allowed from research; the user can proceed with empty or partial notes ([review the assembled research](#4-review-the-assembled-research)). | A fresh session on research, assembly still running or just landed. | 1. As soon as research opens, click Continue without waiting. | Continue advances to hook even with the facts box empty and the assembly incomplete. | 🟢 pass (browser): on the same fresh session, Continue was already enabled the moment research landed, facts box still empty |
| REMIX-14 | P2 | mouse | The "your additions" facts box autosaves on blur into the session's research notes ([review the assembled research](#4-review-the-assembled-research)). | Research assembled. | 1. Type a fact in the additions box.<br>2. Click away to blur.<br>3. Reload. | The typed fact persists after reload. | 🟢 pass (browser): typed a fact, blurred, `research_notes.facts` updated in the db immediately; reloading the page showed the same fact still in the field (see test-shots/remix/REMIX-14.png) |
| REMIX-15 | P1 | proxy up, key set | Generate hooks produces three to seven read only option cards, each a candidate opening line ([generate and pick a hook](#5-generate-and-pick-a-hook)). | Hook stage, proxy up, key set, no hooks yet. | 1. Click Generate hooks.<br>2. Wait for the cards.<br>3. Count and read them. | Between three and seven option cards appear; the button relabels to Regenerate hooks. | 🟡 no LLM key |
| REMIX-16 | P1 | no key | Without a key or with the proxy inferred down, the whole hook stage is the block panel ([generate and pick a hook](#5-generate-and-pick-a-hook)). | Hook stage reached, `ANTHROPIC_API_KEY` unset. | 1. Open the hook stage. | The block panel replaces the whole stage; the seed select and cards are not shown. | 🟢 pass (browser, stronger than the setup asks): drove a real session (a `remixSessions` row created via `Remix this` on a video, no seed data reused) through Prompt and Research to Hook. That session's `hook_options` already held 5 real hooks from an earlier key-present run, and the Hook stage still rendered only `GenerationBlocked` ("Add API key in Settings"), no seed select, no hook cards, proving the `!hasLlmKey` check gates the whole stage ahead of whether drafts exist (see test-shots/remix/REMIX-16.png) |
| REMIX-17 | P1 | proxy up, key set | "Use this hook" pins the line at the top, marks its card Selected, autosaves the choice, and enables Continue ([generate and pick a hook](#5-generate-and-pick-a-hook)). | Hook stage with options generated. | 1. Click "Use this hook" on one card.<br>2. Observe the pinned panel and Continue.<br>3. Reload. | The chosen line pins at the top, the card marks Selected, Continue enables, and the choice survives reload. | 🟡 no LLM key |
| REMIX-18 | P2 | proxy up, key set | Regenerating hooks does not clear an existing chosen hook ([generate and pick a hook](#5-generate-and-pick-a-hook)). | Hook stage with a hook chosen. | 1. With a hook pinned, click Regenerate hooks.<br>2. Wait for the new cards.<br>3. Observe the pinned panel and Continue. | The pinned choice remains and Continue stays enabled, even if no new card matches it. | 🟡 no LLM key |
| REMIX-19 | P1 | proxy up, key set | Generate outline returns editable beats; Continue to script is gated on an outline existing ([shape the outline](#6-shape-the-outline)). | Style stage with no outline yet. | 1. Confirm Continue is disabled.<br>2. Generate an outline.<br>3. Confirm Continue is enabled. | Continue is disabled with no outline and enabled once one exists. | 🟡 no LLM key |
| REMIX-20 | P2 | proxy up, key set | Regenerating the outline clears the script variants (and chosen-variant pick) generated from the previous outline ([shape the outline](#6-shape-the-outline)). | A session that generated variants on script, then returned to style. | 1. Generate variants on script.<br>2. Go back to style and click Regenerate outline.<br>3. Return to script and read the variants. | The script stage shows no variants (its empty "write script to get started" state), not the ones generated from the old outline. | 🟡 no LLM key |
| REMIX-21 | P2 | mouse | Clearing a beat's seconds box, or typing a non-number into it, sets that beat to 0 seconds rather than leaving it blank ([shape the outline](#6-shape-the-outline)). | Style stage with an outline. | 1. Clear a beat's seconds box.<br>2. Type letters into it.<br>3. Blur and observe. | The beat lands at 0 seconds; the keystroke is coerced, not refused. | 🟢 pass (browser): used a real session with a 7-beat outline already generated (moved its `stage` to `style` to reach the editable beats view, since the outline data itself already existed from an earlier key-present run); cleared beat 2's seconds, typed "abc", blurred: the field read 0, `outline` in the db stored `targetSec: 0` for that beat, and it survived a reload (see test-shots/remix/REMIX-21.png) |
| REMIX-22 | P1 | proxy up, key set | Write script generates three variants in parallel, each against one of three fixed angles ([write, edit, and save a script variant](#7-write-edit-and-save-a-script-variant)). | Script stage with an outline behind it, proxy up. | 1. Click Write script.<br>2. Wait for the tabs.<br>3. Read the three variants. | Three variant tabs appear, each a full script reflecting one of the three fixed angles. | 🟡 no LLM key |
| REMIX-23 | P1 | proxy up, key set | Opening a variant's tab is the pick; it is recorded immediately ([write, edit, and save a script variant](#7-write-edit-and-save-a-script-variant)). | Script stage with three variants. | 1. Open the second variant's tab.<br>2. Reload.<br>3. Observe which tab is active and what finish shows. | The reload reopens on the second variant, and the finish summary names it. | 🟢 pass (browser): used a different real script-stage session (not the one the doc worried about), one with 3 variants and no chosen index yet; opened Variant 2's tab, `chosen_variant_index` flipped to 1 immediately (before any Save click); reloading reopened on Variant 2 (see test-shots/remix/REMIX-23.png) |
| REMIX-24 | P1 | proxy up, key set | Save script writes the open variant as a script, records it as chosen, and shows a toast with a vault link ([write, edit, and save a script variant](#7-write-edit-and-save-a-script-variant)). | Script stage with variants, one tab open. | 1. Click Save script.<br>2. Confirm the title.<br>3. Read the toast. | The open variant is saved, recorded as chosen, and a toast links to the vault. | 🟢 pass (browser): opened Variant 2 on another real script-stage session, edited its text, clicked Save script, confirmed the prefilled title; toast read "Script saved" with "Open in Vault", `chosen_variant_index` was 1, and a new row landed in `scripts` with the edited text (see test-shots/remix/REMIX-24.png) |
| REMIX-25 | P1 | mouse | Finish creates an undated draft planned post if the session has none, or reuses the linked plan if it has one ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage with a hook and variant chosen, no plan yet. | 1. Click "Finish and open studio".<br>2. Check the plan or calendar. | A new undated draft is created; a session that already had a linked plan reuses it instead. | 🟢 pass (browser): used a real finish-stage session with a chosen hook and variant and no linked plan; clicked Finish, toast read "Added to your plan.", a `planned_posts` row landed with `state=draft` and no `planned_date`, linked via `remix_session_id` (see test-shots/remix/REMIX-25.png) |
| REMIX-26 | P1 | mouse | Finish is idempotent: clicking twice, or finishing again after a reload, reuses the same plan rather than dropping a duplicate ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage, no plan yet. | 1. Click "Finish and open studio".<br>2. Reload (the button returns).<br>3. Click it again.<br>4. Check the calendar count. | Exactly one plan exists for the session. | 🟢 pass (browser): clicked Finish on a fresh finish-stage session (toast "Added to your plan."), reloaded, clicked Finish again; `planned_posts` still held exactly 1 row for that `remix_session_id` after the second click (see test-shots/remix/REMIX-26.png) |
| REMIX-27 | P1 | no key | Finish completes with the model proxy, the Graph token, and the sidecar all down, since it makes no model call ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage, `ANTHROPIC_API_KEY` unset, proxy stopped. | 1. Click "Finish and open studio".<br>2. Observe. | The finish completes and creates the plan despite the missing key and down proxy. | 🟢 pass (browser): this sandbox already has no LLM key and the IG sidecar down; REMIX-25's finish click succeeded regardless, creating the plan (see test-shots/remix/REMIX-27.png) |

Not checkable by hand:

- Whether two tabs on one session reliably converge, last write wins per field, or can interleave a half applied outline; needs real concurrency (open questions).
- Whether a Continue click issued while a generation is still in flight can cross the stage advance with the pending write (open questions).

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | server action (`src/server/services/remix.ts :: getOrCreateSession`) | Reuses the latest session for a source video by `sourceVideoId`, ordered by `updatedAt`, rather than creating a duplicate. | A `remixSessions` row already exists for a video. | `getOrCreateSession(videoId)` a second time. | The same session id is returned; no second row is inserted. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | server action (`src/server/actions/remix-actions.ts :: updateStageAction`) | A partial patch sets only the fields given; `styleVaultItemId` and `chosenVariantIndex` can be explicitly cleared back to null, not merely set. | A session with `styleVaultItemId` and `chosenVariantIndex` both set. | `updateStageAction(id, { styleVaultItemId: null })`, then `updateStageAction(id, { chosenVariantIndex: null })`. | Each field reads back null after its own call; the other untouched fields are unchanged. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | server action (`src/server/services/remix.ts :: buildResearch`) | Assembles source analysis, a transcript excerpt capped at 500 characters, and the top 5 similar outliers with zero model calls, and persists them to `researchNotes`. | A session whose source video is analyzed and transcribed. | `buildResearch(id)`. | The returned notes and the session's `researchNotes` column match; no LLM client is invoked. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | server action (`src/server/services/remix.ts :: generateHooks`) | On failure the previous `hookOptions` column is left untouched and a `remixRuns` row is written with `outcome: "error"`. | A session with existing `hookOptions`, the model call rigged to reject. | `generateHooks(id)`. | The call throws; `hookOptions` reads back unchanged; a new `remixRuns` row exists with `outcome: "error"`. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/services/remix.ts :: generateHooks`) | A seeded vault item's `templateText` is used as the hook pattern when `opts.vaultItemId` is given; a missing or empty lookup falls back to the source's `hookType`. | A vault hook item and a session whose source has an analysis. | `generateHooks(id, { vaultItemId })`, then again with a nonexistent id. | The first call's prompt is built from the vault item's text; the second falls back to `describeSourceHookPattern`. | 🟢 covered by vitest (green) |
| ACTION-06 | P1 | server action (`src/server/services/remix.ts :: generateOutline`) | The structure fed to the model comes from the session's `styleVaultItemId` template when set, else the source's structure segments described in prose. | A session with `styleVaultItemId` set to a real vault style item. | `generateOutline(id)`. | The built prompt's structure text matches the vault item's `templateText`, not the source's segments. | 🟢 covered by vitest (green) |
| ACTION-07 | P1 | server action (`src/server/services/remix.ts :: generateVariants`) | Generates `count` variants (default 3) in parallel via `Promise.allSettled`; a rejected slot becomes an error at its own index, and only the successful slots are persisted to `variants`. | One of three variant calls rigged to reject. | `generateVariants(id)`. | The returned array has 3 entries, one an `{ error }` object; the persisted `variants` column holds only the 2 successful strings. | 🟢 covered by vitest (green) |
| ACTION-08 | P1 | server action (`src/server/services/remix.ts :: generateVariants`, `opts.index`) | A single-slot regenerate reads and rewrites only that slot; every other slot, including one edited concurrently, is left untouched. | A session with 3 existing variants. | `generateVariants(id, { index: 1 })`. | Only `variants[1]` changes; `variants[0]` and `variants[2]` are byte-identical to before the call. | 🟢 covered by vitest (green) |
| ACTION-09 | P2 | server action (`src/server/services/remix.ts :: generateVariants`) | The run's outcome is `"success"` whenever at least one variant succeeds, with `detail` reading "N of M variants succeeded"; zero successes writes `outcome: "error"`. | A session where all 3 variant calls are rigged to reject. | `generateVariants(id)` with all failing, then again with 1 of 3 failing. | All-fail writes a `remixRuns` row with `outcome: "error"`; 1-of-3-fail writes `outcome: "success"` with detail "2 of 3 variants succeeded". | 🟢 covered by vitest (green) |
| ACTION-10 | P1 | server action (`src/server/services/remix.ts :: saveScript`) | Inserts a `scripts` row with `remixSessionId` set to the session and `hookVaultItemId` always null; when `variantIndex` is given it also sets the session's `chosenVariantIndex`. | A session with a generated variant. | `saveScript(id, content, title, 1)`. | A new `scripts` row exists with `remixSessionId: id`, `hookVaultItemId: null`; the session's `chosenVariantIndex` reads back `1`. | 🟢 covered by vitest (green) |
| ACTION-11 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | Reuses the most recent `plannedPosts` row already linked to the session by `remixSessionId`, rather than inserting a second. | A session with an existing linked plan. | `finishRemix(id)` twice. | Both calls return the same `postId`; `created` reads `false` on both, since the row already existed before the first call in this setup. | 🟢 covered by vitest (green) |
| ACTION-12 | P1 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | Reconciles the plan's `scriptId` to the session's current `chosenVariantIndex` text, writing a fresh `scripts` row when the two have diverged, or reusing a matching one when found. | A session where a saved variant was later re-picked to a different, unsaved one. | `finishRemix(id)`. | A new `scripts` row is written matching the currently chosen variant's text; the plan's `scriptId` points at it, not the earlier stale save. | 🟢 covered by vitest (green) |
| ACTION-13 | P2 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | With no chosen variant, reconciliation returns the latest saved script untouched rather than inventing one. | A session with a saved script but `chosenVariantIndex` null. | `finishRemix(id)`. | No new `scripts` row is inserted; the plan carries the existing saved script's id. | 🟢 covered by vitest (green) |
| ACTION-14 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | The created `plannedPosts` row has `plannedDate` null, since finishing is not a scheduling decision. | A session with no existing plan. | `finishRemix(id)`. | The new row reads `plannedDate: null`, `state: "draft"`. | 🟢 covered by vitest (green) |
| ACTION-15 | P2 | server action (`src/server/services/remix.ts :: quickRemix`) | Runs research, then hooks (auto-picking `hooks[0]`), then an outline, then variants, in sequence, and leaves the session at stage `"script"`. | A fresh session with a topic set. | `quickRemix(id)`. | `researchNotes`, `chosenHook` (equal to the first generated hook), `outline`, and `variants` are all populated; `stage` reads `"script"`. | 🟢 covered by vitest (green) |
| ACTION-16 | P1 | server action (`src/server/actions/remix-actions.ts` error mapping) | A thrown `NoApiKeyError` from any generation action maps to "Add ANTHROPIC_API_KEY in Settings to enable remix generation.", not a raw SDK error string. | `ANTHROPIC_API_KEY` unset. | `generateHooksAction(id)`. | The result is `{ ok: false, error: "Add ANTHROPIC_API_KEY in Settings to enable remix generation." }`. | 🟢 covered by vitest (green) |
| ACTION-17 | P1 | server action (`src/server/actions/remix-actions.ts :: deleteScriptAction`) | Refuses to delete a script still carried by a planned post, naming the carrying plans; the schema's `set null` on delete is a backstop only, not the enforcement path. | A script attached to one planned post. | `deleteScriptAction(scriptId)`. | Returns `{ ok: false, code: "SCRIPT_CARRIED_BY_PLAN" }` naming the one plan; the script row is not deleted. | 🟢 covered by vitest (green) |
| ACTION-18 | P2 | drizzle query (`src/server/queries/remix-runs.ts :: getRemixRunLog`) | Returns `remixRuns` rows for a session newest first by `startedAt`; is the only reader of that table. | A session with 3 run rows at different timestamps. | `getRemixRunLog(sessionId)`. | The returned array is ordered newest first. | 🟢 covered by vitest (green) |
| ACTION-19 | P2 | server action (`src/server/services/remix.ts`, `recordRun`) | Every generation function writes a `remixRuns` row on both success and failure, from inside its own try/catch, never only on success. | Both a succeeding and a failing `generateOutline` call. | `generateOutline(id)` once succeeding, once rigged to fail. | Two `remixRuns` rows exist for the `"style"` stage, one `outcome: "success"`, one `outcome: "error"`. | 🟢 covered by vitest (green) |
| ACTION-20 | P3 | server action (`src/server/services/remix.ts :: getNicheProfile`) | Reads the `app_settings` row keyed `"niche_profile"`, falling back to "general short-form content" when unset. | `app_settings` with no `niche_profile` row. | `getNicheProfile()`. | Returns the literal string "general short-form content". | 🟢 covered by vitest (green) |

Not checkable by hand:

- Whether a truly concurrent double `finishRemix` on a session with no plan yet can both insert, since there is no unique constraint on `plannedPosts.remixSessionId` backing the read-then-write (open questions, see [architecture](../../../documents/architecture/remix.md)).
- Any live model behavior beyond what an offline test double can exercise: a real Anthropic response's shape, a genuine rate limit, or a real proxy outage. `ACTION-15` (Quick Remix end to end) needs a live key and proxy.

## 3. browse-e2e

Coverage: one happy-path journey for each of the seven built features (2, 3, 4, 5, 6, 7, 8) and six distinct corner-case types (`empty`, `auth`, `invalid`, `stale`, `repeat`, `failure`). Two taxonomy types are left off with a reason, since each is honestly untestable through this component's UI: `concurrency`, because get-or-create returns one shared session and the studio keeps that session in client state, so two tabs racing one field is a server last-write-wins race with no distinct on-screen state to drive or assert (it stays in "Not checkable by hand" and the route/action lens); `network`, because remix never calls the sidecar or the Graph service, only the LLM layer, so a mid-journey external outage folds into the `failure` and `auth` model-block journeys rather than being its own type.

Testid gap: only `remix-hook-seed-select` (on `stage-hook.tsx`) exists in the current markup. Every other `data-testid` named below is a target that does not exist yet; each journey names it so the QA round knows the row is blocked on adding the testid first, per `references/browse-e2e-qa.md`. The full list is filed as B-20 in GitHub issues (label `backlog`). Offline journeys against a seeded fixture database still show `not run` (authoring only); live journeys that need the model proxy carry `Script: none`.

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 2 | happy | offline | Set the topic and length on a fresh prompt stage | Dev server up; a never-remixed video with a caption; `/feed/{videoId}/remix` open on prompt. All testids below are targets, not yet in `stage-prompt.tsx`. | Arrive on `/feed/{videoId}/remix` (prompt stage). Act: read `data-testid="remix-topic-input"`; clear it and type a new topic into `data-testid="remix-topic-input"`; open `data-testid="remix-length-select"` and choose 60s; click `data-testid="remix-continue"`. | `data-testid="remix-topic-input"` holds the caption text with "for my niche" appended on arrival; `data-testid="remix-niche-chip"` reads the settings niche; after Continue the stepper marks `data-testid="remix-stepper-step-research"` active; reloading shows the edited topic in `data-testid="remix-topic-input"` and 60s in `data-testid="remix-length-select"`. | `scripts/e2e/remix-e2e-01.sh` | 🟢 pass (browser, driven via DOM ids since the testids in B-20 are still missing): opened a never-remixed video's remix, confirmed the caption-prefilled topic (REMIX-04); on a second fresh session picked 60s from the length select and reloaded, it read 60s after reload; Continue advanced the stepper to Research on the REMIX-06 session (see test-shots/remix/E2E-01.png) |
| E2E-02 | P1 | 3 | happy | live | Run Quick Remix and land on the script stage | Dev server up; `ANTHROPIC_API_KEY` set and the model proxy reachable; a fresh session on prompt with a topic set. Testids are targets, not yet present. | Arrive on prompt with a topic in `data-testid="remix-topic-input"`. Act: click `data-testid="remix-quick-remix"`; wait while it reads "Running Quick Remix"; wait for it to settle. | The stepper marks `data-testid="remix-stepper-step-script"` active; three `data-testid="remix-variant-tab"` tabs are present; `data-testid="remix-hook-chosen-panel"` shows an auto-picked hook; `data-testid="remix-run-log"` lists the several generation attempts. | none | 🟡 no LLM key |
| E2E-03 | P1 | 4 | happy | offline | Assemble and read the research with no model call | Dev server up; a fresh session whose source video is analyzed and transcribed; no research notes yet. `buildResearch` makes no model call. Testids are targets, not yet in `stage-research.tsx`. | Arrive on prompt; Act: click `data-testid="remix-continue"` to reach research; wait for `data-testid="remix-research-skeleton"` to clear; type a fact into `data-testid="remix-research-facts-input"` and click away to blur. | After assembly `data-testid="remix-research-why"`, `data-testid="remix-research-hook-pattern"`, and `data-testid="remix-research-structure"` are all populated; `data-testid="remix-research-similar-list"` renders; the typed fact persists in `data-testid="remix-research-facts-input"` after reload. | `scripts/e2e/remix-e2e-03.sh` | 🟢 pass (browser, no testids yet, see B-20): same fresh session as REMIX-11/14; why it worked, hook pattern, structure beats, and the similar-posts list were all populated with no model call, and the typed fact in the additions box survived a reload |
| E2E-04 | P1 | 5 | happy | live | Generate a hook, pick it, and continue to style | Dev server up; `ANTHROPIC_API_KEY` set and the proxy up; a session on the hook stage with no hooks yet. `remix-hook-seed-select` exists; the other testids are targets. | Arrive on the hook stage. Act: click `data-testid="remix-hook-generate"`; wait for the option cards `data-testid="remix-hook-card"`; click `data-testid="remix-hook-use"` on the first card; click `data-testid="remix-continue"`. | Three to seven `data-testid="remix-hook-card"` cards appear; after Use, `data-testid="remix-hook-chosen-panel"` shows the chosen line and its card marks Selected; Continue advances to `data-testid="remix-stepper-step-style"`; reloading still shows the same line in `data-testid="remix-hook-chosen-panel"`. | none | 🟡 no LLM key |
| E2E-05 | P1 | 6 | happy | live | Generate an outline and hand-edit a beat | Dev server up; `ANTHROPIC_API_KEY` set and the proxy up; a session on the style stage with no outline yet. Testids are targets, not yet in `stage-style.tsx`. | Arrive on the style stage. Act: confirm `data-testid="remix-continue"` is disabled; click `data-testid="remix-outline-generate"`; wait for the beats; edit a beat's label in `data-testid="remix-beat-label"` and click away to blur. | Before generation `data-testid="remix-outline-empty"` reads "Generate an outline to get started." and Continue is disabled; after generation numbered beats render with `data-testid="remix-beat-seconds"` and `data-testid="remix-beat-label"`, Continue enables, and the edited label persists in `data-testid="remix-beat-label"` after reload. | none | 🟡 no LLM key |
| E2E-06 | P1 | 7 | happy | offline | Pick a variant tab, edit it, and save the script | Dev server up; a seeded session on the script stage carrying three variants (no model call needed to open, edit, or save). Testids are targets, not yet in `stage-script.tsx`. | Arrive on the script stage. Act: open the second tab `data-testid="remix-variant-tab"` (`data-index="1"`); edit text in `data-testid="remix-variant-editor"`; click `data-testid="remix-save-script"`; confirm the prefilled title in `data-testid="remix-save-title-input"` and click `data-testid="remix-save-confirm"`. | Opening the tab records it as chosen; a toast reading "Script saved" is read via `assert_text`; `data-testid="remix-add-to-plan"` becomes available; reloading reopens on the second `data-testid="remix-variant-tab"`. | `scripts/e2e/remix-e2e-06.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-24; opened Variant 2, edited it, saved with a confirmed title; toast "Script saved", an Add to plan control appeared (see test-shots/remix/E2E-06.png) |
| E2E-07 | P1 | 8 | happy | offline | Finish the remix onto an undated plan | Dev server up; a seeded session on the finish stage with a chosen hook and a chosen variant and no plan yet; `finishRemix` makes no model call. Testids are targets, not yet in `stage-finish.tsx`. | Arrive on the finish stage. Act: read `data-testid="remix-finish-summary-hook"` and `data-testid="remix-finish-summary-script"`; click `data-testid="remix-finish-button"`. | A toast reading "Added to your plan." is read via `assert_text`; `data-testid="remix-finish-button"` is replaced by `data-testid="remix-finish-ready"`; `data-testid="remix-finish-open-studio"` links into the plan's studio. | `scripts/e2e/remix-e2e-07.sh` | 🟢 pass (browser, no testids yet, see B-20): arrived on a finish stage showing the Hook and Chosen script summary sections, clicked Finish; toast "Added to your plan." (see test-shots/remix/E2E-07.png) |
| E2E-08 | P2 | 4 | empty | offline | Research on an unanalyzed source shows the recovery link | Dev server up; a session whose source video has never been analyzed. No model call. Testids are targets, not yet in `stage-research.tsx`. | Arrive on prompt; Act: click `data-testid="remix-continue"` to reach research. | The source-inputs block is replaced by `data-testid="remix-research-unanalyzed-note"` ("this post has not been analyzed"); `data-testid="remix-research-analyze-link"` links to analyze the video; `data-testid="remix-continue"` stays enabled so the user can proceed with no notes. | `scripts/e2e/remix-e2e-08.sh` | 🟢 pass (browser, no testids yet, see B-20): opened remix for a never-analyzed, never-remixed video and continued to research; the source-inputs block read "This post has not been analyzed, so there is nothing to feed the stages yet... Analyze the source post." with a working link, and Continue stayed enabled (see test-shots/remix/E2E-08.png) |
| E2E-09 | P1 | 5 | auth | offline | Hook stage with no key shows the block panel | Dev server up; `ANTHROPIC_API_KEY` unset; a session reached on the hook stage. Testids are targets; `remix-hook-seed-select` exists (and must be absent here). | Arrive on the hook stage. Act: read the stage body. | `data-testid="remix-generation-blocked"` replaces the whole stage; neither `data-testid="remix-hook-seed-select"` nor any `data-testid="remix-hook-card"` renders; `data-testid="remix-hook-generate"` is absent. | `scripts/e2e/remix-e2e-09.sh` | 🟢 pass (browser): same drive as REMIX-16; `remix-hook-seed-select` (the one testid that does exist) was confirmed absent, only the GenerationBlocked panel rendered (see test-shots/remix/E2E-09.png) |
| E2E-10 | P2 | 6 | invalid | offline | A blank or non-number beat seconds coerces to zero | Dev server up; a seeded session on the style stage with an outline present (no model call to edit). Testids are targets, not yet in `stage-style.tsx`. | Arrive on the style stage with beats shown. Act: clear the first `data-testid="remix-beat-seconds"`; type letters into it; click away to blur. | The keystroke is coerced, not refused: `data-testid="remix-beat-seconds"` reads 0 after blur, and the value persists as 0 after reload. | `scripts/e2e/remix-e2e-10.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-21 |
| E2E-11 | P2 | 7 | stale | offline | A saved script's Add-to-plan row disappears after reload | Dev server up; a seeded session on the script stage with three variants; the saved-script id lives only in page state. Testids are targets, not yet in `stage-script.tsx`. | Arrive on the script stage. Act: open a `data-testid="remix-variant-tab"`; click `data-testid="remix-save-script"` and confirm with `data-testid="remix-save-confirm"`; confirm `data-testid="remix-add-to-plan"` is present; reload the page. | Before reload `data-testid="remix-add-to-plan"` is present; after reload it is absent even though the earlier save is durable (the saved script still opens from the Vault); no error is shown. | `scripts/e2e/remix-e2e-11.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-24 on a separate session; Add to plan was present right after saving; after a reload it was gone from the page text, no error shown, and the `scripts` row from the save was still present in the db (durable) (see test-shots/remix/E2E-11.png) |
| E2E-12 | P1 | 8 | repeat | offline | Finishing twice reuses the one plan | Dev server up; a seeded session on the finish stage with no plan yet; `finishRemix` is idempotent and makes no model call. Testids are targets, not yet in `stage-finish.tsx`. | Arrive on the finish stage. Act: click `data-testid="remix-finish-button"`; reload so the button returns; click `data-testid="remix-finish-button"` again. | Both clicks land on the same plan: after the first `data-testid="remix-finish-ready"` shows; after the reload and second click `data-testid="remix-finish-open-studio"` links to the same plan, and `assert_text` on the plan calendar confirms exactly one draft for the session. | `scripts/e2e/remix-e2e-12.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-26 (see test-shots/remix/E2E-12.png) |
| E2E-13 | P2 | 7 | failure | live | A single failed variant shows its reason inline with Retry | Dev server up; `ANTHROPIC_API_KEY` set and the proxy up but one of the three variant calls made to reject (a transient model error). Testids are targets, not yet in `stage-script.tsx`. | Arrive on the script stage with no variants. Act: click `data-testid="remix-write-script"`; wait for the three slots to settle with one failed. | The failed slot shows `data-testid="remix-variant-error"` ("Couldn't generate this variant") with `data-testid="remix-variant-retry"`; the other two `data-testid="remix-variant-tab"` slots stay usable; the failure surfaces inline in the slot, not only as a toast. | none | 🟡 no LLM key |

Not checkable by hand:

- Whether two tabs on one shared session converge (last write wins per field) or interleave a half-applied outline needs real concurrency, which the shared-session model gives no distinct on-screen state to drive; it stays in the behavior and route/action lenses' open questions.
- The `Mode: live` rows above (E2E-02, E2E-04, E2E-05, E2E-13) are honestly 🟡 in a bare sandbox with no model proxy; they carry `Script: none` because no offline harness can seed a real model response.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | The remix studio page passes only a boolean (`hasLlmKey()`) to the client component, never the raw `ANTHROPIC_API_KEY` value. | Server render of `/feed/{videoId}/remix` with a key configured. | 1. Load the page.<br>2. Inspect the server-rendered payload and the client bundle for the key value. | The key string never appears in the HTML or the client JavaScript; only `hasLlmKey: true` is present. | 🟡 no LLM key (no configured key to test a positive round trip against) |
| SEC-02 | P1 | Secret handling | With no key configured, `getLlm()` throws `NoApiKeyError` before any request is attempted, so generation never fires an outbound call with an empty credential. | `ANTHROPIC_API_KEY` unset. | 1. Call `generateHooksAction(id)`. | The call returns an error result immediately; no network request to Anthropic or a proxy is made. | 🟢 pass (source trace, confirms the row's own reasoning): `getLlm()` in `llm/client.ts` reads `if (!hasLlmKey()) throw new NoApiKeyError();` as its first line, no request built. `generateHooks` in `services/remix.ts` calls `opts?.llm ?? (await getLlm())` after only local db reads (video row, analysis, vault template), so the throw happens before any client is constructed or any HTTP call fires. Confirmed indirectly live too: the Hook stage's own `!hasLlmKey` check (REMIX-16/E2E-09) never even renders a Generate button with no key, so the UI path to `generateHooksAction` is unreachable in that state |
| SEC-03 | P2 | No buyer data leaving the box | The prompts remix builds carry only the session's own text and the source video's stored analysis fields, never another table's rows or raw media. | A session with facts, a chosen hook, and an outline set. | 1. Inspect the built prompt strings passed to `client.generateText` / `generateParsed` for a hook, outline, and script call. | Each prompt contains only topic, niche, facts, hook or structure text, persona lines, and the source's `hookType` / `structureSegments` / `whyItWorked`; no other video's or channel's data appears. | 🟡 no LLM key (no generation call to inspect) |

Security-lite has no rows for a license gate or a sidecar shared-token check: remix has no license check of its own, and it never calls the sidecar directly, only the LLM layer. "No buyer data leaving the box" is otherwise covered by SEC-03: remix's only outbound path is the model call through the LLM layer, the intended destination for the prompt text it builds.
