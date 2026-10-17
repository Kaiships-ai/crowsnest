# Remix cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Set the topic, niche, and length | Prefills the topic from the source caption, shows the niche as a read only chip, and sets a target length | ● | `stage-prompt.tsx` | none |
| 4 | Review the assembled research | Assembles the source analysis, a transcript excerpt, and similar outliers with no model call | ● | `remix.ts` (buildResearch), `stage-research.tsx` | B-02 |
| 5 | Pick a hook | Shows the hook the agent chose over MCP, any stored hook options to pick from, and a Copy prompt for Claude button | ● | `remix.ts` (buildHookPrompt), `stage-hook.tsx`, `copy-prompt-button.tsx` | none |
| 6 | Shape the outline | Shows the beat outline the agent saved over MCP, lets the user hand edit it, and offers Copy prompt for Claude | ● | `remix.ts` (buildOutlinePrompt), `stage-style.tsx`, `copy-prompt-button.tsx` | none |
| 7 | Read, edit, and save a script | Shows stored script variants, including each script the agent saved over MCP, to edit and save, plus Copy prompt for Claude and an optional dated plan | ● | `remix.ts` (saveAgentScript, saveScript), `stage-script.tsx`, `copy-prompt-button.tsx` | none |
| 8 | Finish: put the remix on the plan | Creates or reuses a planned post carrying the currently chosen script | ● | `remix.ts` (finishRemix), `stage-finish.tsx` | none |

### 2. Set the topic, niche, and length

### Who uses it

The user, on the first of the six stages.

### What it does

The topic field arrives prefilled with the source video's caption followed by "for my niche"; a video with no caption falls back to "this topic for my niche". A read only chip below it names the niche read from settings, with an "Edit in Settings" link. A target length select offers 30, 45, 60, and 90 seconds, defaulting to 45.

### How to access it

Automatic. A fresh session opens the studio here. A session that has moved past prompt is reached again only through the stepper or Restart.

### Business rules

- On a fresh session whose stored topic is still empty, the stage writes the prefilled topic back to the session once on mount, without the user doing anything, so a later prompt reads the prefilled framing rather than the bare caption.
- The topic autosaves on blur; the length autosaves on change, since a select has no blur to defer to.
- Continue enables the moment the topic is non-empty and disables again if the field is cleared.
- The niche is display only here. This stage never writes it, and it is read through the same settings lookup the prompt builders use, so what the chip shows cannot drift from what the agent's prompt carries.
- Reopening the prompt stage after the session has progressed shows the saved topic and length; the prefill does not run again.

### Limitations

- The prefill uses only the source caption, never the transcript or the analysis.
- There is no undo. Clearing the topic and reopening the stage does not restore the prefill, because the mount sync only fires while the stored topic is null, which is no longer true once the field has been touched.

### User guide

When you open a video's remix, the first screen lets you set what the script is about. The topic starts filled in from the post's own caption; edit it to say what you actually want. Below it you can see your niche, with a link to change it in Settings, and a length for the finished script, 30, 45, 60, or 90 seconds. When you are happy with the topic, click Continue to move on.

### 4. Review the assembled research

### Who uses it

The user, on the second stage, before any hook or script is written.

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

Before any hook or script is written, the research stage lays out what the remix will work from: why the original post worked, its hook pattern, and its structure, plus a handful of similar top performers and your own saved posts for reference. Add any facts or an angle you want the script to use in the box at the bottom; it saves automatically when you click away. When you are ready, click Continue.

### 5. Pick a hook

### Who uses it

The user, on the third stage.

### What it does

The app writes no hooks. The agent fetches the hook prompt through `crowsnest_remix_hooks` and saves its pick through `crowsnest_remix_choose_hook`, which stores the chosen line on the session. The stage pins the chosen line at the top. Stored hook options, when a session has them, render as read only cards with "Use this hook" and save-to-vault actions. Copy prompt for Claude (`data-testid="remix-copy-prompt-hook"`) copies the MCP steps for this stage. Each stage's Copy prompt for Claude button copies a short instruction naming the source video id and the MCP calls for that stage: get the session id from `crowsnest_remix_session`, fetch the stage prompt, write the text, and save it back. A toast says to paste it into Claude and reload. A denied clipboard shows an error toast instead.

### How to access it

Continue from research, the hook step in the stepper once reached, or a deep link from a vault hook template card's "Use in Remix" action, which jumps the studio here only when the session is still fresh at prompt.

### Business rules

- Makes no model call and needs no key.
- With a vault hook seed picked, the copied prompt also tells the agent to pass that `vaultItemId` to `crowsnest_remix_hooks`.
- Choosing a hook stores the line's raw text on the session, not a reference to the vault item that may have seeded it.
- With no options and no chosen hook, the stage reads "No hooks yet. Copy the prompt into Claude, then reload to see what it wrote."
- An empty vault does not block the stage: the seed select shows a disabled "No saved hooks yet" option and the prompt falls back to the source's own hook pattern.
- Save as template writes a new vault hook item but does not refresh the seed select within the same visit; the new template appears only after a reload.
- Continue is enabled once a chosen hook is stored.

### Limitations

- The page does not poll. What the agent writes appears only after a reload.
- The MCP chain stores only the chosen hook, not a list of options, so option cards appear only on sessions that already carried options.

### User guide

Click Copy prompt for Claude, paste it into Claude, and let it write and pick a hook. Reload the page: the chosen line is pinned at the top and Continue is enabled. To steer from a saved template, pick it in the seed select before copying.

### 6. Shape the outline

### Who uses it

The user, on the fourth stage.

### What it does

