# Bug triage

A consolidated list of the defects and inconsistencies the feature documents raised, in their "Open questions and verification" sections and in their bodies. Each entry is read from the code and tests at commit `4f26fb9`. Two verification passes have run against the running product on localhost:3000: a scripted read pass and a Playwright interactive pass. Between them, three are confirmed (B-08, B-10, B-14) and one more (B-01) is consistent with the data but not yet reproduced with a positive case; those four carry a Status line. The generation dependent entries (B-02, B-03, B-11) stay unconfirmed because the LLM proxy was down during the pass, and B-05 could not be forced from the UI. The rest await further checks. The list exists so the product team can decide, item by item, whether to fix, to document as intended, or to leave.

## Summary

The drafting raised roughly twenty suspected issues across the core loop. After merging, seventeen remain. One is high (a Save to calendar action that does not durably mark a plan published). Six are medium, mostly failures that leave a surface stuck or a set of records half written with no rollback and no clear feedback. The rest are low: inconsistencies between two paths that should match, a rendered field that is never populated, and known gaps the code already comments on. A recurring theme in the medium set is an action that writes several rows in sequence, or infers a live state on the client, with no path back when one step fails or the page reloads.

| ID | Title | Severity | Area | Decision needed |
| --- | --- | --- | --- | --- |
| B-01 | Save to calendar marks a plan published with a null id, so it never reads as published | high | studio | fix |
| B-02 | A failed research assembly leaves the remix stage stuck on the skeleton loader | medium | remix | fix |
| B-03 | Regenerating the outline leaves stale script variants in place with no warning | medium | remix | product call |
| B-04 | A plan edit is several writes with no rollback, so a mid sequence failure leaves a partial edit | medium | mine | fix |
| B-05 | Save to Vault "both" can half write and a retry duplicates the row that landed | medium | feed | fix |
| B-06 | A reload during a cook run loses the live run state while the run continues | medium | studio | fix |
| B-07 | The failure strip may not surface a failed cook run, only sync failures | medium | shell | product call |
| B-08 | A hand marked published plan in the past still renders as a red missed cell | medium | mine | product call |
| B-09 | The calendar delete Undo is lossy, dropping several fields on re-create | medium | mine | fix |
| B-10 | The video analysis summary field is rendered but never written | low | feed | fix |
| B-11 | Quick Remix is not blocked when the proxy is down, unlike the other generation controls | low | remix | fix |
| B-12 | Generate idea does not gate on a key or reflect an existing idea | low | feed | product call |
| B-13 | Publish survives a reload but Save to calendar does not, so they disagree after a reload | low | studio | fix |
| B-14 | notFound on the video detail route returns HTTP 200 instead of 404 | low | feed | fix |
| B-15 | There is no way to clear the own channel from the my channel page | low | mine | product call |
| B-16 | Quick preview shows a soft removed video with no removed marker | low | feed | product call |
| B-17 | Small inconsistencies: analyze and idea actions omit the error code field, and the on screen studio brief omits the remix hook and variant | low | mixed | product call |

## High

### B-01: Save to calendar marks a plan published with a null id, so it never reads as published

