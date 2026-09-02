# Vault and Remix flows

Scope: seven flows across two groups. Group E covers the Vault (browsing saved hook
and style templates, creating one by hand, and pulling one into a remix). Group F
covers the Remix Studio (the fast path, the five stage pipeline, editing and saving a
script, and exporting a script as a prompt). Everything below describes what the code
does today, read from `src/components/vault/*`, `src/app/(shell)/vault/page.tsx`,
`src/server/queries/vault.ts`, `src/server/actions/vault-actions.ts`,
`src/components/remix/*`, `src/server/services/remix.ts`,
`src/server/services/prompts/remix-prompts.ts`, `src/server/services/export.ts` and
`src/server/db/schema.ts`. Where behaviour is missing rather than wrong, the block
says so instead of describing an intended design.

Two conventions for this file. First, the app's real UI strings often contain a long
dash; a writing hook blocks that character in docs, so quoted labels here swap it for
a comma, a colon or parentheses. The wording is otherwise verbatim. Second, current
real data is 6 vault items, 2 saved scripts and 0 remix sessions, so every remix flow
below is described from a cold start.

One thing that colours the whole document: the north star is to take a viral video's
hook, script and layout and regenerate it in Kai's own style. Half of that (layout)
has no data behind it yet. See F2's Style stage.

## Group E: vault

### E1. Browse saved templates

**Entry.** Four ways in. The sidebar nav item "Vault" (`NAV_ITEMS` in
`src/components/layout/nav-items.ts`, Archive icon, fourth of five routes). The
Cmd+K palette, which lists the same five routes under a "Navigate" group. A direct
visit to `/vault`. And a deep link to `/vault?tab=scripts`, which is what the Script
stage's save toast action and its inline "View in Vault" link both point at.

**Screen.** A single column, max width 1120px, padding 24px, top to bottom:

1. Header row. Left: `h1` "Vault" and the subtitle "Your library of extracted hook
   and style templates, plus saved scripts." Right: the `NewTemplateDialog` trigger,
   a small primary button reading "+ New template" (flow E2).
2. `Tabs` with a `TabsList` of three triggers: Hooks, Styles, Scripts. The default
   tab comes from `?tab=`, validated against `["hooks","styles","scripts"]`, falling
   back to "hooks".
3. Tab body. Hooks and Styles render a `TemplateGrid`: a CSS grid,
   `repeat(auto-fill, minmax(260px, 1fr))`, 16px gap, one `TemplateCard` per row from
   `getVaultItems(type)`. Scripts renders the same grid shape with one `ScriptCard`
   per row from `getScripts()`.

