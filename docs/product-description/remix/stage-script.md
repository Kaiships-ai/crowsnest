# The script stage

## Summary

The script stage generates the actual script text, as three variants the user reads, edits, and picks between. It is the fifth of the six remix stages and the richest one: it generates in parallel, isolates a failed variant from the successful ones, lets each variant be edited or regenerated on its own, and ends by saving a chosen variant as a [script](../glossary.md) and optionally putting it on the plan with a date. It needs the [LLM proxy](../foundations/background-jobs.md); without it the stage shows the block panel from [the remix overview](remix-overview.md).

The stage lives inside the [remix studio](remix-overview.md) and is reached by Continue from the style stage or by a stepper click once reached. Its generation attempts are logged to the run log under the script stage.

## The simple case

The user arrives with an outline behind them and clicks Write script. Three variants appear as tabs, each a full script the user can read and edit. They flip between tabs, tweak the wording, and pick the one they want by opening its tab. They click Save script, confirm a title, and the variant is saved to their scripts. If they want a date on it, they add one under Add to plan. Otherwise they Continue to finish.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> empty
    empty --> writing : Write script
    writing --> variants : 3 variants returned
    variants --> writing : Regenerate all
    variants --> regenOne : Regenerate one (single slot)
    regenOne --> variants : slot replaced
    variants --> saved : Save script (title, picks variant)
    saved --> planned : Add to plan (date)
    saved --> variants : edit or regenerate the saved slot (save cleared)
