# The style stage

## Summary

The style stage decides the shape of the script: which structure the beats follow, and what those beats say. It is the fourth of the six remix stages. The user picks a structure (the source post's own structure by default, or a saved style template from the vault), clicks Generate outline, and gets back a list of beats they can read and edit by hand: each beat is a target length in seconds, a short label, and a line of content. It needs the [LLM proxy](../foundations/background-jobs.md) to generate; without it the whole stage is the block panel from [the remix overview](remix-overview.md).

The stage lives inside the [remix studio](remix-overview.md) and is reached by Continue from the hook stage, or by a stepper click once the stage has been reached. Its outline generation is logged to the run log under the style stage. Continue to the script stage is gated on an outline existing.

## The simple case

The user arrives on the style stage with a hook chosen behind them. The structure select reads "Source post's structure". They leave it there, or open it and pick one of their saved style templates, then click Generate outline. A short pending state shows four placeholders, then the outline arrives as a numbered list of beats. Each beat has a seconds box, a label, and a content line, all editable. The user tweaks a label here, retimes a beat there, and clicks out of the field to save. If the shape is wrong they type a note in the steer box and regenerate, or click Regenerate outline to draw a fresh one. When the outline reads the way they want, they Continue to the script stage.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> ready : arrive (structure select, no outline yet)
    ready --> ready : select a structure (autosaves styleVaultItemId)
    ready --> generating : Generate outline
    generating --> outline : beats returned (autosaved)
    generating --> ready : error (toast, prior beats kept)
    outline --> editing : type in a beat field
    editing --> outline : blur (autosave the whole outline)
    outline --> generating : Regenerate outline, or Regenerate with note
    outline --> [*] : Continue to script
```

### Arrive

Opening the style stage loads the session's current structure choice and its current outline, both from the session the [studio shell](remix-overview.md) already holds. The structure select starts on whatever the session last recorded: "Source post's structure" when no style vault item is set, or the named style template when one is. If the session already has an outline, its beats render straight away as editable rows and the button reads "Regenerate outline". If not, the stage shows a grounded in line and a single Generate outline button over the line "Generate an outline to get started."

The structure select lists "Source post's structure" first, then one option per saved style vault item. When the vault holds no style templates the select still opens, but the only extra option is a disabled "No saved styles yet" that cannot be picked. An empty vault is not a dead end: generation falls back to the source post's own structure either way, so the disabled option only explains why there is nothing else to choose.

### Leave without acting

Leaving the stage without generating records nothing new. The structure choice is already saved the moment it changes (see below), so it survives leaving regardless. The grounded in line and the empty prompt are not state; nothing is lost by walking away before a generation.

### Begin acting

There are two ways to begin. Changing the structure select is the first: picking a style template autosaves that choice to the session immediately, and picking "Source post's structure" clears it back to none. Clicking Generate outline is the other: it starts the model call that produces the beats. A hand edit to an existing beat also counts as acting, and autosaves on blur.

### While acting

While a generation runs, the button reads "Generating…" and is disabled, the beats and the steer box are replaced by four placeholder rows, and the structure select stays visible but no new generation can start until this one settles. The stage does not claim to know how far along the model is; the call is atomic with no incremental signal.

When the outline returns it replaces the beat list and the button relabels to "Regenerate outline". Each beat is three fields: a narrow seconds box, a label input, and a two row content area. Typing in any of them updates the beat on screen with every keystroke, so the outline the studio holds stays current as the user types. Nothing is sent to the server until the user leaves the field: on blur the whole outline is saved at once. Below the beats, the steer box takes a note ("add a beat before the payoff, tighten the build") and regenerates the outline with that note folded into the same inputs.

### Finish

There is no single commit for this stage. The structure choice is committed when it changes, the outline is committed when a generation lands and again on every blur after an edit, and the run log gets a row on every generation attempt. Continue in the studio footer moves to the [script stage](stage-script.md); it is enabled as soon as an outline exists on the session. The style stage does not create a script or a planned post; it only shapes the beats the script stage will write from.

> Technical note: the seconds box stores a number. Clearing it or typing anything that is not a number lands the beat at 0 seconds rather than refusing the keystroke, because the field coerces its text to a number and falls back to 0 when that fails.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage, outline present or not) | An outline already on the session renders as editable beats and the button reads "Regenerate outline"; no outline shows the empty prompt and "Generate outline". | A landed generation fills the beats and flips the button label; editing a beat and blurring resaves the whole outline. |
| Attached data present or absent | The grounded in line lists only the inputs that exist: the structure (source beats or the named vault template), why the source worked, the chosen hook, the topic, and the user's own facts. A missing input is simply not named. With nothing yet, the line reads "nothing yet, fill in Prompt and Research first". | Selecting a vault style template swaps the structure clause from "source structure beats" to the template's name; the why it worked clause stays either way. Generation reads whatever the session holds at the moment of the call. |
| External service availability (LLM proxy, Graph, sidecar) | With no API key or the proxy looking down the whole stage is the block panel and none of these controls render. The Graph token and the sidecar have no effect here. | A generation that fails on a connection error contributes to the studio's proxy down read and can flip the whole stage to blocked until an attempt succeeds. |
| Keyboard shortcut in play | None specific. The structure select opens with the keyboard as any select does. | The seconds box, label input, content area, and steer box are ordinary text fields; there is no keyboard submit and Enter in a field does not generate. |

Regenerating draws a whole new outline every time; there is no per beat regenerate on this stage. A hand edit and a regenerate both change the beats the same way, and both flow straight into whatever the script stage generates next, because that stage reads the session's stored outline at the moment it runs.

## Cancel and interrupt

| Event | Before commit (selecting or editing) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button. A structure change is already saved, so there is nothing to undo but to pick again. An unblurred beat edit is discarded only if the user changes the value back or reloads before blur. | The Generate and steer buttons are disabled while running; there is no stop. The call runs to completion. |
| Navigate away mid action | Leaving keeps the saved structure choice and the last saved outline. Returning resumes with them. | Leaving abandons the client wait, but the server call still writes the new outline and the run log row. The new beats do not appear in the studio's live copy; a reload or a return that re-reads the session shows what landed. |
| Reload or tab or window closed | The structure choice and the outline are server backed, so a reload resumes with them. An unblurred edit in a beat field is lost. | The reload resumes from the database; the in flight generation's outline and its run row appear once it lands. |
| A backing service fails mid action | The select and hand edits do not touch the model, so they are unaffected. | A failed generation shows a toast with the reason, writes a failed run log row under the style stage, and leaves the previous beats intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its stored analysis and outline; a later regenerate that falls back to source structure may find less to ground on. | Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable on this stage; the cook run belongs to the [studio page](../studio/cook-run.md). | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same session share one row; their structure choices and beat autosaves race, last write wins. | A double generation in one tab is blocked by the disabled button. Two tabs generating at once both write run rows and the later write wins on the session's outline column. |

After an interrupt the user resumes with the server's copy of the structure choice and the outline. Only an unblurred beat edit is at risk; everything else is already durable.

## Interactions with other systems

**Persistence and autosave.** Two things autosave here. The structure choice saves the instant the select changes, source clearing it to none. Beat edits save on blur as the whole outline, not per field, so leaving a field commits every edit made since the last blur. A generation persists its outline server side as it lands. A failed autosave surfaces as a toast rather than failing silently. See [persistence](../cross-cutting/persistence.md).

**History and undo.** No undo. Regenerating replaces the whole outline; editing a beat replaces its text. The run log records that an attempt happened and how many beats it produced, but it does not keep the replaced outline, so a regenerate that reads worse than the last one cannot be rolled back except by generating again.

**Navigation and refresh.** The stage keeps the outline in the studio's local state within a visit and does not need a refresh to stay current while the user is on it. A reload rebuilds the beats from the session. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** None directly. The source analysis the outline grounds on was written by the sidecar earlier; the outline itself feeds only the later [script stage](stage-script.md) and, through it, the [cook run](../studio/cook-run.md).

**External services.** Outline generation calls the LLM proxy. When there is no API key or the proxy looks unreachable the stage is the block panel and offers no generate button at all. See [external services](../cross-cutting/external-services.md).

**Status and failures.** Every outline attempt writes a run log row under the style stage: success with the beat count, or an error with the message. The run log is the studio's own status surface, distinct from the shell failure strip. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The niche and the persona feed the generation prompt from settings, the same as the other generation stages, without appearing on this screen. The target length default of 45 seconds set on the prompt stage is what the outline's beats are timed against.

## Edge cases

- An empty vault does not block the stage. The structure select shows a disabled "No saved styles yet" and generation falls back to the source post's own structure.
- The grounded in line is honest about the structure source: once a vault style template is picked it names that template and stops claiming the source beats fed the structure, because generation uses the template's structure instead. The why it worked clause stays either way, since that input is passed regardless of the structure choice.
- Regenerating the outline does not touch anything the script stage already produced. A session that generated variants, then came back and regenerated the outline, keeps its old variants against a new outline until the user regenerates the variants too. Nothing on this stage warns about that mismatch.
- A generation that returns no beats still counts as an outline: the session records an empty outline, so Continue to the script stage becomes enabled while the stage itself still shows "Generate an outline to get started" and no beat rows.
- Clearing a beat's seconds box, or typing a non number into it, sets that beat to 0 seconds rather than leaving the field blank.
- The steer note is local to the stage and never saved. Leaving the stage and coming back starts the steer box empty; the note only ever exists for the one regenerate it drives.

## Open questions and verification

- Whether a structure change and an immediate Generate outline click can race, so the generation reads the old structure choice before its autosave lands, was read from the code but not confirmed by hand. The select autosaves in the background while the generate button is live at once.
- Whether an outline generation started, then abandoned by navigating away, reliably has its new beats appear on a later visit was read from the persistence path but not watched live; the server write lands, but the studio's in memory copy does not update until the session is re-read.
- Whether Continue truly enables on an empty beat outline in the running product, and how that reads to a user who sees no beats, needs a live check. The gate gates on the outline existing, not on it having beats.

Verified against this repo commit `4f26fb9`.