A `TemplateCard`, top to bottom: card title (the item's `title`); a `MoreHorizontal`
dropdown trigger in the card action slot; the template text clamped to three lines,
with `{slot}` tokens rendered as inline secondary `Badge` chips (the regex is
`/(\{[a-zA-Z0-9_]+\})/g`, so `{topic}` renders as a chip labelled `topic`); the tags
as outline badges; then either a source chip (a play icon plus the channel handle,
linking to `/feed/<videoId>`) or the plain text "Manual entry"; then a small
secondary button "Use in Remix" (flow E3).

A `ScriptCard`, top to bottom: the script title on the left with a status badge on
the right (filled variant when `status === "final"`, outline otherwise, and today
every row is "draft"); the first line of the script content clamped to two lines; a
badge row showing the linked hook template title and style template title when
present; the source video's channel handle as a link; and a small outline button
"Create Prompt" (flow F4).

**Actions.**

- Click a tab. Client side switch, no refetch, all three lists are already loaded on
  the server.
- Click the card title's dropdown. Two items. "View source video" links to
  `/feed/<videoId>` and only renders when the item still has a source video. "Delete"
  is destructive and opens a confirm dialog.
- Confirm delete. Runs `deleteVaultItemAction(item.id)`. On success: toast "Template
  deleted" and `router.refresh()`. On failure: an error toast carrying the raw error
  message, and the card stays.
- Cancel delete. Closes the dialog, nothing is sent.
- Click the source chip or the "Manual entry" text. The chip is a link to the source
  video; "Manual entry" is inert text.
- Click "Use in Remix". Flow E3.
- Click "+ New template". Flow E2.
- Scripts tab, click "Create Prompt". Flow F4.
- Scripts tab, click the channel handle. Links to the source video.

**System.** `VaultPage` is an async server component. It runs
`Promise.all([getVaultItems("hook"), getVaultItems("style"), getScripts(), searchParams])`.

`getVaultItems` selects from `vault_items`, left joins `videos` on
`vault_items.source_video_id` and left joins `channels` on `videos.channel_id`,
filters by `type` when given, orders by `created_at` descending. The source chip is
only populated when both `sourceVideoId` and `channelHandle` come back non null.
`tags` defaults to `[]`.

`getScripts` selects from `scripts` with the same two left joins, orders by
`created_at` descending, then runs one extra batched query against `vault_items`
using `inArray` over every distinct `hook_vault_item_id` and `style_vault_item_id`,
to resolve those two titles. Deletion of a linked vault item leaves the id null (the
FK is `on delete set null`), so the badge simply disappears.

`deleteVaultItemAction` is a plain `db.delete` on `vault_items` by id, wrapped in a
try/catch that returns `{ ok: false, error }`.

**Failure.**

- Delete fails at the database level: error toast with the raw driver message. Not
  user friendly, but nothing is lost.
- The card is not removed optimistically; if `router.refresh()` does not land the
  card stays on screen until the next navigation.
- A deleted source video sets `vault_items.source_video_id` to null, so a template
  that was extracted from a real video silently becomes "Manual entry". Nothing marks
  it as orphaned, and the "Use in Remix" button loses its target. This is exactly
  what happened to the two deleted remix sessions in the current data.
- If the video row survives but its channel row does not, `channelHandle` is null and
  the query treats the item as having no source, same fallback.
- A malformed `tags` JSON blob would surface as an empty tag row, not a crash.

**Empty.** Three distinct empty states.

- True empty vault (zero hooks and zero styles). Both the Hooks and Styles tabs show
  a centered block: the text "No templates yet, save a hook or style from any video
  to start your Vault." plus a primary button "Browse the Feed" linking to `/feed`.
- One tab empty while the vault has items elsewhere. Just a line of muted text: "No
  hooks saved yet." or "No styles saved yet." No button.
- Scripts tab empty. "No scripts yet, write one in the Remix Studio." No button, and
  no link to the Feed, so this one is a dead end from the Vault.

**Open question.** The Vault has no search, no tag filter and no sort control. At 6
items that is fine. It is unknown what Kai expects at 50 or 200, and whether tags are
meant to be a filter dimension or just a label. Second: there is no way to edit a
saved template. The only operations are create and delete, so fixing a typo means
retyping the whole thing. Third: the Scripts tab has no delete and no way to flip a
script from "draft" to "final", even though the column exists.

### E2. Create a template by hand, without a source video

**Entry.** The "+ New template" button in the Vault header. It is visible on all
three tabs, including the Scripts tab, where it still creates a hook or style
template rather than a script.

**Screen.** A modal `Dialog` titled "New template" with the description "Add a hook
or style template by hand." Four fields stacked, then a footer:

1. Type. A `Select` with two options, Hook and Style. Default Hook.
2. Title. An `Input`, placeholder "Curiosity Gap Hook".
3. Template text. A `Textarea`, 3 rows, placeholder "the {topic} nobody is talking
   about (yet)".
4. Tags (comma separated). An `Input`, placeholder "curiosity, warning".
5. Footer: one button, "Save template", which reads "Saving..." while pending.

**Actions.**

- Change Type. Local state only, switches which `type` value is sent on save.
- Type into Title, Template text or Tags. Local state, nothing is sent per keystroke.
- Click "Save template". Disabled while `title` or `templateText` is empty, or while
  a save is in flight. Sends the create action.
- Close the dialog (Escape, the close control, or a click outside). Resets all four
  fields back to their defaults through `reset()`, so a half typed template is lost
  with no warning.

**System.** `createVaultItemAction({ type, title, templateText, tags })` inserts one
row into `vault_items`: `id` from `newId()`, the four form values, `sourceVideoId`
explicitly null (that is what makes it a "Manual entry" card), `createdAt` from
`nowIso()`. Tags are parsed client side by splitting on commas, trimming, and
dropping empties. On `{ ok: true }` the dialog toasts "Template saved to Vault",
closes, resets, and calls `router.refresh()` so the new card appears in its tab.

**Failure.**

- Database insert fails: error toast with the raw message, dialog stays open with the
  typed values intact. This is the one place in the Vault where a failure preserves
  the user's work.
- A title of only spaces passes the disabled check, since the guard is a falsy check
  on the string, not a trim. The result is a card with a blank looking title.
- No duplicate detection. Saving the same title twice creates two rows.
- No validation of the `{slot}` syntax. A typo like `{ topic }` (with spaces) will
  not match the chip regex and just renders as literal text.

**Empty.** Not applicable, the dialog always opens blank. Worth noting the downstream
effect though: a hand made template has no source video, so its card shows "Manual
entry" and its "Use in Remix" button cannot deep link anywhere (see E3's failure
list).

**Open question.** The slot chips are cosmetic. `renderTemplateText` draws `{topic}`
as a chip, but nothing ever substitutes a value into it: `generateHooks` passes the
template text verbatim to the model as `pattern`, and `generateOutline` passes it
verbatim as `structure`. So the model sees the literal characters `{topic}` and is
left to interpret them. Kai needs to decide whether slots become a real substitution
feature (fill `{topic}` with the session topic before the prompt is built) or whether
the chips should stop implying a mechanism that does not exist.