A structure select defaults to "Source post's structure" or a saved style vault template. The agent fetches the outline prompt through `crowsnest_remix_outline` and saves its beats by calling the same tool with an `outline`. The stage shows those beats as a numbered list, each with a target length in seconds, a short label, and a line of content, all editable by hand. Copy prompt for Claude (`data-testid="remix-copy-prompt-style"`) copies the MCP steps for this stage. Each stage's Copy prompt for Claude button copies a short instruction naming the source video id and the MCP calls for that stage: get the session id from `crowsnest_remix_session`, fetch the stage prompt, write the text, and save it back. A toast says to paste it into Claude and reload. A denied clipboard shows an error toast instead.

### How to access it

Continue from the hook stage, or the style step in the stepper once reached.

### Business rules

- Makes no model call and needs no key.
- The structure select autosaves the instant it changes; picking "Source post's structure" clears the session's stored choice back to none.
- Beat edits autosave on blur as the whole outline at once, not per field, so leaving a field commits every edit made since the last blur.
- With no outline stored, the stage reads "No outline yet. Copy the prompt into Claude, then reload to see what it wrote."
- Continue is gated on an outline existing on the session, not on its content.
- Clearing a beat's seconds box, or typing a non number into it, sets that beat to 0 seconds rather than refusing the keystroke.
- An empty vault does not block the stage: the select shows a disabled "No saved styles yet" and the prompt falls back to the source's own structure.

### Limitations

- The page does not poll. What the agent writes appears only after a reload.

### User guide

Leave the structure as the source post's own, or pick one of your saved style templates. Click Copy prompt for Claude, paste it into Claude, then reload. The beats it wrote show up as a list you can retime, relabel, and rewrite by hand.

### 7. Read, edit, and save a script

### Who uses it

The user, on the fifth stage.

### What it does

The agent fetches the script prompt through `crowsnest_remix_variants` and saves its script through `crowsnest_remix_save_script`. Each agent save is appended to the session's variants and picked. The stage shows the variants as tabs, each an editable text area with a Copy button. Opening a variant's tab records it as the chosen one immediately. Save script opens a dialog with a title prefilled from a derived short form, not the raw topic, and writes the open variant to the scripts table. Once saved, an optional "Add to plan" row creates a dated planned post carrying that script. With no variants the stage shows an empty line. Copy prompt for Claude (`data-testid="remix-copy-prompt-script"`) shows in both cases. Each stage's Copy prompt for Claude button copies a short instruction naming the source video id and the MCP calls for that stage: get the session id from `crowsnest_remix_session`, fetch the stage prompt, write the text, and save it back. A toast says to paste it into Claude and reload. A denied clipboard shows an error toast instead.

### How to access it

Continue from the style stage, or the script step in the stepper once reached.

### Business rules

