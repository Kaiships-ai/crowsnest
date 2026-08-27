# The research stage

## Summary

The research stage is the second step of the [remix studio](remix-overview.md). It lays out what the remix is working from before any generation happens: the source post's analysis, a transcript excerpt, the top similar outliers, and a box for the user to add their own facts. It is reached by clicking Continue on the prompt stage, or by clicking the research step in the stepper once the session has reached it. Its distinguishing signal is a two part layout with a rule across each section header: "source inputs, sent to every stage" over the material the later stages actually read, and "reference, not sent" over the vault and similar lists that are there to look at but do not flow into any prompt.

The stage assembles itself. On arrival, if the [remix session](../glossary.md) has no research notes yet, it builds them from the source post with no model call, which is why this stage works with no API key and with the [LLM proxy](../foundations/background-jobs.md) down. Only the "your additions" facts box is editable, and it autosaves on blur. Continue is always allowed from here; there is nothing to require.

## The simple case

The user clicks Continue on the prompt stage and lands on research. For a fresh session the screen briefly reads "Assembling research from the source post" with two placeholder blocks, then fills in: why the source post worked, its hook pattern as a set of tags, its structure broken into beats with each beat's note and the words that were said, and below that a list of similar tracked outliers and the posts saved in the vault. The user reads it, optionally types their own angle or a stat into the "your additions" box, clicks away to save it, and clicks Continue to move to the hook stage.

On a return visit the assembly does not run again. The stored notes render straight away, with the facts box holding whatever the user last saved.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> assembling : arrive with no research notes
    [*] --> ready : arrive with research notes already stored
    assembling --> ready : assembly lands (notes persisted)
    ready --> editingFacts : type in the additions box
    editingFacts --> ready : blur (autosave)
    ready --> [*] : Continue to the hook stage