```

### Arrive

The stage opens on the variant the session already records as chosen, so returning does not silently move the pick to the first variant. If the session has variants, they appear as tabs; if not, the stage shows a grounded in line naming what will feed generation and a single Write script button. A line above the controls names the inputs that ground generation: the structure beats, why the source worked, the chosen hook, and the user's own facts, each shown only when present.

### Leave without acting

Leaving before generating records nothing new; the session keeps whatever it had. The grounded in line and the empty state are not state, so nothing is lost.

### Begin acting

Write script generates three variants in parallel, each against one of three fixed angles: stay close to the source, open from a different hook angle, and tighten the pacing. While it runs the stage shows an indeterminate writing state with three placeholders; it does not claim to know which variant is being written, because the call is atomic with no incremental signal.

### While acting

When the variants return they replace the tab set and the active tab resets to the first. Each variant is an editable text area. Editing a variant updates it locally on each keystroke and saves the whole set on blur. Opening a variant's tab is the pick: it is recorded immediately so the finish view and the cook brief read the variant in front of the user rather than the first one.

Per variant, the user can Regenerate (replacing just that slot, keeping its angle), Copy it to the clipboard, or type a note in the steer box and regenerate with that note added to the same inputs. A variant that failed to generate shows a destructive alert with the error and a Retry button in place of the text area; the other variants are untouched. Regenerate all replaces the whole set again.

Create Prompt copies a remix scoped prompt (built from the session, including the chosen hook and variant) to the clipboard for pasting into any model, distinct from the source scoped prompt on the [video detail page](../feed/video-detail.md).

### Finish

Save script opens a dialog with a title, prefilled from a derived short title rather than the raw topic. Saving writes the open variant as a script, records that variant as the chosen one, and shows a toast with a link to open it in the vault. Once saved, an Add to plan row appears: choosing a date and clicking Add to plan creates a planned post carrying the saved script for that date. Adding a date here is optional; the script is already saved either way, and skipping it leaves the script in the vault. The stage's own Continue (in the studio footer) moves to finish, which is where the pick is finally confirmed and a plan is guaranteed.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (variants present, one chosen) | Opens on the recorded chosen variant if there is one, else the first tab; empty state if no variants. | Opening a tab records the pick; Regenerate all clears the pick and any prior save. |
| Attached data present or absent | The grounded in line lists only the inputs that exist (hook, facts, analysis). A missing input is simply not listed. | Generation reads whatever the session holds at the moment of the call. |
| External service availability | With the model unavailable the whole stage is the block panel. | A generation failing on a connection error contributes to the studio's proxy down read and can flip the stage to blocked. |
| Keyboard shortcut in play | None specific. | The variant text areas and the title input behave as normal fields; there is no keyboard submit. |

Regenerating a single slot keeps that slot's angle; regenerating all draws the three angles fresh. A hand edit and a regenerate are treated the same way for staleness: either one on the saved slot clears the save.

## Cancel and interrupt

| Event | Before commit (editing or picking) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | Closing the save dialog with Escape or its close discards the title entry, not the variants. There is no cancel for a generation. | The generate and regenerate buttons are disabled while running; there is no stop. |
| Navigate away mid action | Leaving keeps the autosaved variants and the recorded pick. A title typed in the open save dialog is lost. | Leaving abandons the client wait; the server still writes the variant result and the run log row. On return the variants reflect what landed. |
| Reload or tab or window closed | The variants, the pick, and any saved script survive because they are server backed. Unblurred edits in a variant text area are lost. A saved script id held only in the page is lost, so the Add to plan row disappears until the user saves again. | The reload resumes from the database; the in flight result and its run row appear once landed. |
| A backing service fails mid action | The prompt and research inputs are unaffected. | A failed variant becomes an inline error at its own slot while the others succeed; a whole failed generation shows a toast and leaves the previous variants intact. Zero successes writes a failed run row. |
| The target record changes underneath | Generation reads the session's stored inputs, not the live video, so a source removal does not change an in progress edit. | Same. |
| A background job finishes or fails on its own | Not applicable here. | Not applicable. |
| A second tab or a double action on the same record | Two tabs editing the same session race their autosaves; last write wins per slot. | A single slot regenerate read modify writes only its slot server side, so a concurrent edit of a sibling slot is not clobbered. Regenerate all replaces the whole set. |

After an interrupt the user resumes with the server's copy of the variants and the recorded pick. A saved script row is durable; the Add to plan affordance is page state and reappears only after a fresh save.

## Interactions with other systems

**Persistence and autosave.** Variant edits autosave on blur as the whole set. The pick autosaves the moment a tab opens. A single slot regenerate is persisted server side into just that slot. A failed autosave shows a toast. See [persistence](../cross-cutting/persistence.md).

**History and undo.** No undo. Regenerating or editing replaces a variant's text; the run log records that an attempt happened but does not keep the replaced text.

**Navigation and refresh.** The stage keeps its state locally within a visit and does not need a refresh; a reload rebuilds from the session. Save opens a toast link to the vault; Create Prompt writes to the clipboard.

**Background jobs and the sidecar.** None directly. The saved script and any planned post feed the later [cook run](../studio/cook-run.md).

**External services.** Generation calls the LLM proxy; a clipboard copy needs a permitted clipboard. A denied clipboard shows a toast rather than failing silently. See [external services](../cross-cutting/external-services.md).

**Status and failures.** Generation writes a run log row on every attempt: Success when at least one variant returns, Partial when some of the three fail, Failed when none return. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The default variant count is three. The niche and persona feed the prompt from settings, described in the generation stages.

## Edge cases

- A failed variant is isolated: it shows an error at its own tab while the successful variants stay usable, and Retry regenerates only it.
- Regenerate all clears the chosen variant and any prior save, because the earlier pick and script now point at text that no longer exists.
- Editing or regenerating the exact slot a save came from clears that save, hiding Add to plan until the user saves again; editing a different slot leaves the save intact.
- The save title is derived to a short form, not the raw topic, because the prompt stage prefills the topic with the whole source caption, which once landed as multi thousand character titles.
- Continue advances to finish on a variant merely existing, not being picked, so the finish view can explain a missing pick rather than being unreachable.
- Add to plan here creates a dated planned post directly, a second path to the plan alongside the [finish stage](stage-finish.md), which creates an undated draft.

## Open questions and verification

- Whether a single slot regenerate and a concurrent sibling autosave can still interleave badly in practice, despite the server side slot merge, was read from the code but not tested under real concurrency.
- Whether the pick recorded by opening a tab and the pick recorded by saving can disagree if the user saves one variant then opens another without saving needs a live check; the code clears the save on the tab change, but the recorded chosen index is updated by both paths.
- The exact content of the remix scoped Create Prompt output was not captured here; it is built by the export service and is worth documenting where that feature is covered.

Verified against this repo commit `4f26fb9`.
