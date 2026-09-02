# Remix connected to post detail spec

Status: draft. Prototype approved by Kai (remix-e2e-prototype.html). Decisions locked via grilling (Q1 to Q8 plus the 2-part beat refinement and comment-to-regenerate). This spec grounds the prototype in the real code.

## Goal

Make the source video's signal flow through the remix studio end to end, so the script the studio writes is built from the outlier that worked, not a loose paraphrase. Today the generation prompts get topic, niche, chosen hook, outline, and a hand-typed facts box, nothing else. The transcript and whyItWorked are fetched, shown in Research, then dropped before any prompt sees them.

Six parts:
1. Thread the source signal into hook, outline, and script generation: whyItWorked, the structure beats (each with its note and its verbatim per-beat transcript), and the source hook opening line.
2. Frame the source as a structural template in the prompts, not content to copy.
3. Redesign the Research stage so the source signal reads as live input, the facts box reads as an optional addition, and the vault/similar lists drop to a reference row.
4. Put the persona into the cook brief (write-brief.ts never calls getPersona today).
5. Add per-variant angle differentiation to the script stage.
6. Add a comment-to-regenerate box on hook, style, and script that reruns that step with the note as an extra steer.

Plus two small shell additions: a mental-model line under the stepper, and a grounded-in line under each generated result.

Build order: 1, 2, 4, 5, 6 are prompt and service plumbing (do first, they share the same files). 3 is the Research component rewrite. The shell additions ride along with 3.

## What the codebase already gives us for free

The signal is already fetched into the service, just not passed to the prompt builders.
- getAnalysis (remix.ts:155 to 165) returns StoredAnalysisFields: hookType, structureSegments, formatTags, styleTags, whyItWorked. It strips layout on purpose (Q8, keep it stripped).
- structureSegments here are StoredStructureSegment (schemas.ts:46): label, startSec, endSec, note, and transcript (optional). The verbatim per-beat transcript is already on the beat when the video was analyzed after that field shipped.
- generateHooks (remix.ts:289), generateOutline (remix.ts:335), and generateVariants (remix.ts:391) all already call getAnalysis and hold the analysis in scope. They read hookType and structureSegments but ignore whyItWorked and the per-beat transcript.
- buildResearch (remix.ts:232) already reads the flat transcript (transcripts table) and stores researchNotes.sourceAnalysis (with per-beat transcript) plus researchNotes.transcriptExcerpt.

So parts 1 and 2 are mostly passing fields that are already loaded into the prompt builders and adding lines to the system prompts.

## Decisions locked (from grilling)

- Q1: transcript + whyItWorked + structure + hookType/tags feed generation. Layout stays cook-only.
- Q2: the source signal auto-flows into every stage. The facts box stays for the creator's own additions. No retyping.
- Q3: the source is a structural template. The prompt says mirror the hook shape, beat structure, pacing, and the whyItWorked mechanism, write about the creator's topic, do not copy the source words.
- Q4: the 2-part beat (note + verbatim per-beat transcript) is the transcript signal, aligned to structure. When a beat has no per-beat transcript (a video analyzed before that field shipped), send its note alone. No flat-transcript fallback (ponytail cut, see below). Re-analyzing the source fills the per-beat transcript.
- Q5: Research becomes confirmed inputs plus additions.
- Q6: unanalyzed source falls back to topic and niche only, with a link back to Post detail to analyze. No one-click analyze inside Research in this pass.
- Q7: this replaces the earlier PR A. The Research redesign absorbs the UX items. One build.
- Q8: layout out of the remix prompts, kept in the cook brief.
- Comment-to-regenerate: each of hook, style, script gets a steer box. The note threads into that step's prompt like facts does. On script, the steer applies to the single active variant (the existing per-variant regenerate path).

## Part 1 and 2: thread the source signal into the prompts

Grounded: the three prompt builders live in remix-prompts.ts. Each build*User takes plain strings and appends facts when present (remix-prompts.ts:20, 41, 67). withPersona (remix.ts:275) appends the persona after.

Changes to remix-prompts.ts:
- buildHookUser (remix-prompts.ts:18): add `whyItWorked?: string` and `openingLine?: string`. Append "Why the source worked: <...>" and "Source opening line: <...>" when present. HOOK_SYSTEM (remix-prompts.ts:11): add a sentence to mirror the mechanism named in whyItWorked and the rhythm of the opening line, not only the hook pattern category.
- buildOutlineUser (remix-prompts.ts:26): add `whyItWorked?: string`. The structure string it already takes (remix-prompts.ts:39) becomes richer, see describeSourceStructure below. Append the whyItWorked line. OUTLINE_SYSTEM (remix-prompts.ts:24): add a sentence to preserve the whyItWorked mechanism across the beats.
- buildScriptUser (remix-prompts.ts:47): add `sourceBeats?: { label; startSec; endSec; note; transcript? }[]` and `whyItWorked?: string`. Render a "Source that worked" block: the framing sentence (Q3), whyItWorked, and each beat as "label (startSec to endSec): note" plus "said: <transcript>" when the beat has one. A beat with no transcript renders its note alone. SCRIPT_SYSTEM (remix-prompts.ts:45): add the Q3 framing (adapt the structure, pacing, and mechanism to the given topic, do not copy the source words).