### E3. Use a template (how a Vault item gets pulled into a remix)

**Entry.** Four distinct paths, only one of which is a deliberate "use this" gesture:

1. The "Use in Remix" button on a `TemplateCard`.
2. The Hook stage's "Seed from a Vault hook" `Select`, inside an open studio.
3. The Style stage's "Structure" `Select`, inside an open studio.
4. Indirectly, at export time: a saved script's linked style template is read back by
   `buildScriptPrompt` (flow F4).

**Screen.** For path 1 there is no intermediate screen. The click either navigates
straight to the Remix Studio or fires a toast. For paths 2 and 3 the screen is the
stage itself, described in F2.

**Actions.**

- "Use in Remix" on a card that has a source video. Pushes
  `/feed/<sourceVideoId>/remix?<type>=<itemId>`, where `<type>` is literally the
  item's type, so `?hook=<id>` or `?style=<id>`.
- "Use in Remix" on a card with no source video. No navigation. An info toast reads:
  "Press Cmd+K and pick a video to remix, this template will be waiting in that
  stage."
- Pick a Vault hook in the Hook stage's Select. Local state only. It is read when
  "Generate 5 hooks" is clicked, and is not persisted anywhere.
- Pick a Vault style in the Style stage's Select. Persists immediately to
  `remix_sessions.style_vault_item_id` through `updateStageAction`, and can be
  reverted to "Source video's structure", which writes null.

**System.** The remix page reads `searchParams.hook` and `searchParams.style` and
hands them to `RemixStudio` as `seedHookVaultItemId` and `seedStyleVaultItemId`.
`resolveDeepLinkSeed` (in `src/components/remix/deep-link.ts`) then decides three
things, once, on mount:

- Validity. An id is only honoured if it appears in the `vaultHooks` or `vaultStyles`
  list the page already loaded. An unknown or deleted id is dropped silently.
- Which stage to open. It jumps to the seeded stage only when the session is fresh,
  meaning `session.stage === "prompt"`. A session with real progress keeps its own
  stage and the seed is applied whenever that stage is reached. If both ids are
  given, Style wins the jump because it is the later stage.
- What to persist. A style seed is written into `remix_sessions.style_vault_item_id`
  by a fire and forget `updateStageAction` in a mount effect. A hook seed is not
  persisted at all, because there is no column for it; it rides down to `StageHook`
  as the ephemeral `initialVaultItemId` prop.

At generation time the template text is what actually reaches the model.
`generateHooks` calls `getVaultItemTemplateText(vaultItemId)` and passes the result
as `pattern` in `buildHookUser`, under the line "Hook pattern to mirror:". If the
lookup returns null it falls back to `describeSourceHookPattern(analysis)`, which is
the analysed `hookType` or the literal string "curiosity-gap".

`generateOutline` reads `session.styleVaultItemId` from the row (not from a
parameter), looks up the same way, and passes it as `structure` under "Structure
pattern to follow:". Its fallback is `describeSourceStructure(analysis)`, which
joins the analysed structure segments into
`Label (startSec-endSec s): note; Label ...`, or returns "No source structure
available, use a natural hook / build / payoff / CTA structure." when there is no
analysis.

**Failure.**

- The Cmd+K toast is wrong. The command palette only lists the five nav routes; it
  cannot search or pick a video. So a manually created template, or one whose source
  video was deleted, has no working "use this" path at all beyond opening a studio by
  hand and picking the template from the stage Select.
- A stale id in the URL (template deleted since the link was made) is ignored with no
  message. The studio opens at the Prompt stage as if no deep link was given.
- A deep link into a session that already progressed past Prompt does not jump, and
  gives no indication that a seed was received.
- A hook seed does not survive a page refresh, since it is never persisted.

**Empty.** With an empty vault, neither Select is a dead end. The Hook stage shows
"None, use source hook pattern" as the selected default plus one disabled option "No
saved hooks yet". The Style stage shows "Source video's structure" plus a disabled
"No saved styles yet". Generation still runs off the source video in both cases.

**Open question.** Which Vault hook seeded a generation is never recorded.
`remix_sessions.chosen_hook` stores the picked hook's text, not an id, so
`saveScript` always writes `hookVaultItemId: null`. Consequence: a saved script never
shows a hook badge in the Vault, and `buildScriptPrompt`'s hook section always falls
back to the source analysis. Fixing this needs a new column on `remix_sessions` (for
example `hook_vault_item_id`), which is a schema decision, not a UI one.

## Group F: remix

### F1. Quick remix, the fast path

**Entry.** The Prompt stage, and only the Prompt stage. The button sits at the bottom
of the stage body, a secondary button labelled "Quick Remix" followed by a sparkle
emoji. It is disabled when the topic is empty, when `hasLlmKey()` is false, or while
a run is already in flight (label switches to "Running Quick Remix...").

