# remix: feature description

Remix turns one source video into a script through six stages: prompt, research, hook, style, script, finish. The user reaches it from a video's detail page at `/feed/{videoId}/remix`. There is one remix session per source video: arriving opens the existing session or creates a fresh one at the prompt stage, so returning resumes where the user left off. The studio needs the LLM proxy for its three generation stages (hook, style, script); prompt, research, and finish make no model call and work with the proxy down, the model key missing, or the sidecar off.

## 1. Feature summary

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

## 2. Set the topic, niche, and length

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

## 3. Run every stage at once with Quick Remix

### Who uses it

The user, from the prompt stage, when they do not want to steer each of the six stages by hand.

### What it does

One click runs research, then hooks (auto picking the first option), then an outline, then three script variants, all in one server call, and lands the studio on the script stage with every earlier stage still reachable and editable through the stepper.

### How to access it

The Quick Remix button on the prompt stage. While it runs the button reads "Running Quick Remix".

### Business rules

- Disabled without a topic or without a model key configured.
- B-11 (open): unlike the hook, style, and script stages, Quick Remix is not blocked when a key is configured but the model proxy is unreachable. The button stays clickable and the attempt fails to a toast instead of the block panel appearing first.
- When it finishes, the session is re read and the run log refreshes, showing the several generation attempts it made.

### Limitations

- Needs the model proxy actually reachable to complete, even though the button's enabled state does not reflect that (B-11).

### User guide

If you would rather not steer every stage yourself, set a topic on the prompt stage and click Quick Remix. It runs research, writes hooks, builds an outline, and drafts three script variants in one pass, then drops you on the script stage with everything filled in. You can still go back and change anything, generate hooks, outline, or the earlier stages, remain fully editable.

## 4. Review the assembled research

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
- B-02 (open): a failed assembly leaves the stage stuck on its loading skeleton with no retry and no error toast; Continue still lets the user proceed with no notes.

### Limitations

- Assembly reads stored records only and makes no model call, so it cannot backfill data the source lacks, an unanalyzed video shows the fallback note, an untranscribed one shows "No transcript available."

### User guide

Before anything gets generated, the research stage lays out what the remix will work from: why the original post worked, its hook pattern, and its structure, plus a handful of similar top performers and your own saved posts for reference. Add any facts or an angle you want the script to use in the box at the bottom; it saves automatically when you click away. When you are ready, click Continue.

## 5. Generate and pick a hook

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

## 6. Shape the outline

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

## 7. Write, edit, and save a script variant

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

## 8. Finish: put the remix on the plan

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

## 9. Interactions with other systems

**Persistence and autosave.** Every stage autosaves its own edits, most on blur, the length select and the structure select on change. A failed autosave surfaces as a toast rather than failing silently. The run log is its own table, written on every generation attempt regardless of outcome. See [persistence](../../shared/persistence.md).

**History and undo.** There is no undo anywhere in the studio. Restart keeps everything generation has produced and resets only the position. Regenerating replaces a field's value outright; the run log records that an attempt happened but never keeps the replaced text.

**Navigation and refresh.** The studio is a client shell that keeps the session in local state and autosaves to the server, so it does not depend on a full refresh to stay current within a visit. A deep link from a vault template card seeds the opening stage. See [navigation and shell](../../shared/navigation-and-shell.md).

**Background jobs and the sidecar.** The studio reads the source video and its analysis, both written earlier by the sidecar sync and by analyze. It starts no background job of its own; the cook run that follows a finish belongs to studio. See [background jobs](../../shared/background-jobs.md).

**External services.** The hook, style, and script stages call the model through the LLM layer. When it is unavailable they block; prompt, research, and finish are unaffected. See [external services](../../shared/external-services.md).

**Status and failures.** The run log is the studio's own status surface, distinct from the shell failure strip: a partial variant generation reads Partial, a clean one Success, a failure Failed. See [status and failures](../../shared/status-and-failures.md).

**Configuration and settings.** The niche is read from settings and shown on the prompt stage with a link to edit it. The target length default is 45 seconds. Neither is edited from any other stage.

## 10. Edge cases

- A session is created on first arrival even if the user does nothing, because the prompt stage's mount sync writes the prefilled topic without a user action, so every remixed video has a row from its first visit.
- Restart keeps every hook, outline, and variant already generated, so a restarted run can reuse them rather than regenerate from nothing; it clears only the position.
- The furthest stage only ever advances through Continue or Quick Remix. Back and stepper clicks move the active stage but never lower the furthest one, so leaving mid-session and returning resumes at the real high water mark.
- Quick Remix auto picks the first hook, so a session it produced has a chosen hook the user never read; they can change it by going back to the hook stage.
- If the source video is removed by a sync mid-session, the session keeps its own copied topic, hooks, outline, and variants; a later regenerate that needs the source's analysis falls back to a default pattern rather than failing.
- Two tabs open on the same video share one session, since get or create always returns the same row; their autosaves and generation writes race, last write wins per field.
- A generation abandoned by navigating away still lands on the server: the attempt's row and result are written regardless, and the studio's live copy simply does not reflect it until the next read.