Changes to remix.ts:
- describeSourceHookPattern (remix.ts:180): unchanged return, but generateHooks also reads structureSegments[0]?.transcript as the opening line and analysis.whyItWorked, and passes both to buildHookUser.
- describeSourceStructure (remix.ts:184): include the per-beat transcript in each segment line when present, so the outline sees the words per beat, not only the note.
- generateOutline (remix.ts:335): pass analysis.whyItWorked to buildOutlineUser.
- generateVariants (remix.ts:391): pass analysis.structureSegments (as sourceBeats) and analysis.whyItWorked to buildScriptUser. No flat-transcript read.

Anti-fabrication (guard): the per-beat transcript can be undefined on old rows. Undefined means "not captured", render nothing for that beat's transcript, never a placeholder the model would treat as words. This matches write-brief.ts:78 to 86, which already distinguishes absent from empty.

## Part 3: Research stage redesign

Grounded: stage-research.tsx renders five blocks at equal weight (source analysis, transcript excerpt, facts textarea, saved-from-vault, similar). Only facts reaches later stages today. All the data it needs is already on session.researchNotes (sourceAnalysis with per-beat transcript and whyItWorked, transcriptExcerpt, similar) and vaultSavedPosts. No new data, no new persistence.

New layout, top to bottom:
1. Section header "Source inputs, sent to every stage".
2. Why it worked: researchNotes.sourceAnalysis.whyItWorked, tagged "feeds hook, style, script".
3. Hook pattern: the hookType badge and format/style tags, tagged "feeds hook".
4. Structure beats: each beat rendered with its note and its verbatim transcript (the 2-part beat), tagged "feeds hook, style, script".
5. Your additions: the facts textarea, relabeled and marked optional, placeholder says the source above already flows through.
6. A collapsible fallback disclosure: the flat full transcript, shown only as the fallback for un-reanalyzed videos, with one line explaining when it applies.
7. Section header "Reference, not sent": saved-from-vault and similar, visually demoted.

Unanalyzed fallback (Q6): when researchNotes.sourceAnalysis is null, the source-inputs section shows one line ("This post has not been analyzed, so there is nothing to feed the stages yet. The remix falls back to your topic and niche.") and a link to the post detail page to analyze. This is the existing "no analysis yet" copy, moved into the new structure.

## Part 4: persona into the cook brief

Grounded: writeBrief (write-brief.ts:49) builds brief.md from getStudioBrief. It never calls getPersona. The remix prompts do inject persona via withPersona, so the script is on-brand, but the cook has no brand guardrails.