**Screen.** No dedicated screen. The button label changes, and nothing else in the
studio moves until the run finishes. When it does, the studio jumps to the Script
stage with all five stepper segments reachable and every earlier stage populated and
editable.

**Actions.**

- Click "Quick Remix". Runs the whole chain server side, then reloads the session and
  sets the active stage to whatever the reloaded row says (normally "script").
- There is no cancel. Once clicked the only exit is waiting or reloading the page.
- Everything the run produced can be revised afterwards by clicking back through the
  stepper: the topic, the facts box, the chosen hook, the outline beats, the variants.

**System.** `quickRemixAction(session.id)` calls `quickRemix` in
`src/server/services/remix.ts`, which runs strictly in sequence:

1. `buildResearch(id)`, then `updateStage(id, { stage: "research" })`. No model call.
2. `generateHooks(id)`, then `updateStage(id, { chosenHook: hooks[0] ?? "", stage: "hook" })`.
   One model call. The first returned hook is auto picked.
3. `updateStage(id, { stage: "style" })`, then `generateOutline(id)`. One model call.
4. `generateVariants(id)`, then `updateStage(id, { stage: "script" })`. Three model
   calls, issued in parallel through `Promise.allSettled`.

So five model round trips in total (1 hook, 1 outline, 3 variants), all of them
9router calls in the current setup, plus zero calls for research. Each step persists
before the next begins, which means a mid chain failure leaves real partial progress
in the row rather than nothing.

Afterwards the client calls `getOrCreateSessionAction(detail.item.videoId)` and
replaces its local session state with the fresh row.

**Failure.**

- Any throw in steps 1 to 4 aborts the chain. The client toasts the mapped error
  string and clears the pending flag. The session keeps whatever it reached, but the
  studio does not move to that stage, so the user is left on Prompt with no visible
  sign that (for example) research and hooks did complete. Clicking through the
  stepper is the only way to find out.
- Proxy down. `getLlm()` succeeds (it only checks that `ANTHROPIC_API_KEY` is set),
  the SDK call then fails with `APIConnectionError`, and `llmErrorMessage` maps it to
  the toast "Network error reaching Claude". That message is misleading: text
  generation is meant to run on the local 9router proxy at `ANTHROPIC_BASE_URL`, so
  the real cause is usually a dead local process, not the network or Anthropic.
- All three variants fail. `generateVariants` still resolves (per variant isolation
  via `Promise.allSettled`), `quickRemix` completes, and the studio lands on the
  Script stage showing its empty state, "Generate to see variants here.", with no
  explanation of why the run produced nothing.
- The run takes minutes. There is no progress indicator during Quick Remix (unlike
  the Script stage, which at least cycles a fake status line), so a slow local model
  is indistinguishable from a hang.

**Empty.** On a fresh session nothing exists yet, so Quick Remix is the first thing
the user can do after the topic prefill lands. On a video with no analysis and no
transcript, research assembles an almost empty note set and the model works from the
topic, the niche and nothing else.

**Open question.** Quick Remix overwrites without asking. Running it on a session
where a hook was already chosen replaces `chosenHook` with `hooks[0]`, regenerates
the outline, and replaces the whole `variants` array. There is no confirm step and no
undo. Kai should decide whether Quick Remix is "start over" (in which case say so) or
"fill in the blanks" (in which case it should skip fields that already have values).

### F2. The five stage pipeline: Prompt, Research, Hook, Style, Script

**Entry.** Three ways. The sticky footer button "Remix this video" at the bottom of
Video Detail. A Vault template card's "Use in Remix" (flow E3). A direct visit to
`/feed/<videoId>/remix`.

**Screen.** A full height two column layout.

Left, `ContextRail`, fixed 220px wide, scrollable, persistent across all five stages:
a back link "Video Detail"; a 9:16 thumbnail with the `OutlierBadge` in its top right
corner and a play glyph behind it; the channel avatar and handle, linking to
`/channels/<id>`; the caption clamped to four lines; and a "View full transcript"
button that opens a `Sheet` with the transcript, disabled when there is no transcript
row.

Right column, top to bottom:

1. `Stepper`, in a bordered header strip. Five numbered segments joined by hairline
   separators: Prompt, Research, Hook, Style, Script. The active one is filled with
   the primary colour, completed ones show a green check (`#34D399`), future ones are
   dimmed and disabled. Clicking a completed segment jumps back to it.
2. The stage body, scrollable, 24px padding. Contents per stage below.
3. A footer strip with "Back" on the left (disabled on Prompt) and "Continue" on the
   right (hidden on Script).

Stage 1, Prompt (`StagePrompt`). A topic `Input` labelled "What's this script about?",
prefilled with the source caption plus the suffix "for my niche". A read only niche
`Badge` (truncated at 320px) with an "Edit in Settings" link beside it. A target
length `Select` offering 30s, 45s, 60s and 90s, defaulting to 45. A keyless `Alert`
when there is no key. Then the Quick Remix button (flow F1).