- Where the user meets it: the studio panel, after a cook, clicking Save to calendar to record the plan as published.
- What happens vs what was expected: the action calls `markPlanPublishedAction(postId, null)`. A plan's published state is derived only from a non null `publishedOwnPostId`, so passing null leaves the row indistinguishable from an unpublished plan. The only durable effect is bumping `updatedAt`. The user sees a "Saved to calendar" label, but it is client state a reload discards, and the calendar still treats the plan as draft or missed, and the reconciliation prompt still fires.
- Reproduce: cook a post to a render, click Save to calendar, then reload the studio or open the calendar and look at the plan's state.
- Why (from the code): `src/server/actions/planned-post-actions.ts` `markPlanPublishedAction`, and the derived state in `src/server/queries/planned-posts.ts` (the read only yields draft, scheduled, or missed; published depends on a non null `publishedOwnPostId`).
- Severity: high. The one action whose whole purpose is to mark a plan published does not durably do so.
- Decision needed: fix. Either pass a real own post id, or derive published from an explicit flag rather than only from `publishedOwnPostId`.
- Raised by: [studio/publish.md](studio/publish.md#open-questions-and-verification).
- Status: data consistent, not yet reproduced. No planned post in the dev database has a non null `publishedOwnPostId`, which is what this bug would produce, but that also matches a user who never published. Confirming needs a live Save to calendar and a reload, which needs a browser.

## Medium

### B-02: A failed research assembly leaves the remix stage stuck on the skeleton loader

- Where the user meets it: the remix research stage, on a session with no research notes yet, when the assembly action fails.
- What happens vs what was expected: the effect sets the notes only on success; on failure the session's research notes stay empty, so the stage keeps rendering the "Assembling research" skeleton with no retry and no error toast. Continue still lets the user proceed with no notes.
- Reproduce: force `buildResearchAction` to fail on first entry to the research stage.
- Why (from the code): `src/components/remix/stage-research.tsx` (the effect has no error branch); `buildResearch` in `src/server/services/remix.ts`.
- Severity: medium. Recoverable by leaving and returning, but the stuck skeleton reads as a hang.
- Decision needed: fix. Add an error state and a retry.
- Raised by: [remix/stage-research.md](remix/stage-research.md#open-questions-and-verification).

### B-03: Regenerating the outline leaves stale script variants in place with no warning

- Where the user meets it: the remix, regenerating the outline on the style stage after variants were already generated on the script stage.
- What happens vs what was expected: regenerating the outline does not clear or reconcile the existing variants, so the script stage can hold variants built from an outline the user has since replaced. The script stage clears the pick on Regenerate all, but a style change does not reach forward to it.
- Reproduce: generate variants, go back to style, regenerate the outline, return to script and observe the old variants.
- Why (from the code): `generateOutline` in `src/server/services/remix.ts` writes only the outline; nothing clears `variants`. Contrast `writeScript` in `src/components/remix/stage-script.tsx`, which clears the pick on a full regenerate.
- Severity: medium. Silent staleness the user cannot see.
- Decision needed: product call. Clearing variants on an outline change loses work; a warning may be enough.
- Raised by: [remix/stage-style.md](remix/stage-style.md#open-questions-and-verification).

### B-04: A plan edit is several writes with no rollback, so a mid sequence failure leaves a partial edit

- Where the user meets it: editing an existing planned post through the plan dialog.
- What happens vs what was expected: an edit runs up to four separate actions (title and note, schedule or unschedule, attach or detach, video kind) in sequence with no transaction. A failure partway leaves some writes applied and others not, surfaced as one generic error with no indication of which landed.
- Reproduce: edit several fields at once and force one of the later actions to fail.
- Why (from the code): `src/components/mine/plan-dialog.tsx` calls the actions in sequence; `src/server/actions/planned-post-actions.ts` has no combined edit path.
- Severity: medium. Leaves the plan in a state the user did not intend and cannot see.
- Decision needed: fix. A single edit action, or a rollback, or at least a report of what applied.
- Raised by: [mine/plan-dialog.md](mine/plan-dialog.md#open-questions-and-verification).

### B-05: Save to Vault "both" can half write and a retry duplicates the row that landed

- Where the user meets it: the Save to Vault dialog on the video detail page, choosing to save both a hook and a style.
- What happens vs what was expected: "both" fires two inserts in parallel and reports only the first failure, so one can land while the other fails. A retry re inserts the one that already landed, since `createVaultItemAction` does a bare insert with no dedupe and no cap.
- Reproduce: save both with one insert forced to fail, then retry.
- Why (from the code): `src/components/vault/save-to-vault-dialog.tsx` (the `Promise.all` of two inserts); `src/server/actions/vault-actions.ts` `createVaultItemAction` (no dedupe).
- Severity: medium. Duplicates a template silently.
- Decision needed: fix. Report per item, and dedupe or make the retry idempotent.
- Raised by: [feed/save-to-vault.md](feed/save-to-vault.md#open-questions-and-verification).

### B-06: A reload during a cook run loses the live run state while the run continues

- Where the user meets it: reloading the studio while a cook is running.
- What happens vs what was expected: the panel loses the live run state and shows the Cook button with no pill and no clock, even though the run continues server side. There is no reattach in this build (the source comment defers it). The user could start a second cook not knowing the first is still going.
- Reproduce: start a cook, reload the studio while it runs.
- Why (from the code): `src/components/studio/studio-panel.tsx` holds the run in client state seeded from a live frame; no reattach on mount. The status lives in `createRuns` server side.
- Severity: medium. Risk of a duplicate cook and a confusing display.
- Decision needed: fix. Reattach to the latest running create run on mount.
- Raised by: [studio/cook-run.md](studio/cook-run.md#open-questions-and-verification).

### B-07: The failure strip may not surface a failed cook run, only sync failures

- Where the user meets it: the shell failure strip, after a cook run fails.
- What happens vs what was expected: the foundations describe the strip as recent failures across the app, but `getFailureStrip` reads only the latest `sync_jobs` row and classifies Instagram sync codes. Whether a failed cook run reaches the strip is unconfirmed and looks unlikely from the code.
- Reproduce: fail a cook run and check the topbar strip.
- Why (from the code): `src/server/queries/failure-surface.ts` `getFailureStrip` (reads `sync_jobs` only).
- Severity: medium. A whole class of failure may never reach the app wide surface.
- Decision needed: product call. Decide whether the strip is sync only (rename its promise) or should include cook failures.
- Raised by: [cross-cutting/status-and-failures.md](cross-cutting/status-and-failures.md#open-questions-and-verification), [foundations/navigation-and-shell.md](foundations/navigation-and-shell.md#open-questions-and-verification).

### B-08: A hand marked published plan in the past still renders as a red missed cell

- Where the user meets it: the calendar, on a past plan the user marked published without a matching own post.
- What happens vs what was expected: the state derivation yields missed for a past scheduled date, and the published marker rides on top, so a plan the user marked published can read as a red missed cell.
- Reproduce: mark a past dated plan published by hand and view it on the calendar.
- Why (from the code): the derived state in `src/server/queries/planned-posts.ts` computes missed from the date while `publishedOwnPostId` is set separately.
- Severity: medium. The calendar contradicts the user's own action. Related to B-01.
- Decision needed: product call. A published plan should probably never read as missed.
- Raised by: [mine/calendar.md](mine/calendar.md#open-questions-and-verification).
- Status: confirmed by a Playwright pass on localhost:3000. A plan dated in the past, marked published by hand with no linked post, still renders as a red missed cell after a reload (screenshots b08-before-publish.png and b08-after-publish.png in the pass scratch dir). Entangled with B-01: the mark published action passes a null id, so the publish may not persist, which is likely why the missed styling wins after reload. Item CAL-05.


### B-09: The calendar delete Undo is lossy, dropping several fields on re-create

- Where the user meets it: deleting a plan on the calendar and clicking Undo.
- What happens vs what was expected: Undo re-creates the plan but drops its id, remix session link, source video link, video kind, time, and target length, keeping only the basics. The restored plan is not the same record.
- Reproduce: delete a fully linked plan, click Undo, compare.
- Why (from the code): the delete and Undo path in `src/components/mine/mine-calendar.tsx` re-creates from a partial snapshot.
- Severity: medium. Data loss on an action framed as reversible.
- Decision needed: fix. Carry the whole record, or soft delete and restore.
- Raised by: [mine/calendar.md](mine/calendar.md#open-questions-and-verification).

## Low

### B-10: The video analysis summary field is rendered but never written

- Where the user meets it: the video detail page, the analysis summary.
- What happens vs what was expected: `videoAnalyses.summary` is in the schema and the detail page renders `detail.analysis.summary`, but `getOrCreateAnalysis` never writes it (its text fields omit summary, and the schema and fake analysis have no summary). So the summary is always empty.
- Why (from the code): `src/server/services/analyze.ts` (text fields omit summary); `src/components/video/video-detail.tsx` renders it.
- Severity: low. A blank field, not a broken flow.
- Decision needed: fix. Either write the summary or stop rendering it.
- Raised by: [feed/analysis.md](feed/analysis.md#open-questions-and-verification), [feed/video-detail.md](feed/video-detail.md#open-questions-and-verification).
- Status: confirmed by a scripted read pass against the running product on localhost:3000. All 24 analyzed videos in the dev database have a null or empty summary, and the detail page renders an empty Summary section. Item DETAIL-05 and ANALYZE-09.

### B-11: Quick Remix is not blocked when the proxy is down, unlike the other generation controls

- Where the user meets it: the remix prompt stage with a key present but the proxy unreachable.
- What happens vs what was expected: the hook, style, and script stages swap in the block panel when the proxy looks down, but Quick Remix disables only on no topic or no key, so it stays clickable and fails to a toast.
- Why (from the code): `proxyDown` is not passed to `StagePrompt` in `src/components/remix/remix-studio.tsx`; the button's disable rule is `!topic || !hasLlmKey || quickRemixPending`.
- Severity: low. A recoverable failed click.
- Decision needed: fix. Pass the proxy down state to the prompt stage.
- Raised by: [remix/stage-prompt.md](remix/stage-prompt.md#open-questions-and-verification).

### B-12: Generate idea does not gate on a key or reflect an existing idea

- Where the user meets it: the Generate idea button on the video detail page.
- What happens vs what was expected: unlike the analyze gate on the same page, the button does not check for a key or a reachable proxy before rendering, and never reflects whether an idea already exists for the video, so it can fail to a toast or silently update an existing idea.
- Why (from the code): `src/components/video/video-detail.tsx` (the button has no key or existing idea check); `generateIdea` upserts on the source video.
- Severity: low.
- Decision needed: product call. Decide whether to gate it like analyze and show existing idea state.
- Raised by: [feed/generate-idea.md](feed/generate-idea.md#open-questions-and-verification).

### B-13: Publish survives a reload but Save to calendar does not, so they disagree after a reload

- Where the user meets it: reloading the studio after a cook produced a render.
- What happens vs what was expected: Publish is gated on the persisted render asset and stays enabled after a reload, but Save to calendar keys off the live in session render capture only, so after a reload Publish is enabled while Save to calendar is disabled.
- Why (from the code): `getPublishStateAction` reads the persisted render; the Save to calendar enablement reads the client `render` state in `src/components/studio/studio-panel.tsx`.
- Severity: low.
- Decision needed: fix. Base both on the persisted render.
- Raised by: [studio/publish.md](studio/publish.md#open-questions-and-verification).

### B-14: notFound on the video detail route returns HTTP 200 instead of 404

- Where the user meets it: opening a video detail URL for a video that does not exist.
- What happens vs what was expected: the route's `notFound()` returns HTTP 200 rather than 404, per a code comment noting the gap.
- Why (from the code): the video detail route under `src/app/(shell)/feed/[videoId]`.
- Severity: low. A wrong status code, not a visible break.
- Decision needed: fix.
- Raised by: [feed/video-detail.md](feed/video-detail.md#open-questions-and-verification).
- Status: confirmed by a scripted read pass on localhost:3000. Requesting `/feed/does-not-exist-123` returns HTTP 200 rather than 404. Item DETAIL-04.

### B-15: There is no way to clear the own channel from the my channel page

- Where the user meets it: the my channel page, wanting to change which channel is theirs.
- What happens vs what was expected: `unsetOwnChannelAction` exists but the page never calls it, so there is no UI path to clear the own channel from `/mine`.
- Why (from the code): `src/app/(shell)/mine/page.tsx` and its components never call `unsetOwnChannelAction`.
- Severity: low.
- Decision needed: product call. Decide whether clearing the own channel belongs here.
- Raised by: [mine/mine-overview.md](mine/mine-overview.md#open-questions-and-verification).

### B-16: Quick preview shows a soft removed video with no removed marker

- Where the user meets it: opening the quick preview for a video a sync has soft removed.
- What happens vs what was expected: the preview still resolves and shows the video with no removed flag, unlike the card and the detail page, which mark or hide a removed video.
- Why (from the code): the preview read path does not filter or flag `deletedAt`.
- Severity: low.
- Decision needed: product call. Match the card and detail page behavior, or leave preview as is.
- Raised by: [feed/quick-preview.md](feed/quick-preview.md#open-questions-and-verification).

### B-17: Small inconsistencies

- The analyze and generate idea actions return only `{ ok, error }` with no `code` field, unlike the action convention documented in the interaction model, so a caller cannot tell one failure from another. Raised by [feed/analysis.md](feed/analysis.md#open-questions-and-verification) and [feed/generate-idea.md](feed/generate-idea.md#open-questions-and-verification).
- The on screen studio brief composes the remix hook and chosen variant but does not show them; they reach only the cook's `brief.md`. Whether that is intended is unclear. Raised by [studio/studio-overview.md](studio/studio-overview.md#open-questions-and-verification).
- Severity: low. Decision needed: product call for each.

## Deferred as unconfirmed (left in the documents' open questions, not triaged here)

Several open questions could not be judged from code alone and need the running product before they become triage entries: whether a server action reliably commits when the page unmounts mid transition (raised by nearly every action document), whether unblurred field text is always lost on reload, whether two tabs on one remix session can interleave a half applied outline or variant set, and the exact meaning of the create run "waiting on you" status. These stay in the feature documents' "Open questions and verification" sections until a [verification](verification/README.md) pass can settle them.

Verified against this repo commit `4f26fb9`.
