# The hook stage

## Summary

The hook stage generates a set of opening lines for the script, shows them as
option cards the user reads, and lets the user pick one to carry forward. It is
the third of the six remix stages. It generates against the source video's own
hook pattern by default, or against a [vault item](../glossary.md) the user
seeds it with, produces three to seven read only options, and ends when the user
chooses one, which pins it at the top of the stage and unlocks Continue. It needs
the [LLM proxy](../foundations/background-jobs.md); without a key or with the
proxy unreachable the whole stage is the block panel from
[the remix overview](remix-overview.md).

The stage lives inside the [remix studio](remix-overview.md) and is reached by
Continue from the research stage, by a stepper click once reached, or by a
[deep link](../foundations/navigation-and-shell.md) from a vault hook template
card that seeds the vault select. Its generation attempts are logged to the run
log under the hook stage.

## The simple case

The user arrives from research and clicks Generate hooks. A short wait, then five
option cards appear, each one candidate opening line. The user reads them, clicks
"Use this hook" on the one they like, and it lifts to a pinned panel at the top of
the stage while its card marks Selected. Continue is now enabled. If none land,
the user types a note in the steer box ("punchier, lead with the number") and
clicks Regenerate with note, or seeds the generation from a saved vault hook first.
Any option worth keeping can be saved back to the vault as a template.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> empty : arrive (no hooks yet)
    [*] --> options : arrive (session already has hooks)
    empty --> generating : Generate hooks
    options --> generating : Regenerate hooks or steer note
    generating --> options : hooks returned (cards shown)
    generating --> empty : error (toast, prior hooks kept)
    options --> chosen : Use this hook (pins, autosaves)
    chosen --> generating : Regenerate hooks or steer note
    chosen --> chosen : Use a different hook
    chosen --> [*] : Continue (chosen hook set)