Stage 2, Research (`StageResearch`). Four blocks. "Source analysis": either a
bordered card with the `hookType` as an outline badge, the format tags as secondary
badges, and the `whyItWorked` paragraph, or the line "No analysis yet, analyze the
source video from Video Detail first for richer research." "Transcript excerpt": the
first 500 characters of the transcript in a bordered box clamped to four lines, or
"No transcript available." "Facts and notes": an editable 4 row `Textarea` with the
placeholder "Add anything you want the Hook/Style/Script stages to know about...".
"Similar tracked outliers": up to five rows, each a link to `/feed/<videoId>` showing
the channel handle, the caption, and the outlier multiplier right aligned; or
"Analyze more videos to see patterns here."

Stage 3, Hook (`StageHook`). If a hook is already chosen, a pinned box at the top
with the label "Chosen hook" and the text. Then a row with the "Seed from a Vault
hook" `Select` (256px) and a primary button reading "Generate 5 hooks", or
"Regenerate 5 hooks" once drafts exist. Then the keyless alert if applicable. Then
either five skeleton cards (while generating), or a two column grid of five `Card`s,
each holding an editable 3 row `Textarea` and two buttons, "Use this hook" (which
becomes "Selected" with a check on the chosen one, and rings the card in the primary
colour) and "Save as template". If nothing has been generated: "Generate 5 hooks to
get started."

Stage 4, Style (`StageStyle`). A row with the "Structure" `Select` (256px, default
"Source video's structure") and a primary button "Generate outline", or "Regenerate
outline" once beats exist. Then the keyless alert. Then either four skeletons, or an
ordered list of beats, each row being a narrow numeric `Input` for `targetSec`, a
bold `Input` for the beat label, and a 2 row `Textarea` for the beat content. If
empty: "Generate an outline to get started."

Stage 5, Script (`StageScript`). Empty state: the keyless alert if applicable, the
line "Generate to see variants here.", and a "Write script" button. Pending state: a
status line cycling through "Researching pacing...", "Writing variant 1...",
"Writing variant 2...", "Writing variant 3...", "Polishing..." every 1200ms, plus
three tall skeletons. Result state: a `Tabs` strip with one trigger per variant
("Variant 1", "Variant 2", ...), each panel holding either a 12 row monospace
`Textarea` or, for a failed variant, a destructive `Alert` titled "Couldn't generate
this variant" with the error text. Under the panel: "Regenerate" (or "Retry" on a
failed one) and "Copy". Below a divider: "Regenerate all", "Create Prompt", "Save
script", and after a save an inline "View in Vault" link.

**Actions.**

- Stepper segment click. Only allowed for stages at or before `session.stage`, the
  furthest reached. It changes the view, never the stored stage.
- "Continue". Advances the view and, if this is new ground, writes the new stage to
  `remix_sessions.stage`. It is gated: from Prompt it needs a non empty topic; from
  Research it is always allowed; from Hook it needs a chosen hook; from Style it
  needs an outline. There is no Continue on Script.
- "Back". Moves the view one stage earlier. Never writes.
- Prompt: edit the topic (persisted on blur), change target length (persisted
  immediately), click through to Settings, run Quick Remix.
- Research: type in the facts box (persisted on blur into `researchNotes.facts`),
  open a similar outlier in the Feed.
- Hook: pick a Vault seed, generate or regenerate five hooks, edit any hook's text,
  choose a hook (persists `chosenHook`), save a hook as a Vault template.
- Style: pick source structure or a Vault style (persists immediately), generate or
  regenerate the outline, edit any beat's seconds, label or content (each persisted
  on blur as the whole outline).
- Script: write, regenerate one variant, regenerate all, edit a variant, copy a
  variant, create a prompt, save a script. Covered in F3 and F4.
- Context rail: back to Video Detail, open the channel, open the transcript sheet.

**System.** The page (`src/app/(shell)/feed/[videoId]/remix/page.tsx`) is a server
component. It loads `getVideoDetail(videoId)` (404 if missing), then in parallel
`getOrCreateSession(videoId)`, `getVaultItems("hook")`, `getVaultItems("style")`,
`getNicheProfile()` and the search params.

`getOrCreateSession` returns the newest `remix_sessions` row for that video ordered
by `updated_at`, whatever stage it is at, or inserts a fresh row at stage "prompt".
`getNicheProfile` reads `app_settings` where `key = "niche_profile"`, defaulting to
the string "general short-form content". Kai's real value is the locked niche: Claude
Code power user systems (agents and skills) for solo builders.