- Makes no model call and needs no key.
- The stage opens on the variant the session already records as chosen, not silently on the first tab.
- An edit or pick from a tab that loaded before the agent removed that variant or beat shows an Autosave failed toast telling the user to reload; the stored session is unchanged and the pick stays valid.
- Editing the exact slot a save came from clears that save and hides "Add to plan" until a fresh save; editing a different slot leaves the save intact.
- With no variants and no saved script, the stage reads "No script yet. Copy the prompt into Claude, then reload to see what it wrote."
- Continue advances to finish once a variant or a saved script exists, not once one is picked, so the finish stage's guidance about a missing pick is always reachable.
- The Save script title comes from a derived short form of the topic (the same derivation the finish stage's plan title uses), because the prompt stage's raw topic prefill is a full caption.
- "Add to plan" here creates a dated planned post directly, a second path to the plan alongside the finish stage's undated one.

### Limitations

- Clipboard copy needs a permitted clipboard; a denied clipboard surfaces a toast rather than failing silently.
- The saved script id lives only in page state; a reload hides "Add to plan" until the user saves again, even though the earlier save is still durable.
- The page does not poll. A script the agent saves appears only after a reload.

### User guide

Click Copy prompt for Claude, paste it into Claude, then reload. The script it saved shows here as the picked variant. Open the tab you want, tweak the wording, and click Save script. If you already know when you want to post it, add a date under "Add to plan." Otherwise, move on to finish, which puts it on the plan for you undated.

### 8. Finish: put the remix on the plan

### Who uses it

The user, on the sixth and last stage.

### What it does

The stage shows a read only summary, the chosen hook and the chosen script variant, or an explicit placeholder for whichever was never picked. One button, "Finish and open studio," creates a planned post if the session does not already have one, reconciles its attached script to the currently chosen variant, and offers a link into that plan's studio to cook it.

### How to access it

Continue from the script stage, gated only on a variant or a saved script existing, or the finish step in the stepper once reached.

### Business rules

- Makes no model call. This is the one stage that stays fully usable with the Graph token and the sidecar both down.
- Idempotent: clicking the button twice, or finishing again after a reload, reuses the same plan rather than dropping a duplicate on the calendar.
- Reconciliation runs on every finish, catching a stale attach after the user saved a variant, then edited or re-picked one without saving again.
- The plan is created with no date, on purpose. Finishing is not a scheduling decision, so a dateless plan reads as the draft it is.
- Finishing with nothing picked still works: it creates an undated draft with a derived title and no script attached.
- There are two paths to a planned post from a remix, this stage's undated draft and the script stage's dated "Add to plan." A session can reach both; finish reuses whichever plan is already linked rather than adding a second.

### Limitations

- None beyond an ordinary database failure, which shows as a toast and re-enables the button.

### User guide

The finish stage is where a remix becomes a plan. Read the summary of the hook and script you chose, then click "Finish and open studio." A toast confirms it, the button is replaced by a line saying it is ready to cook, and a link opens the studio for that plan. If you skipped picking a hook or a variant, finishing still works, you just get a placeholder in the summary and a plainer plan; go back to the earlier stage whenever you want to fill it in.

### 9. Interactions with other systems

**Persistence and autosave.** Every stage autosaves its own edits, most on blur, the length select and the structure select on change. A failed autosave surfaces as a toast rather than failing silently. See [persistence](../../../documents/architecture/data.md).

**History and undo.** There is no undo anywhere in the studio. Restart keeps every stored hook, outline, and script and resets only the position. A new save from the agent replaces a field's value outright.

**Navigation and refresh.** The studio is a client shell that keeps the session in local state and autosaves to the server, so it does not depend on a full refresh to stay current within a visit. A deep link from a vault template card seeds the opening stage. See [navigation and shell](../../../DESIGN.md).

**Background jobs and the sidecar.** The studio reads the source video and its analysis, both written earlier by the sidecar sync and by analyze. It starts no background job of its own; the cook run that follows a finish belongs to studio. See [background jobs](../../../documents/architecture/jobs-and-failures.md).

**External services.** No stage calls a model. Hook, style, and script text comes from the agent over MCP. See [external services](../../../documents/architecture/external-services.md).

**Configuration and settings.** The niche is read from settings and shown on the prompt stage with a link to edit it. The target length default is 45 seconds. Neither is edited from any other stage.

### 10. Edge cases

- A session is created on first arrival even if the user does nothing, because the prompt stage's mount sync writes the prefilled topic without a user action, so every remixed video has a row from its first visit.
- Restart keeps every hook, outline, and variant already stored; it clears only the position.
- The furthest stage only ever advances through Continue. Back and stepper clicks move the active stage but never lower the furthest one, so leaving mid-session and returning resumes at the real high water mark.
- If the source video is removed by a sync mid-session, the session keeps its own copied topic, hooks, outline, and variants; a later prompt that needs the source's analysis falls back to a default pattern rather than failing.
- Two tabs open on the same video share one session, since get or create always returns the same row; their autosaves and the agent's MCP writes race, last write wins per field.
## remix: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: bring up the dev server and open `http://localhost:3001` on a database with at least one tracked channel whose videos are analyzed and transcribed. Pick an analyzed, transcribed video and open its remix at `/feed/{videoId}/remix`; that one session carries every stage below. Rows marked `agent text` need the session to carry what an agent saved over MCP (`crowsnest_remix_choose_hook`, `crowsnest_remix_outline` with an `outline`, `crowsnest_remix_save_script`), either from a real Claude session or by seeding the same columns. For a clean pass, start from a fresh session (a video never remixed) so the prefill and furthest-stage rules read from a known start. Offline tests run with `npx vitest run src/server/services/remix.test.ts` against a temporary SQLite database and makes no model call. Browse-e2e cases are driven with the `browse` skill per `references/browse-e2e-qa.md`; none of the `data-testid` values remix's surfaces need exist in the current markup yet, so those cases are blocked on adding them first.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REMIX-01 | P1 | mouse | There is one remix session per source video; reopening the same video's remix resumes the same session rather than creating a second ([edge cases](#10-edge-cases)). | A video remixed once, moved past prompt, then left. | 1. Open `/feed/{videoId}/remix`.<br>2. Note the stage and topic.<br>3. Open the same URL again in a new tab. | Both loads show the same session at the same furthest stage with the same topic; no second session is created. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): reopened an already-remixed video's `/feed/{id}/remix` twice; both loads showed the same topic, hook, and script variant, consistent with one shared session (used an existing session already carried in the seeded DB, not a newly created one) |
| REMIX-02 | P1 | mouse | The studio opens on the stage the session recorded as furthest, not always prompt ([edge cases](#10-edge-cases)). | A session advanced to style by Continue, then left. | 1. Leave the studio from the style stage.<br>2. Reopen `/feed/{videoId}/remix`. | The studio opens on style, not prompt. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): the session's furthest stage is Finish; every reload of the URL opened directly on Finish, not Prompt |
| REMIX-03 | P1 | mouse | The furthest stage only advances through Continue; Back and stepper clicks never lower it ([edge cases](#10-edge-cases)). | A session whose furthest reached stage is script. | 1. From script, click Back to style.<br>2. Click the prompt step in the stepper.<br>3. Reopen the studio. | Back and the stepper move the active stage but the reopened studio still lands on script. | 🟢 pass (browser) (see test-shots/remix/remix-01-02-03.png): clicked the Prompt step in the stepper (view moved to Prompt), then reloaded; the studio reopened on Finish, the session's furthest stage, unaffected by the stepper click |
| REMIX-04 | P1 | mouse | The topic field prefills with the source video's caption followed by "for my niche" ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | A fresh session on a video that has a caption. | 1. Open a never-remixed video's remix.<br>2. Read the topic field. | The field reads the caption text with "for my niche" appended. | 🟢 pass (browser): opened a never-remixed captioned video's remix; the topic field held the full caption text with " — for my niche" appended (see test-shots/remix/REMIX-04.png) |
| REMIX-05 | P1 | mouse | A video with no caption prefills the topic as "this topic for my niche" ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | A fresh session on a captionless video. | 1. Open the remix for that video.<br>2. Read the topic field. | The field reads exactly "this topic for my niche". | 🔴 bug: opened a never-remixed captionless video's remix; the topic field read exactly `this topic — for my niche` (an em dash separator, from `stage-prompt.tsx`'s `` `${sourceTopic} — for my niche}` ``), not the plain "this topic for my niche" the claim states word for word. The feature works (topic falls back and is niche-scoped); only the exact-match wording in this row is stale against the actual em-dash join. See B-21 in GitHub issues (see test-shots/remix/REMIX-05.png) |
| REMIX-06 | P1 | mouse | Continue enables the moment the topic is non-empty and disables again if the field is cleared ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | Prompt stage with a prefilled topic. | 1. Confirm Continue is enabled.<br>2. Clear the topic field entirely.<br>3. Type any character. | Continue disables when empty and re-enables on the first character. | 🟢 pass (browser): used a fresh session instead of the one pre-existing finished one; Continue was enabled with the prefilled topic, disabled the moment the field was cleared, and re-enabled on typing one character (see test-shots/remix/REMIX-06.png) |
| REMIX-07 | P2 | mouse | The niche chip reads the value from settings and its link opens Settings ([set the topic, niche, and length](#2-set-the-topic-niche-and-length)). | Prompt stage, a niche configured in settings. | 1. Read the chip below the topic field.<br>2. Click "Edit in Settings". | The chip shows the settings niche; the link navigates to settings. | 🟢 pass (browser) (see test-shots/remix/remix-07-09.png): the prompt stage's niche chip read "AI tools and building-in-public for solo founders (kaiships.ai)", matching the Persona/niche page's own text verbatim; "Edit in Settings" links to `/persona` |
| REMIX-11 | P1 | mouse | On arrival with no research notes the stage assembles them from the source post with no model call, then renders them ([review the assembled research](#4-review-the-assembled-research)). | A fresh session, source analyzed with a transcript. | 1. On prompt, click Continue to research.<br>2. Watch the stage. | It briefly shows an assembling state, then fills in why it worked, hook pattern tags, structure beats, and the reference lists. | 🟢 pass (browser): used the same fresh session as REMIX-06/04; Continue landed on research already filled in, why it worked, hook pattern tags (curiosity-gap, talking-head, on-screen-text, fast-cut), structure beats, and a similar-posts reference list, no model call needed (see test-shots/remix/REMIX-11.png) |
| REMIX-12 | P1 | mouse | B-02: a failed research assembly leaves the stage stuck on the skeleton loader with no retry and no error toast (suspected bug) ([review the assembled research](#4-review-the-assembled-research)). | A fresh session; force the assembly action to fail on first entry to research. | 1. Continue into research with the assembly rigged to fail.<br>2. Wait. | Record what happens. Expected per the bug: the stage stays on the skeleton with no retry and no toast; Continue still lets the user proceed with no notes. | not run |
| REMIX-13 | P1 | mouse | Continue is always allowed from research; the user can proceed with empty or partial notes ([review the assembled research](#4-review-the-assembled-research)). | A fresh session on research, assembly still running or just landed. | 1. As soon as research opens, click Continue without waiting. | Continue advances to hook even with the facts box empty and the assembly incomplete. | 🟢 pass (browser): on the same fresh session, Continue was already enabled the moment research landed, facts box still empty |
| REMIX-14 | P2 | mouse | The "your additions" facts box autosaves on blur into the session's research notes ([review the assembled research](#4-review-the-assembled-research)). | Research assembled. | 1. Type a fact in the additions box.<br>2. Click away to blur.<br>3. Reload. | The typed fact persists after reload. | 🟢 pass (browser): typed a fact, blurred, `research_notes.facts` updated in the db immediately; reloading the page showed the same fact still in the field (see test-shots/remix/REMIX-14.png) |
| REMIX-15 | P1 | agent text | A hook the agent chose over MCP shows pinned on the hook stage after a reload ([pick a hook](#5-pick-a-hook)). | Hook stage open, no hook chosen yet. | 1. Have the agent run `crowsnest_remix_hooks` then `crowsnest_remix_choose_hook` for this video.<br>2. Reload. | The chosen line is pinned at the top and Continue is enabled. | not run |
| REMIX-17 | P1 | agent text | "Use this hook" pins the line at the top, marks its card Selected, autosaves the choice, and enables Continue ([pick a hook](#5-pick-a-hook)). | Hook stage on a session that carries stored hook options. | 1. Click "Use this hook" on one card.<br>2. Observe the pinned panel and Continue.<br>3. Reload. | The chosen line pins at the top, the card marks Selected, Continue enables, and the choice survives reload. | 🟡 no LLM key |
| REMIX-19 | P1 | agent text | The outline the agent saved over MCP renders as editable beats; Continue to script is gated on an outline existing ([shape the outline](#6-shape-the-outline)). | Style stage with no outline yet. | 1. Confirm Continue is disabled.<br>2. Have the agent save an outline through `crowsnest_remix_outline`.<br>3. Reload. | Continue is disabled with no outline; after reload the agent's beats render and Continue is enabled. | not run |
| REMIX-21 | P2 | mouse | Clearing a beat's seconds box, or typing a non-number into it, sets that beat to 0 seconds rather than leaving it blank ([shape the outline](#6-shape-the-outline)). | Style stage with an outline. | 1. Clear a beat's seconds box.<br>2. Type letters into it.<br>3. Blur and observe. | The beat lands at 0 seconds; the keystroke is coerced, not refused. | 🟢 pass (browser): used a real session with a 7-beat outline already generated (moved its `stage` to `style` to reach the editable beats view, since the outline data itself already existed from an earlier key-present run); cleared beat 2's seconds, typed "abc", blurred: the field read 0, `outline` in the db stored `targetSec: 0` for that beat, and it survived a reload (see test-shots/remix/REMIX-21.png) |
| REMIX-22 | P1 | agent text | A script the agent saves shows as the picked variant ([read, edit, and save a script](#7-read-edit-and-save-a-script)). | Script stage, no variants, no saved script. | 1. Have the agent save a script through `crowsnest_remix_save_script`.<br>2. Reload. | The script shows as the open variant tab, Continue is enabled, and Finish shows it as the chosen script. | not run |
| REMIX-23 | P1 | mouse | Opening a variant's tab is the pick; it is recorded immediately ([read, edit, and save a script](#7-read-edit-and-save-a-script)). | Script stage with three variants. | 1. Open the second variant's tab.<br>2. Reload.<br>3. Observe which tab is active and what finish shows. | The reload reopens on the second variant, and the finish summary names it. | 🟢 pass (browser): used a different real script-stage session (not the one the doc worried about), one with 3 variants and no chosen index yet; opened Variant 2's tab, `chosen_variant_index` flipped to 1 immediately (before any Save click); reloading reopened on Variant 2 (see test-shots/remix/REMIX-23.png) |
| REMIX-24 | P1 | mouse | Save script writes the open variant as a script, records it as chosen, and shows a toast with a vault link ([read, edit, and save a script](#7-read-edit-and-save-a-script)). | Script stage with variants, one tab open. | 1. Click Save script.<br>2. Confirm the title.<br>3. Read the toast. | The open variant is saved, recorded as chosen, and a toast links to the vault. | 🟢 pass (browser): opened Variant 2 on another real script-stage session, edited its text, clicked Save script, confirmed the prefilled title; toast read "Script saved" with "Open in Vault", `chosen_variant_index` was 1, and a new row landed in `scripts` with the edited text (see test-shots/remix/REMIX-24.png) |
| REMIX-25 | P1 | mouse | Finish creates an undated draft planned post if the session has none, or reuses the linked plan if it has one ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage with a hook and variant chosen, no plan yet. | 1. Click "Finish and open studio".<br>2. Check the plan or calendar. | A new undated draft is created; a session that already had a linked plan reuses it instead. | 🟢 pass (browser): used a real finish-stage session with a chosen hook and variant and no linked plan; clicked Finish, toast read "Added to your plan.", a `planned_posts` row landed with `state=draft` and no `planned_date`, linked via `remix_session_id` (see test-shots/remix/REMIX-25.png) |
| REMIX-26 | P1 | mouse | Finish is idempotent: clicking twice, or finishing again after a reload, reuses the same plan rather than dropping a duplicate ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage, no plan yet. | 1. Click "Finish and open studio".<br>2. Reload (the button returns).<br>3. Click it again.<br>4. Check the calendar count. | Exactly one plan exists for the session. | 🟢 pass (browser): clicked Finish on a fresh finish-stage session (toast "Added to your plan."), reloaded, clicked Finish again; `planned_posts` still held exactly 1 row for that `remix_session_id` after the second click (see test-shots/remix/REMIX-26.png) |
| REMIX-27 | P1 | mouse | Finish completes with the Graph token and the sidecar both down ([finish: put the remix on the plan](#8-finish-put-the-remix-on-the-plan)). | Finish stage, sidecar stopped, no Graph token. | 1. Click "Finish and open studio".<br>2. Observe. | The finish completes and creates the plan. | 🟢 pass (browser): this sandbox had the IG sidecar down; REMIX-25's finish click succeeded regardless, creating the plan (see test-shots/remix/REMIX-27.png) |
| REMIX-28 | P1 | mouse | Each of the hook, style, and script stages shows a Copy prompt for Claude button that copies that stage's MCP steps for the source video ([pick a hook](#5-pick-a-hook)). | A session reached on each stage; clipboard permitted. | 1. On hook, click `remix-copy-prompt-hook`.<br>2. Paste the clipboard.<br>3. Repeat on style (`remix-copy-prompt-style`) and script (`remix-copy-prompt-script`). | Each paste names the source video id, `crowsnest_remix_session`, and that stage's tools (`crowsnest_remix_hooks` and `crowsnest_remix_choose_hook`; `crowsnest_remix_outline`; `crowsnest_remix_variants` and `crowsnest_remix_save_script`). A success toast says to paste into Claude and reload. | not run |
| REMIX-29 | P2 | mouse | With a vault hook seed picked, the copied hook prompt also passes that `vaultItemId` ([pick a hook](#5-pick-a-hook)). | Hook stage, a saved hook template in the vault. | 1. Pick the template in `remix-hook-seed-select`.<br>2. Click `remix-copy-prompt-hook` and paste. | The paste includes `Pass vaultItemId "<id>" to crowsnest_remix_hooks.` | not run |
| REMIX-30 | P2 | mouse | A stage with nothing stored shows an empty line pointing at the copy button, not a generate control ([read, edit, and save a script](#7-read-edit-and-save-a-script)). | A fresh session on hook, then style, then script with nothing stored. | 1. Read each stage. | Each reads "No hooks yet.", "No outline yet.", or "No script yet." followed by "Copy the prompt into Claude, then reload to see what it wrote." No Generate, Regenerate, or Write script button renders. | not run |

Not checkable by hand:

- Whether two tabs on one session reliably converge, last write wins per field, or can interleave a half applied outline; needs real concurrency (open questions).
- Whether a Continue click issued while an autosave is still in flight can cross the stage advance with the pending write (open questions).

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | server action (`src/server/services/remix.ts :: getOrCreateSession`) | Reuses the latest session for a source video by `sourceVideoId`, ordered by `updatedAt`, rather than creating a duplicate. | A `remixSessions` row already exists for a video. | `getOrCreateSession(videoId)` a second time. | The same session id is returned; no second row is inserted. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | server action (`src/server/actions/remix-actions.ts :: updateStageAction`) | A partial patch sets only the fields given; `styleVaultItemId` and `chosenVariantIndex` can be explicitly cleared back to null, not merely set. | A session with `styleVaultItemId` and `chosenVariantIndex` both set. | `updateStageAction(id, { styleVaultItemId: null })`, then `updateStageAction(id, { chosenVariantIndex: null })`. | Each field reads back null after its own call; the other untouched fields are unchanged. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | server action (`src/server/services/remix.ts :: buildResearch`) | Assembles source analysis, a transcript excerpt capped at 500 characters, and the top 5 similar outliers with zero model calls, and persists them to `researchNotes`. | A session whose source video is analyzed and transcribed. | `buildResearch(id)`. | The returned notes and the session's `researchNotes` column match; no model is called. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/services/remix.ts :: buildHookPrompt`) | A seeded vault item's `templateText` is used as the hook pattern when `opts.vaultItemId` is given; a missing or empty lookup falls back to the source's `hookType`. | A vault hook item and a session whose source has an analysis. | `buildHookPrompt(id, { vaultItemId })`, then again with a nonexistent id. | The first prompt is built from the vault item's text; the second falls back to `describeSourceHookPattern`. | not run: no vitest covers it |
| ACTION-06 | P1 | server action (`src/server/services/remix.ts :: buildOutlinePrompt`) | The structure in the outline prompt comes from the session's `styleVaultItemId` template when set, else the source's structure segments described in prose. | A session with `styleVaultItemId` set to a real vault style item. | `buildOutlinePrompt(id)`. | The built prompt's structure text matches the vault item's `templateText`, not the source's segments. | not run: no vitest covers it |
| ACTION-10 | P1 | server action (`src/server/services/remix.ts :: saveScript`) | Inserts a `scripts` row with `remixSessionId` set to the session and `hookVaultItemId` always null; when `variantIndex` is given it also sets the session's `chosenVariantIndex`. | A session with a generated variant. | `saveScript(id, content, title, 1)`. | A new `scripts` row exists with `remixSessionId: id`, `hookVaultItemId: null`; the session's `chosenVariantIndex` reads back `1`. | 🟢 covered by vitest (green) |
| ACTION-11 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | Reuses the most recent `plannedPosts` row already linked to the session by `remixSessionId`, rather than inserting a second. | A session with an existing linked plan. | `finishRemix(id)` twice. | Both calls return the same `postId`; `created` reads `false` on both, since the row already existed before the first call in this setup. | 🟢 covered by vitest (green) |
| ACTION-12 | P1 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | Reconciles the plan's `scriptId` to the session's current `chosenVariantIndex` text, writing a fresh `scripts` row when the two have diverged, or reusing a matching one when found. | A session where a saved variant was later re-picked to a different, unsaved one. | `finishRemix(id)`. | A new `scripts` row is written matching the currently chosen variant's text; the plan's `scriptId` points at it, not the earlier stale save. | 🟢 covered by vitest (green) |
| ACTION-13 | P2 | server action (`src/server/services/remix.ts :: finishRemix`, `reconcileAttachedScript`) | With no chosen variant, reconciliation returns the latest saved script untouched rather than inventing one. | A session with a saved script but `chosenVariantIndex` null. | `finishRemix(id)`. | No new `scripts` row is inserted; the plan carries the existing saved script's id. | 🟢 covered by vitest (green) |
| ACTION-14 | P1 | server action (`src/server/services/remix.ts :: finishRemix`) | The created `plannedPosts` row has `plannedDate` null, since finishing is not a scheduling decision. | A session with no existing plan. | `finishRemix(id)`. | The new row reads `plannedDate: null`, `state: "draft"`. | 🟢 covered by vitest (green) |
| ACTION-17 | P1 | server action (`src/server/actions/remix-actions.ts :: deleteScriptAction`) | Refuses to delete a script still carried by a planned post, naming the carrying plans; the schema's `set null` on delete is a backstop only, not the enforcement path. | A script attached to one planned post. | `deleteScriptAction(scriptId)`. | Returns `{ ok: false, code: "SCRIPT_CARRIED_BY_PLAN" }` naming the one plan; the script row is not deleted. | 🟢 covered by vitest (green) |
| ACTION-20 | P3 | server action (`src/server/services/remix.ts :: getNicheProfile`) | Reads the `app_settings` row keyed `"niche_profile"`, falling back to "general short-form content" when unset. | `app_settings` with no `niche_profile` row. | `getNicheProfile()`. | Returns the literal string "general short-form content". | 🟢 covered by vitest (green) |
| ACTION-21 | P1 | service (`src/server/services/remix.ts :: saveAgentScript`) | A hook list, outline, and script saved the way the MCP tools save them read back through the studio's read path with no model call. A later agent save beats an older variant at finish. | Migrated DB with a seeded video. | `updateStage` with `chosenHook` and `hookOptions`, then with `outline`; `saveAgentScript`; then `getOrCreateSession`. Second case: old variant picked, `saveAgentScript`, `finishRemix`. | The session carries the hooks and outline, `variants` holds the script with `chosenVariantIndex` 0, and finish attaches the agent's text. | 🟢 covered by vitest (`remix.test.ts`, agent-written stages) |
| ACTION-22 | P0 | service (`src/server/services/remix.ts :: saveAgentScript`, `editVariant`, `editBeat`) | Agent script saves are one transaction and idempotent for identical text; a Script or Style tab opened before an agent save keeps the agent's variants and beats when a field blurs, with or without an edit, and `chosenVariantIndex` stays in range. | Migrated in-memory DB with a seeded video. | Concurrent and retried `saveAgentScript`, a failing `scripts` insert; render `StageScript` and `StageStyle` on a stale session, agent-save, then blur. | Both concurrent variants kept, a retry returns the same script id, a failed insert leaves no variant; stale blurs keep `[A, B]` with index 1 and the agent outline. | 🟢 covered by vitest (`remix.test.ts`, `stale-stage-writes.test.tsx`) |

Not checkable by hand:

- Whether a truly concurrent double `finishRemix` on a session with no plan yet can both insert, since there is no unique constraint on `plannedPosts.remixSessionId` backing the read-then-write (open questions, see [architecture](../../../documents/architecture/remix.md)).
- What a real agent writes through MCP, which depends on the agent, not on crowsnest.

## 3. browse-e2e

Coverage: one happy-path journey for each of the six built features (2, 4, 5, 6, 7, 8) and four distinct corner-case types (`empty`, `invalid`, `stale`, `repeat`). Two taxonomy types are left off with a reason, since each is honestly untestable through this component's UI: `concurrency`, because get-or-create returns one shared session and the studio keeps that session in client state, so two tabs racing one field is a server last-write-wins race with no distinct on-screen state to drive or assert (it stays in "Not checkable by hand" and the route/action lens); `network`, `auth`, and `failure`, because remix calls no external service and no model, so no outage can reach these screens.

Testid gap: only `remix-hook-seed-select` (on `stage-hook.tsx`) and the three `remix-copy-prompt-{hook,style,script}` buttons (`copy-prompt-button.tsx`) exist in the current markup. Every other `data-testid` named below is a target that does not exist yet; each journey names it so the QA round knows the row is blocked on adding the testid first, per `references/browse-e2e-qa.md`. The full list is filed as B-20 in GitHub issues (label `backlog`). Offline journeys against a seeded fixture database still show `not run` (authoring only).

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 2 | happy | offline | Set the topic and length on a fresh prompt stage | Dev server up; a never-remixed video with a caption; `/feed/{videoId}/remix` open on prompt. All testids below are targets, not yet in `stage-prompt.tsx`. | Arrive on `/feed/{videoId}/remix` (prompt stage). Act: read `data-testid="remix-topic-input"`; clear it and type a new topic into `data-testid="remix-topic-input"`; open `data-testid="remix-length-select"` and choose 60s; click `data-testid="remix-continue"`. | `data-testid="remix-topic-input"` holds the caption text with "for my niche" appended on arrival; `data-testid="remix-niche-chip"` reads the settings niche; after Continue the stepper marks `data-testid="remix-stepper-step-research"` active; reloading shows the edited topic in `data-testid="remix-topic-input"` and 60s in `data-testid="remix-length-select"`. | `scripts/e2e/remix-e2e-01.sh` | 🟢 pass (browser, driven via DOM ids since the testids in B-20 are still missing): opened a never-remixed video's remix, confirmed the caption-prefilled topic (REMIX-04); on a second fresh session picked 60s from the length select and reloaded, it read 60s after reload; Continue advanced the stepper to Research on the REMIX-06 session (see test-shots/remix/E2E-01.png) |
| E2E-03 | P1 | 4 | happy | offline | Assemble and read the research with no model call | Dev server up; a fresh session whose source video is analyzed and transcribed; no research notes yet. `buildResearch` makes no model call. Testids are targets, not yet in `stage-research.tsx`. | Arrive on prompt; Act: click `data-testid="remix-continue"` to reach research; wait for `data-testid="remix-research-skeleton"` to clear; type a fact into `data-testid="remix-research-facts-input"` and click away to blur. | After assembly `data-testid="remix-research-why"`, `data-testid="remix-research-hook-pattern"`, and `data-testid="remix-research-structure"` are all populated; `data-testid="remix-research-similar-list"` renders; the typed fact persists in `data-testid="remix-research-facts-input"` after reload. | `scripts/e2e/remix-e2e-03.sh` | 🟢 pass (browser, no testids yet, see B-20): same fresh session as REMIX-11/14; why it worked, hook pattern, structure beats, and the similar-posts list were all populated with no model call, and the typed fact in the additions box survived a reload |
| E2E-04 | P1 | 5 | happy | offline | Copy the hook prompt, then see the agent's hook after reload | Dev server up; a session on the hook stage with no hook chosen. `remix-hook-seed-select` and `remix-copy-prompt-hook` exist; the other testids are targets. | Arrive on the hook stage. Act: click `data-testid="remix-copy-prompt-hook"`; seed `chosenHook` on the session (the write `crowsnest_remix_choose_hook` makes); reload; click `data-testid="remix-continue"`. | The copy shows a success toast; after reload `data-testid="remix-hook-chosen-panel"` shows the seeded line; Continue advances to `data-testid="remix-stepper-step-style"`. | none | not run |
| E2E-05 | P1 | 6 | happy | offline | See the agent's outline after reload and hand-edit a beat | Dev server up; a session on the style stage with no outline yet. `remix-copy-prompt-style` exists; the other testids are targets. | Arrive on the style stage. Act: confirm `data-testid="remix-continue"` is disabled; seed `outline` on the session (the write `crowsnest_remix_outline` with an `outline` makes); reload; edit a beat's label in `data-testid="remix-beat-label"` and click away to blur. | Before seeding `data-testid="remix-outline-empty"` reads "No outline yet. Copy the prompt into Claude, then reload to see what it wrote." and Continue is disabled; after reload the beats render, Continue enables, and the edited label persists after another reload. | none | not run |
| E2E-06 | P1 | 7 | happy | offline | Pick a variant tab, edit it, and save the script | Dev server up; a seeded session on the script stage carrying three variants (no model call needed to open, edit, or save). Testids are targets, not yet in `stage-script.tsx`. | Arrive on the script stage. Act: open the second tab `data-testid="remix-variant-tab"` (`data-index="1"`); edit text in `data-testid="remix-variant-editor"`; click `data-testid="remix-save-script"`; confirm the prefilled title in `data-testid="remix-save-title-input"` and click `data-testid="remix-save-confirm"`. | Opening the tab records it as chosen; a toast reading "Script saved" is read via `assert_text`; `data-testid="remix-add-to-plan"` becomes available; reloading reopens on the second `data-testid="remix-variant-tab"`. | `scripts/e2e/remix-e2e-06.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-24; opened Variant 2, edited it, saved with a confirmed title; toast "Script saved", an Add to plan control appeared (see test-shots/remix/E2E-06.png) |
| E2E-07 | P1 | 8 | happy | offline | Finish the remix onto an undated plan | Dev server up; a seeded session on the finish stage with a chosen hook and a chosen variant and no plan yet; `finishRemix` makes no model call. Testids are targets, not yet in `stage-finish.tsx`. | Arrive on the finish stage. Act: read `data-testid="remix-finish-summary-hook"` and `data-testid="remix-finish-summary-script"`; click `data-testid="remix-finish-button"`. | A toast reading "Added to your plan." is read via `assert_text`; `data-testid="remix-finish-button"` is replaced by `data-testid="remix-finish-ready"`; `data-testid="remix-finish-open-studio"` links into the plan's studio. | `scripts/e2e/remix-e2e-07.sh` | 🟢 pass (browser, no testids yet, see B-20): arrived on a finish stage showing the Hook and Chosen script summary sections, clicked Finish; toast "Added to your plan." (see test-shots/remix/E2E-07.png) |
| E2E-08 | P2 | 4 | empty | offline | Research on an unanalyzed source shows the recovery link | Dev server up; a session whose source video has never been analyzed. No model call. Testids are targets, not yet in `stage-research.tsx`. | Arrive on prompt; Act: click `data-testid="remix-continue"` to reach research. | The source-inputs block is replaced by `data-testid="remix-research-unanalyzed-note"` ("this post has not been analyzed"); `data-testid="remix-research-analyze-link"` links to analyze the video; `data-testid="remix-continue"` stays enabled so the user can proceed with no notes. | `scripts/e2e/remix-e2e-08.sh` | 🟢 pass (browser, no testids yet, see B-20): opened remix for a never-analyzed, never-remixed video and continued to research; the source-inputs block read "This post has not been analyzed, so there is nothing to feed the stages yet... Analyze the source post." with a working link, and Continue stayed enabled (see test-shots/remix/E2E-08.png) |
| E2E-10 | P2 | 6 | invalid | offline | A blank or non-number beat seconds coerces to zero | Dev server up; a seeded session on the style stage with an outline present (no model call to edit). Testids are targets, not yet in `stage-style.tsx`. | Arrive on the style stage with beats shown. Act: clear the first `data-testid="remix-beat-seconds"`; type letters into it; click away to blur. | The keystroke is coerced, not refused: `data-testid="remix-beat-seconds"` reads 0 after blur, and the value persists as 0 after reload. | `scripts/e2e/remix-e2e-10.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-21 |
| E2E-11 | P2 | 7 | stale | offline | A saved script's Add-to-plan row disappears after reload | Dev server up; a seeded session on the script stage with three variants; the saved-script id lives only in page state. Testids are targets, not yet in `stage-script.tsx`. | Arrive on the script stage. Act: open a `data-testid="remix-variant-tab"`; click `data-testid="remix-save-script"` and confirm with `data-testid="remix-save-confirm"`; confirm `data-testid="remix-add-to-plan"` is present; reload the page. | Before reload `data-testid="remix-add-to-plan"` is present; after reload it is absent even though the earlier save is durable (the saved script still opens from the Vault); no error is shown. | `scripts/e2e/remix-e2e-11.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-24 on a separate session; Add to plan was present right after saving; after a reload it was gone from the page text, no error shown, and the `scripts` row from the save was still present in the db (durable) (see test-shots/remix/E2E-11.png) |
| E2E-12 | P1 | 8 | repeat | offline | Finishing twice reuses the one plan | Dev server up; a seeded session on the finish stage with no plan yet; `finishRemix` is idempotent and makes no model call. Testids are targets, not yet in `stage-finish.tsx`. | Arrive on the finish stage. Act: click `data-testid="remix-finish-button"`; reload so the button returns; click `data-testid="remix-finish-button"` again. | Both clicks land on the same plan: after the first `data-testid="remix-finish-ready"` shows; after the reload and second click `data-testid="remix-finish-open-studio"` links to the same plan, and `assert_text` on the plan calendar confirms exactly one draft for the session. | `scripts/e2e/remix-e2e-12.sh` | 🟢 pass (browser, no testids yet, see B-20): same drive as REMIX-26 (see test-shots/remix/E2E-12.png) |
| E2E-14 | P1 | 7 | happy | offline | The agent's saved script shows on the script stage | Dev server up; a session on the script stage after one `crowsnest_remix_save_script` call. `remix-copy-prompt-script` exists. | Arrive on the script stage. Act: read the stage; click `data-testid="remix-copy-prompt-script"`. | The saved script shows as the open variant tab; `remix-copy-prompt-script` shows a success toast; `data-testid="remix-continue"` is enabled. | none | not run |

Not checkable by hand:

- Whether two tabs on one shared session converge (last write wins per field) or interleave a half-applied outline needs real concurrency, which the shared-session model gives no distinct on-screen state to drive; it stays in the behavior and route/action lenses' open questions.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-03 | P2 | No buyer data leaving the box | The prompts remix builds carry only the session's own text and the source video's stored analysis fields, never another table's rows or raw media. | A session with facts, a chosen hook, and an outline set. | 1. Inspect the `{ system, user }` strings `buildHookPrompt`, `buildOutlinePrompt`, and `buildScriptPrompt` return. | Each prompt contains only topic, niche, facts, hook or structure text, persona lines, and the source's `hookType` / `structureSegments` / `whyItWorked`; no other video's or channel's data appears. | not run |

Security-lite has no rows for a license gate or a sidecar shared-token check: remix has no license check of its own, and it never calls the sidecar or a model. "No buyer data leaving the box" is otherwise covered by SEC-03: remix has no outbound path; the prompt text it builds goes only to the MCP client that asked for it.