Change: writeBrief calls getPersona (persona.ts) and adds a "## Persona" section (audience, voice, do, don't), each line omitted when empty, same shape withPersona uses. Place it near the top of the brief, after the title, before Hook. getStudioBrief may need to return persona, or writeBrief calls getPersona directly; prefer the direct call to keep the query unchanged.

## Part 5: per-variant angle differentiation

Grounded: generateVariants (remix.ts:391) runs count identical prompts through Promise.allSettled and relies on sampling for variety. The user picks a favorite from three near-duplicates.

Change: when generating the full set (opts.index unset), build a small angle array of length count, one line appended per call, for example: stay close to the source structure and pacing; open from a different hook angle; tighten the pacing and cut the setup. Append the angle line to the user prompt per call. No schema change. When regenerating a single variant (opts.index set), keep that slot's angle.

## Part 6: comment-to-regenerate

Grounded: each generation stage has a generate button wired to an action. stage-hook.tsx generate calls generateHooksAction (remix-actions.ts). stage-style.tsx calls generateOutlineAction. stage-script.tsx regenerate(index) calls generateVariantsAction with an index (the per-variant path already merges one slot, remix.ts:445 to 457).

Changes:
- Service: add `steer?: string` to generateHooks, generateOutline, generateVariants. Append it to the user prompt like facts (a "Steer: <...>" line), only when present.
- Actions: add the steer param to generateHooksAction, generateOutlineAction, generateVariantsAction.
- UI: add a steer textarea plus a "Regenerate with note" button to stage-hook.tsx, stage-style.tsx, and (on the active variant) stage-script.tsx. The note is per-invocation, not persisted. On script it passes index (the active variant) so only that variant reruns.

## Part 7: shell additions

- Mental-model line: one line under the Stepper in remix-studio.tsx, "Turning this post into your script, then into a cook."
- Grounded-in line: under each generated result in stage-hook.tsx, stage-style.tsx, stage-script.tsx, a mono line naming the inputs that fed it, built from session data already in the component (topic, niche, chosenHook, whether facts is set). No server round trip.

## Acceptance criteria

1. A remix on an analyzed source video sends whyItWorked, the source hook opening line, and the structure beats with their per-beat transcript into hook, outline, and script generation (assert on the built prompt strings).
2. SCRIPT_SYSTEM and the script user prompt instruct the model to adapt the source, not copy it (assert the framing line is present when a source is available).
3. A beat with a per-beat transcript sends its words to the script prompt; a beat without one sends its note alone (no flat-transcript fallback, no placeholder).
4. The Research stage shows the source signal as labeled inputs, the facts box as an optional addition, and vault/similar under a "reference, not sent" header. An unanalyzed source shows the fallback line and a link to analyze.
5. brief.md contains a "## Persona" section with the persona fields when set.
6. Generating the full variant set produces three prompts that differ by an explicit angle line. A single-variant regenerate keeps its slot.
7. Hook, style, and script each have a comment-to-regenerate control. The note reaches that step's prompt and reruns it (script reruns only the active variant).
8. The stepper shows the mental-model line, and each generated result shows a grounded-in line.
9. typecheck passes; vitest passes except the known pre-existing outlier-calc failure.

## Testing plan

| Layer | What | Count |
|-------|------|-------|
| Unit | each build*User includes the new fields when present, omits when absent | +3 |
| Unit | a beat without a per-beat transcript sends its note alone, no placeholder (anti-fabrication) | +1 |
| Unit | writeBrief emits a Persona section when persona is set, omits it when empty | +1 |
| Unit | generateVariants appends distinct angle lines for the full set; a single regenerate keeps its index | +1 |
| Unit | steer threads into a build*User when present | +1 |
| Manual | live remix on the AI-tools post, read the generated script, confirm it mirrors the source structure | 1 run |

## Files reference

| File | Change |
|------|--------|
| `src/server/services/prompts/remix-prompts.ts` | add whyItWorked/openingLine/sourceBeats/steer params; update HOOK/OUTLINE/SCRIPT system prompts with the Q3 framing |
| `src/server/services/remix.ts:180` | generateHooks reads opening line + whyItWorked, passes to buildHookUser |
| `src/server/services/remix.ts:184` | describeSourceStructure includes per-beat transcript |
| `src/server/services/remix.ts:335` | generateOutline passes whyItWorked |
| `src/server/services/remix.ts:391` | generateVariants passes sourceBeats + whyItWorked + angle array + steer |
| `src/server/studio/write-brief.ts:49` | call getPersona, add Persona section |
| `src/components/remix/stage-research.tsx` | full redesign: inputs vs additions vs reference, 2-part beats, fallback disclosure, unanalyzed state |
| `src/components/remix/stage-hook.tsx` | steer box, grounded-in line |
| `src/components/remix/stage-style.tsx` | steer box, grounded-in line |
| `src/components/remix/stage-script.tsx` | steer box on active variant, grounded-in line |
| `src/components/remix/remix-studio.tsx` | mental-model line under the stepper |
| `src/server/actions/remix-actions.ts` | steer param on the three generation actions |

## Out of scope

- Layout into the remix prompts. It stays stripped (Q8) and continues to ride into the cook brief only.
- Enriching the similar-outliers reference with each item's own hookType/whyItWorked (a join in getSimilarOutliers). A later pass.
- A dedicated CTA beat in the outline schema. OUTLINE_SYSTEM wording covers the CTA for now.
- One-click analyze inside Research (Q6 deferred).
- Video metadata (channel, score, views, url) as a generation input. It stays rail reference only.
- Flat-transcript fallback for videos analyzed before the per-beat transcript shipped (ponytail cut). A beat with no transcript sends its note alone. Add the fallback only if remixing old un-reanalyzed videos proves the notes too thin.

## Rollback

All changes are additive to prompts, one new brief section, one component rewrite, and per-invocation UI state. No schema change, no migration. Revert the PR to undo. The prompt changes only add fields when present, so a revert cannot strand data.

## Effort

About 6h: 2.5h prompt and service plumbing (parts 1, 2, 5, 6) plus their unit tests, 0.5h brief persona, 2.5h Research redesign plus the shell additions, 0.5h live smoke and review.