Persistence is one generic function, `updateStage(id, patch)`, which sets whichever
of `topic`, `niche`, `targetLengthSec`, `chosenHook`, `styleVaultItemId`, `stage`,
`researchNotes`, `outline` and `variants` the patch carries, plus `updatedAt`.
`outline` is JSON stringified on the way in because the column is plain text;
`parseOutline` returns null on malformed JSON, so a corrupt row reads as "no outline
yet" instead of crashing. Client side, every one of these calls goes through
`autosave()`, which is fire and forget and toasts "Autosave failed" on a rejected
promise or an `{ ok: false }` result.

Per stage server work:

- Prompt. No model call. A mount effect writes the prefilled topic once, guarded on
  `session.topic === null`, so a user who never touches the field still gets the "for
  my niche" framing rather than the bare caption.
- Research. `buildResearchAction` runs `buildResearch(id)`, which makes zero model
  calls: it reads the `video_analyses` row, slices the transcript to 500 characters,
  and calls `getSimilarOutliers(videoId, 5)`. Similarity is a local tag score (3 for
  an exact `hookType` match, 1 per shared structure label, 1 per shared format tag, 1
  per shared style tag). The assembled notes are written straight to
  `research_notes`. It auto runs on stage entry when `researchNotes` is null.
- Hook. `generateHooks` builds `HOOK_SYSTEM` plus `buildHookUser({ topic, niche,
  pattern, facts })` and calls `generateParsed` against `HookOptionsSchema`. The
  result replaces `hook_options`.
- Style. `generateOutline` builds `OUTLINE_SYSTEM` plus `buildOutlineUser({ topic,
  niche, hook, targetLengthSec, structure, facts })` against `OutlineSchema`. The
  result is stringified into `outline`.
- Script. `generateVariants` builds `SCRIPT_SYSTEM` plus `buildScriptUser({ topic,
  niche, hook, outline, targetLengthSec, facts, similar })` and fires `count`
  (default 3) plain text calls through `Promise.allSettled`. Failed slots come back
  as `{ error }` objects and are never written to the database. When called with an
  explicit `index`, exactly one call is made and the server read modify writes that
  one slot so a sibling's concurrent autosave is not clobbered.

The facts box threads through all three generation prompts as an optional "Facts to
incorporate:" line, so anything typed in Research grounds Hook, Style and Script.

Every one of those three calls goes through `getLlm()`, which returns
`CompatLlmClient` when `ANTHROPIC_BASE_URL` is set (the 9router case) and
`AnthropicLlmClient` otherwise. The compat client always streams and reads the result
via `finalMessage()`, concatenating only text blocks so routed models' `thinking`
blocks are dropped, and it implements structured output by putting the JSON Schema in
the system prompt, stripping fences, parsing the outermost braces and validating with
zod, retrying once before throwing `LlmParseError`. Its token ceiling is 8192 rather
than 2048, because routed free models spend a large share of the budget thinking.

**Failure.**

- No key. `hasLlmKey()` is only `Boolean(process.env.ANTHROPIC_API_KEY)`. When false,
  the Prompt, Hook, Style and Script stages each show an `Alert` titled "Add your
  Claude API key" telling the user to add `ANTHROPIC_API_KEY` in Settings, and their
  generate buttons are disabled. Research still works, because it makes no model
  calls.
- Proxy down, and this is the important one. With a key set and the proxy dead,
  nothing is disabled and nothing warns in advance. The user clicks Generate, waits,
  and gets a red toast reading "Network error reaching Claude". The stage looks
  broken rather than blocked. `isCompatMode()` exists in `src/server/llm/client.ts`
  but has no callers outside that file, so no part of the UI knows it is talking to a
  local proxy, and no part of the UI shows the proxy's health. There is also no
  Claude Code fallback implemented anywhere in the codebase today; that is a settled
  decision that has not been built.