```

### Arrive

The stage opens with whatever the session already holds. If the session has hook
options they render as cards straight away and the button reads Regenerate hooks;
if not, the stage shows the grounded in line and a single Generate hooks button
over an empty prompt. If the session already has a chosen hook it shows pinned in a
panel at the top, and its card, if still among the options, is marked Selected. The
vault seed select defaults to "None, use source hook pattern". A deep link from a
vault hook template card preselects that hook in the select, but only jumps the
studio to this stage when the session is still fresh at prompt; a session with real
progress keeps its own stage and honors the seed whenever the user reaches hook.

### Leave without acting

Leaving before generating records nothing new. The grounded in line, the empty
state, and the seed select are not saved state, so nothing is lost. A vault seed
picked in the select but never generated from is dropped; it lives only in the
stage until a generation reads it, since the hook stage has no persisted seed
column.

### Begin acting

The first real work is Generate hooks (or Regenerate hooks once options exist).
The stage sends the topic, niche, facts, and either the source video's hook
pattern or the seeded vault template, asks for a set of hooks, and shows an
indeterminate generating state, five card shaped placeholders, while it waits. The
generate button is disabled for the duration so a second click cannot start a
second run.

### While acting

When the hooks return they replace the card set and the button relabels to
Regenerate hooks. Each card is a read only line: it cannot be edited in place, and
"Use this hook" is the only way to commit one. Choosing a hook records it
immediately, both to the pinned panel at the top and to the session, so the finish
view and the cook brief read the hook the user actually chose. A steer box sits
below the cards: a note typed there is added to the same inputs and reruns the
generation. Each card also offers "Save as template", which writes the line to the
vault as a reusable hook item without changing the current pick. A failed
generation shows a toast and leaves the previous options and the pinned choice
intact.

### Finish

The stage has no commit of its own beyond the chosen hook, which autosaves the
moment "Use this hook" is clicked. Continue in the studio footer, enabled once a
hook is chosen, advances to the style stage. The chosen hook then grounds the
outline and script generations downstream.

> Technical note: choosing a hook stores the line's raw text on the session, not a
> reference to any vault item. A hook seeded from a vault template and one written
> fresh are indistinguishable once chosen, so nothing links a saved script back to
> the vault hook that shaped it.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (hooks present, one chosen) | Opens with the session's hooks as cards and its chosen hook pinned, or an empty prompt if neither exists. | Generating replaces the whole card set; choosing a hook pins it and enables Continue. Regenerating does not clear an existing chosen hook. |
| Attached data present or absent | The grounded in line lists only the inputs that exist (why it worked, hook pattern, opening beat transcript, topic, niche, facts); a missing input is not listed, and with none it reads "nothing yet, fill in Prompt and Research first". A vault seed select shows a disabled "No saved hooks yet" option when the vault is empty. | Generation reads whatever the session holds at the moment of the call, including the seed select's current value. |
| External service availability | With no key or the proxy unreachable the whole stage is the block panel; the seed select and cards are not shown. | A generation failing on a connection error contributes to the studio's proxy down read and can flip the stage to blocked on the next render. |
| Keyboard shortcut in play | None specific. | The steer box textarea behaves as a normal field; there is no keyboard submit. |

The seed select is the only modifier: "None, use source hook pattern" grounds the
generation in the source video's own hook type, a picked vault hook swaps that
pattern for the template's text. An empty vault never blocks the stage; generation
still falls back to the source pattern.

## Cancel and interrupt

| Event | Before commit (reading or picking) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel; a hook is committed only by "Use this hook", and not choosing one commits nothing. | The generate and regenerate buttons are disabled while running; there is no stop. |
| Navigate away mid action | Leaving keeps the session's hooks and any chosen hook. A vault seed picked but not generated from is dropped, and any steer note is lost. | Leaving abandons the client wait; the server still writes the hooks (on success) and the run log row. On return the session reflects what landed. |
| Reload or tab or window closed | The hooks and the chosen hook survive because they are server backed. The seed select resets to its default and the steer note clears. | The reload resumes from the database; the in flight result and its run row appear once landed. |
| A backing service fails mid action | No effect until the user generates; the stage reads no external service to display cards. | A failed generation shows a toast and writes a failed run log row; the previous hooks and the chosen hook are left intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its own copied hooks and pattern; a later regenerate falls back to a default pattern when the analysis is gone. | Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable here; the cook run belongs to the [studio page](../studio/cook-run.md). | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same session share one row; the last "Use this hook" click wins on the chosen hook field. | A double generation is prevented by the disabled button; two tabs generating at once both write run rows and the later write wins on the hook options field. |

After an interrupt the user resumes with the server's copy of the hooks and the
chosen hook. The steer note and the seed select are page state and reset on
remount.

## Interactions with other systems

**Persistence and autosave.** The chosen hook autosaves the instant "Use this
hook" is clicked, through the shared autosave path; a failed save surfaces as an
"Autosave failed" toast rather than failing silently. The generated hook options
are persisted by the generation itself. The steer note is never persisted, and the
seed select is not saved. See [persistence](../cross-cutting/persistence.md).

**History and undo.** No undo. Regenerating replaces the whole option set; the run
log records that an attempt happened but does not keep the replaced hooks.
Choosing a different hook overwrites the previous pick.

**Navigation and refresh.** The stage keeps its state locally within a visit and
does not need a refresh; a reload rebuilds from the session. A deep link seeds the
select and, from a fresh session, the opening stage. See
[navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** None directly. The stage reads the source
video's analysis, written by the sidecar, to describe the hook pattern and the
opening beat.

**External services.** Generation calls the LLM proxy. When it is down the stage
blocks. Save as template writes to the vault and needs no model. See
[external services](../cross-cutting/external-services.md).

**Status and failures.** Generation writes a run log row under the hook stage on
every attempt, Success on the hooks returning and Failed on an error, and asks the
studio to re-read the log so its proxy down read stays live. See
[status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The niche is read from settings and fed to the
prompt; the persona, when filled, is appended too. Neither is edited here.

## Edge cases

- The option cards are read only. An edit typed into a card would never reach the
  server, so the cards are plain text and "Use this hook" is the only commit; a
  hook is changed by choosing another or regenerating, not by editing.
- Regenerating does not clear an existing chosen hook. If the new options do not
  contain the previously chosen line, the pinned panel still shows it, no card is
  marked Selected, and Continue stays enabled, because the chosen hook is stored as
  text independent of the current option set.
- Save as template writes a new vault hook item titled from the first forty
  characters of the line, but the seed select does not refresh to include it within
  the same visit; the new template appears in the select only after the page is
  reloaded.
- An empty vault does not block the stage. The seed select shows a disabled "No
  saved hooks yet" option, and generation falls back to the source video's own hook
  pattern.
- A vault seed chosen in the select but never generated from is discarded on leave,
  because the hook stage has no persisted seed column; only the picked hook's text
  is saved, after generation.
- If a hook was chosen before the proxy went down, Continue stays enabled from the
  session's stored choice even though the whole stage is now the block panel and no
  cards are visible.

## Open questions and verification

- Whether the pinned chosen hook panel and a regenerated option set can disagree in
  a way that confuses the user, an old choice shown pinned while none of the new
  cards is marked Selected, was read from the code but not confirmed as intended by
  hand.
- Whether a Continue click issued while a hook generation is still in flight can
  advance the stage before the hooks land was not confirmed by hand; the button is
  gated on the stored chosen hook, not on the generation settling.
- The exact number of hooks returned per generation was read as three to seven from
  the schema, with five used for the loading placeholders and the common case, but
  the live distribution was not checked.

Verified against this repo commit `4f26fb9`.