```

### Arrive

Opening the research stage reads the session the studio already loaded. If the session has research notes, the stage renders them at once. If it does not, the stage shows a skeleton loader and kicks off the assembly: it pulls the source post's analysis, a transcript excerpt capped at 500 characters, and the top five similar outliers, writes them to the session, and hands them back to the studio so the rest of the stages can read them. The facts box starts from whatever facts the session already holds, empty for a fresh assembly.

The assembly makes no call to the model. It reads records the sidecar and the analysis step already wrote, so it needs neither an API key nor the proxy.

### Leave without acting

Leaving research without touching the facts box records nothing new beyond what the assembly already persisted. The assembled notes are written to the session as part of arriving, not as a separate save, so backing out to the prompt stage or out of the studio keeps them. Returning resumes with the same notes and does not reassemble.

### Begin acting

The first real work here is the auto assembly itself, which happens without the user asking. The only user driven action is the first keystroke in the "your additions" box, which makes the field dirty. Nothing is committed on that keystroke; the text lives in the field until the field loses focus.

### While acting

Editing the facts box updates the field live as the user types. Nothing else on the stage changes. When the field loses focus the current text is written to the session's research notes and the studio's local copy is updated in step, so the facts flow into the hook, style, and script prompts from then on. A failed save surfaces as an "Autosave failed" toast; there is no inline error.

### Finish

There is no commit step that closes this stage. The assembled notes are already durable, and the facts box commits on each blur. Continue advances to the hook stage. Because Continue is always allowed, the user can move on with an empty facts box, with an unanalyzed source, or before the assembly has even finished.

> Technical note: the assembly is a server action fired from an effect that runs only while the session has no research notes. It writes the notes to the database directly, then reports them back to the client. If the user navigates away before it lands, the client update is dropped but the database write still happens, so the next visit shows the notes.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | The stage assembles when the session has no research notes and renders the stored notes otherwise. Whether the source [video](../glossary.md) is [analyzed](../glossary.md) decides the top block: the source inputs when it is, a "this post has not been analyzed" note with a link to analyze it when it is not. | Editing the facts box does not move the session stage. The stage never reassembles once notes exist; there is no rebuild control. |
| Attached data present or absent | With an analysis, the why it worked line, the hook pattern tags, and the structure beats show; without one, the fallback note shows instead. With a transcript, an excerpt fills the collapsed fallback and each beat can carry the words said; without one, the fallback reads "No transcript available." Similar outliers show when other analyzed videos exist, an "analyze more videos" note when they do not. | No effect. The assembled block is fixed once written; only the facts box changes. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on the stage running. Assembly reads stored records and makes no model call, so it works with the proxy down, with no API key, and with the sidecar off. The sidecar and the analysis step are what wrote the records it reads. | No effect. Saving the facts box is a local database write. |
| Keyboard shortcut in play | None. There is no dialog and no keyboard submit. | Enter in the facts box inserts a newline. Tabbing or clicking out of the field blurs it and triggers the autosave. |

## Cancel and interrupt

| Event | Before commit (reading or editing) | While in flight (assembling or saving facts) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel or stop control on this stage. Leaving keeps the assembled notes and the last saved facts. | The assembly cannot be cancelled from the UI. A facts autosave cannot be cancelled; it runs to completion. |
| Navigate away mid action | Leaving keeps everything already written. Text typed in the facts box but not yet blurred is not saved. | Leaving during the assembly drops the client update but the database write still lands, so the notes appear on the next visit. Leaving during a facts save lets the write finish; the toast may not appear. |
| Reload or tab or window closed | The session is server backed, so a reload resumes with the stored notes and the last saved facts. Unblurred facts text is lost. | A reload during assembly re reads the session: if the notes had been written, they show; if not, the next mount reassembles. A reload during a facts save may or may not have committed; the next load shows what the database holds. |
| A backing service fails mid action | No external service is used. | If the assembly action fails, the client sets nothing and the stage stays on the skeleton loader, since the session's research notes stay empty (see open questions). A failed facts save shows an "Autosave failed" toast and leaves the text in the field. |
| The target record changes underneath | If the source video was removed by a [sync](../foundations/background-jobs.md) before assembly, the assembly finds no analysis or transcript and builds notes with those parts empty; similar outliers are computed from whatever analyzed videos remain. The vault list is read fresh on each visit, so a save or remove elsewhere shows up next time. | Same. Assembly reads the stored records at the moment it runs; a later change does not rewrite an already assembled note. |
| A background job finishes or fails on its own | A sidecar sync that adds or analyzes videos changes what a fresh assembly would produce, but only for a session that has no notes yet. Once assembled, the source inputs and the similar list are frozen; only the facts box and the live vault list change. | No effect. This stage starts no background job. |
| A second tab or a double action on the same record | Two tabs on the same video share one session. Both showing an unassembled stage can each trigger the assembly; the writes are the same content and the last one wins. | Two facts saves race last write wins. A second assembly overwrites the first with identical notes. |

After an interrupt the user resumes reading the same notes. Nothing here is left half written except facts text that was typed but never blurred.

## Interactions with other systems

**Persistence and autosave.** The assembled notes are persisted to the session as part of arriving, not on a save button. The facts box autosaves on blur into the same research notes record; it is the one field on this stage the user can edit after assembly. See [persistence](../cross-cutting/persistence.md).

**History and undo.** There is no undo. Editing the facts box overwrites the previous text with no way back. The assembled block cannot be edited at all and is never rebuilt once written, so it is stable across the life of the session.

**Navigation and refresh.** Most of the stage is client state seeded from the session the studio loaded. The vault saved posts list is the exception: it is read live on the server on each visit rather than frozen into the notes, so saving or removing a post from the feed is reflected the next time research opens. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** Assembly reads the video, its analysis, and its transcript, all written earlier by the sidecar and the analysis step. It starts no job of its own. The similar outliers are computed from the analyses of other tracked videos. See [background jobs](../foundations/background-jobs.md).

**External services.** None. This stage makes no [generation](../glossary.md) call, which is why it stays usable when the hook, style, and script stages are blocked for a missing key or a down proxy. See [external services](../cross-cutting/external-services.md) and the generation blocked posture in [the remix studio](remix-overview.md).

**Status and failures.** This stage does not write a [remix run](../glossary.md) row, so nothing it does appears in the run log; only the generation stages log there. Its own failures are a stuck skeleton on a failed assembly and an "Autosave failed" toast on a failed facts save. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The transcript excerpt cap of 500 characters and the similar outliers cap of 5 are fixed constants, not user settings. The niche is not shown on this stage; it belongs to the prompt stage.

## Edge cases

- The assembly runs only when the session has no research notes. There is no manual rebuild, so re analyzing the source post after assembly does not update the stored source inputs; the old notes stay until a session with empty notes is assembled.
- Quick Remix from the prompt stage assembles research as its first step, so a session it produced already has notes and this stage never reassembles when the user visits it.
- The transcript excerpt is truncated to 500 characters with an ellipsis appended, and it is shown only inside the collapsed "full transcript fallback", described as the source of the words for beats that carry no per beat transcript of their own.
- Each structure beat shows both a note and the words said when the beat was analyzed with a per beat transcript. Beats analyzed before that existed show the note alone rather than an empty second line.
- The vault list is read live and the similar list is frozen at assembly time, so the two "reference" lists can disagree about what the vault holds if the user saved a post after this session's research was first built.
- Continue is allowed even while the assembly is still running or when the source is unanalyzed, so the user can reach the hook stage with empty or partial research notes.

## Open questions and verification

- Whether a failed assembly leaves the stage stuck on the skeleton loader with no retry and no error toast was read from the code but not confirmed by hand. The effect sets the notes only on success; on failure the session's research notes stay empty and Continue still lets the user proceed with no notes.
- Whether facts text that was typed but not blurred survives a Continue click, which unmounts the stage, was not confirmed by hand. It depends on whether the field's blur fires before the unmount.
- Whether the vault list and the frozen similar list are ever reconciled needs a live check; from the code the vault list is always live and the similar list is never refreshed after assembly.

Verified against this repo commit `4f26fb9`.