- Bad model output. The compat client retries once, then throws `LlmParseError` whose
  message ("Claude's response didn't match the expected structured-output schema,
  even after a retry.") is passed straight to the toast. On a free routed model this
  is the most likely failure after a dead proxy.
- Other API errors map through `llmErrorMessage`: invalid key becomes "API key
  invalid or revoked, check Settings", 429 becomes "Rate limited, retry in a moment",
  and anything else becomes "Claude API error: <status> (<type>)".
- Autosave failure. A generic "Autosave failed" toast with no retry and no indication
  of which field failed. The typed value stays on screen, so the user can believe it
  is saved.
- Hook text edits are not persisted. Editing a hook's `Textarea` updates local state
  and the parent's `hookOptions`, but no autosave call is wired to it. A refresh
  restores the last generated wording. Only clicking "Use this hook" persists (the
  edited text lands in `chosenHook`).
- Missing analysis. Research shows the nudge line, `describeSourceHookPattern` falls
  back to the literal "curiosity-gap", and `describeSourceStructure` falls back to a
  generic hook/build/payoff/CTA instruction. Generation still runs, just less
  grounded.
- Missing transcript. The excerpt reads "No transcript available." and the context
  rail's transcript button is disabled.
- A single failed variant shows its own destructive alert while the other variants
  are untouched.

**Empty.** A cold session (which is every session today, since there are zero remix
sessions) opens on Prompt with the topic prefilled and every later stage locked
behind the stepper's furthest reached gate. Research auto assembles on first entry.
Hook, Style and Script each show a one line "generate to get started" prompt. An
empty Vault shows disabled placeholder options in both Selects and never blocks a
stage.

**Open question.** Three, in order of weight.

1. The Style stage does not carry layout. Kai's stated goal is same hook, same
   script, same layout. Today the Style stage has exactly two inputs: a Vault style
   template's free text, or the analysed `structureSegments` (labels, timestamps and
   one line notes). Both are derived from the transcript alone. Worse, the analysis
   prompt asks the model for `styleTags` like "fast-cut", "on-screen-text",
   "single-shot" and "b-roll" and for `formatTags` like "talking-head" and
   "screen-record", while giving it only a transcript, a caption and metrics. The
   model has never seen a frame. Those tags are fabricated, and they are not
   cosmetic: `getSimilarOutliers` scores 1 point per shared style tag and 1 per
   shared format tag, so fabricated tags are also driving the Research stage's
   similar list. Once real visual extraction lands (on screen text, caption
   placement, cut rhythm, framing, b-roll pattern), the Style stage needs somewhere
   to show it and the outline prompt needs to consume it. Open question: does layout
   become a sixth stage, a second panel inside Style, or extra fields on the outline
   beats?
2. There is no visible "the proxy is down" state. Kai has said this must be obvious.
   Deciding where it lives is open: a global banner in the shell, a per stage inline
   alert replacing the keyless alert, a health dot in the Settings nav item, or a
   pre flight check that disables generate buttons the way a missing key already
   does. Also open: whether a dead proxy should automatically fall back to Claude
   Code, or ask first, given that fallback costs real money while 9router is free.
3. One session per video, permanently. `getOrCreateSession` always returns the newest
   row for that video, so there is no way to start a second, different remix of the
   same source video, and no session list or history anywhere in the app. Whether
   that is fine (a session is a scratchpad, scripts are the artifact) or a gap
   (Kai wants three angles on the same viral video) is Kai's call.

### F3. Edit and save a script

**Entry.** The Script stage, once at least one variant exists, whether from "Write
script", from "Regenerate all", from a per variant regenerate, or from a Quick Remix
run. Returning to a session later restores the persisted variants from
`remix_sessions.variants`.

**Screen.** As described in F2's stage 5: the variant tabs, the open variant's 12 row
monospace textarea, the per variant Regenerate and Copy buttons, and the footer row
with Regenerate all, Create Prompt and Save script. The save dialog is titled "Save
script" with the description "Saves the currently-open variant to your scripts.", one
Title `Input` prefilled with the session topic (or "Untitled script"), and one Save
button that reads "Saving..." while pending.

**Actions.**

- Switch variant tab. Local only. Note that the Save button always saves whichever
  tab is currently open, not a separately chosen variant.
- Edit the open variant's text. Updates local state per keystroke; on blur it
  persists.
- "Regenerate" on a variant. One model call for that slot, written back into that one
  slot server side.
- "Retry" on a failed variant. The same call, the button just relabels.
- "Copy". Writes the variant text to the clipboard, toast "Script copied", or an
  error toast "Couldn't copy to clipboard, check browser permissions."
- "Regenerate all". Calls `writeScript()` again, which replaces every variant and
  resets the active tab to the first.
- "Save script". Opens the dialog. The trigger is disabled unless the currently open
  tab holds a string (so a failed variant cannot be saved). Editing the title, then
  Save, writes the row.
- After a successful save, a toast appears with an "Open in Vault" action that opens
  `/vault?tab=scripts` in a new tab, and an inline "View in Vault" link appears in
  the footer row.

**System.** On blur, `commitEditBlur` calls `persistSuccesses(results)`, which filters
the results array down to strings, hands them to the parent as `variants`, and
autosaves them into `remix_sessions.variants`.

`saveScriptAction(sessionId, content, title)` calls `saveScript`, which inserts one
row into `scripts`: a new id, the title, the content, `sourceVideoId` copied from the
session, `hookVaultItemId` always null (see E3's open question), `styleVaultItemId`
copied from the session, `status: "draft"`, and both timestamps set to now. It returns
the new script id, which the component keeps only to decide whether to render the
"View in Vault" link.

**Failure.**

- Save fails: error toast with the mapped message, dialog stays open.
- Autosave of an edit fails: "Autosave failed" toast, edited text still on screen.
- A real index bug. `persistSuccesses` filters out failed slots before writing, so if
  variant 2 failed and 1 and 3 succeeded, the persisted array has length 2 and what
  was variant 3 is now stored at index 1. The tab list is rebuilt from that array on
  the next mount, so a later per variant "Regenerate" can write into a different slot
  than the user was looking at before the reload. Worth confirming against a real run
  before treating it as settled, but the code path is plain.
- Double save. Clicking Save twice creates two rows in `scripts`. There is no dedupe,
  no "already saved" state, and no update path: a second save is a second script, not
  a revision of the first.
- No edit after save. Nothing anywhere reads a saved script back into an editor. The
  Vault's Scripts tab is read only apart from Create Prompt.

**Empty.** With no variants, the Script stage shows its empty state and there is
nothing to save. With every variant failed, the tabs render as destructive alerts and
the Save trigger stays disabled.

**Open question.** Two. First, `scripts.status` supports "draft" and "final" but
nothing ever writes "final", so the Vault's status badge is decorative. Does Kai want
a "mark as final" or "mark as posted" action, and should that live in the Vault or in
the studio? Second, saving does not close out the session: the session stays at stage
"script" with its variants intact and no record that one of them became a script.
Whether a saved script should link back to its session (there is no column for it) is
open.

### F4. Export a script as a prompt

**Entry.** Two different exports, which produce different documents from the same
code file.

- Source video scoped. The "Create Prompt" button in the Script stage's footer row,
  and the same button on Video Detail. Both call `buildVideoPrompt(videoId)`.
- Saved script scoped. The "Create Prompt" button on a `ScriptCard` in the Vault's
  Scripts tab. Calls `buildScriptPrompt(scriptId)`.

**Screen.** No screen. Both paths are a single button that copies to the clipboard and
toasts. There is no preview, no dialog, no download and no file.

**Actions.**

- Click "Create Prompt". Builds the markdown server side, then writes it to the
  clipboard, then toasts "Prompt copied, paste into any LLM".
- There is no way to see what was copied without pasting it somewhere.

**System.** `buildScriptPrompt(scriptId)` reads the `scripts` row, then resolves up to
four extra things: the hook template text (only when `hookVaultItemId` is set, which
it never is today), the style template text and its tags (when `styleVaultItemId` is
set), the source video's metrics joined to its channel, and the source video's
analysis row. It then assembles a fixed markdown skeleton, in this order:

1. `# Copy-as-Prompt` plus the script title.
2. "## Topic framing", which is just the script title again. Note it is not the
   session topic; that is not stored on `scripts`.
3. "## Hook strategy". The hook template if linked, else the analysis derived hook
   line (`hookType` plus the first structure segment's note), else "No hook template
   linked, see script content below."
4. "## Structure beats". The style template if linked, else the numbered analysed
   structure segments, else "No style template linked, see script content below."
5. "## Style notes". The style template's tags if any, else the analysis format and
   style tags, else "Analysis pending."
6. "## Research facts". The analysis `whyItWorked` line. The similar outliers list is
   passed in empty here, unlike the video scoped export, so this section is always
   one line.
7. "## Source metrics". Channel, views, outlier multiplier, duration, posted date, or
   the single line "No source video linked."
8. "## Script". The full saved content.
9. A footer pointing back at the Remix Studio.

`buildVideoPrompt(videoId)` has the same section skeleton but is built from the video
instead: topic framing is the caption plus the niche profile, research facts include
the top five similar outliers with their multipliers, and the last section is the full
transcript rather than a script.

Both are wrapped by thin actions in `src/server/actions/export-actions.ts` that turn a
null return into `{ ok: false, error: "Script not found." }` or "Video not found."

**Failure.**

- Script or video row missing: error toast with that "not found" message.
- Clipboard rejected (denied permission, or a non secure context): the write is inside
  a try/catch, so the user gets "Couldn't copy to clipboard, check browser
  permissions." The prompt itself is then lost, since it is only ever held in the
  clipboard. Relevant here: the dev server must be browsed at `localhost`, not a bare
  IP, for other reasons already documented in this project.
- The hook section of a saved script's export is always a fallback, because
  `hookVaultItemId` is always null.
- A saved script whose source video was deleted gets "No source video linked." and
  "Analysis pending." in three sections, leaving essentially the script content and
  its title.

**Empty.** Every section degrades to a placeholder line rather than being omitted, so
the document's shape is identical whether or not the video was analysed. On a fully
empty case (a script with no source video and no linked templates) the export is the
title, five placeholder lines, the script text and the footer.

**Open question.** The Script stage's "Create Prompt" exports the source video, not
the draft the user is looking at. That is a deliberate choice in the code (a comment
calls it "same affordance as Video Detail"), but it means a user who has spent five
stages shaping a script and clicks Create Prompt gets a document about someone else's
video with no trace of their own work. Open: should the Script stage export the
session instead (topic, chosen hook, outline beats, facts and the open variant), keep
the source video export, or offer both? Also open: whether an export should ever be
written to a file or shown on screen instead of only going to the clipboard.
