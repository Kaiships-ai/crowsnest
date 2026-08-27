# Crowsnest core loop product description

A written description of the user experience of the Crowsnest core loop: what the user sees, what they can do, and exactly what happens when they do it. The core loop is the path from an outlier in the feed, through a remix into a script, into a planned post, into a cook run in the studio, to publish.

## Purpose

Crowsnest is, from the user's point of view, a large state chart. The user moves through it with clicks, form edits, filter changes, keyboard shortcuts, and long running actions that generate text or drive a background run. Most of that behavior is defined implicitly, spread across server actions, React state, drizzle queries, a websocket that drives a pseudo terminal, and the tests around them. There is no single place that says, in plain language, "when the user does X, this is what happens, and this is what happens if they stop halfway."

This project is that place. It describes the experience on one surface: a single local user, the routes under `src/app/(shell)` that make up the core loop, in the default configuration with nothing customized.

The documents are for people who need to understand or change the product: the solo founder who runs it, and anyone evaluating whether a behavior is intended. They are written from the outside in. They describe the experience, not the implementation.

### What this is not

- Not API documentation. The route handlers under `src/app/api` and the server action signatures are reference, not the subject.
- Not organized by package or module. A single behavior is described once, wherever the user meets it.
- Not a technical design document. Where a technical detail changes what the user would expect, it appears in a block quote labeled `Technical note:` and nowhere else.

## Conventions

- Describe the experience, not the code. "The variant list stays empty until the model answers", not "generateVariants awaits getLlm".
- Technical detail goes in block quotes, prefixed with `Technical note:`. Use it only when the mechanism changes what the user would expect.
- Sentence case for headings.
- Name the vocabulary consistently. The [glossary](glossary.md) is the source of truth for terms like video, planned post, remix session, script, remix run, create run, and stage.
- Every document ends with the commit of this repo it was verified against and a list of open questions.
- When a behavior is surprising, say so and say why if the reason is known. Do not smooth it over.

## The work to be done

Each document describes one feature. Features are large (the remix studio, the studio cook run) or small (the save to vault dialog), but each is described in full, including its edge cases and its interactions with other features.

### Document template

Every feature document follows the same skeleton so that documents are comparable and nothing is skipped.

1. Summary. One paragraph describing the feature abstractly, then its concrete identity: where it lives, how it is reached, what signals it is active, and whether it is available in restricted states (no own channel set, the LLM proxy down, the sidecar not running).
2. The simple case. The common path in prose.
3. The interaction, event by event. The five phases of a Crowsnest action: arrive, leave without acting, begin acting, while acting, finish. What starts it and what is loaded or prefilled, what happens if the user leaves without acting, what is decided the moment the action begins, what updates while it runs, and what is committed at the end. Include a small state diagram (Mermaid `stateDiagram-v2`) of the states the user passes through.
4. Variants. A table of the four variant rows below, and what each does when set on arrival and when it changes while acting.
5. Cancel and interrupt. The same seven rows in every document, in the same order.
6. Interactions with other systems. The seven cross-cutting concerns below, in the same order in every document.
7. Edge cases. Anything a user could notice that is not covered above.
8. Open questions and verification. The commit this document was verified against, and any behavior that could not be confirmed.

Item 5 matters most. Asking the same interrupt questions of every feature is how gaps and inconsistencies are found.

#### The five phases

The unit of interaction is one action the user takes on a page: opening a dialog and saving it, running a remix stage, driving a cook run. Its phases, named once and used in every document:

- Arrive. The page or dialog opens. What loads, what is focused, what is prefilled.
- Leave without acting. The user backs out before changing anything. What, if anything, is recorded.
- Begin acting. The first change or the first click that starts real work: the first edit that makes a form dirty, the first generation request, the moment a run spawns.
- While acting. What updates while the work is in flight: a form's live state, a stage's generated result arriving, a run's status pills and terminal output.
- Finish. What is committed: a database row, a script, a planned post, a rendered asset. Where the user lands next.

#### The four variant rows

The same rows in every Variants table. Two columns: set on arrival, changed while acting.

- Record state. The state of the thing being acted on: a video analyzed or not, saved or not; a planned post draft, scheduled, missed, or published; a remix session's stage; a create run running, waiting, success, or failed.
- Attached data present or absent. Whether the video has a transcript and an analysis; whether a planned post has a script attached; whether a remix session has a chosen hook, style, or variant.
- External service availability. Whether the LLM proxy answers, the Graph token is valid, the transcript providers are reachable, the sidecar sync is running.
- Keyboard shortcut in play. Arrow key navigation on the detail page, Enter and Escape in dialogs, and any other key the feature honors.

#### The seven interrupt rows

The same rows, in this order, in every document. The columns are the action before it commits and while it is in flight.

1. Explicit cancel or stop. Escape in a dialog, Stop on a cook run, a Cancel button.
2. Navigate away mid action. A sidebar link, browser back or forward, a deep link, closing a dialog, while a generation or run is in flight.
3. Reload or tab or window closed mid action.
4. A backing service fails mid action. The LLM proxy is down, the Graph token is invalid, the sidecar is not running, a request errors or times out.
5. The target record changes underneath. The source video is removed by a sync, the planned post is edited in another tab, a script is detached, the create run row is updated by the websocket.
6. A background job finishes or fails on its own. The cook run completes or fails, or a render appears, while the user is elsewhere.
7. A second tab or a double action on the same record. Two remix sessions on one video, two cook runs, a double submit.

#### The seven cross-cutting concerns

Walked in this order in every document's "Interactions with other systems" section.

1. Persistence and autosave. What is saved when: remix autosave, drafts, recently viewed, saved filters, settings.
2. History and undo. Whether the action can be undone, and if not, say so.
3. Navigation and refresh. `router.refresh`, force dynamic rendering, deep links, feed navigation.
4. Background jobs and the sidecar. The sync that writes videos, the cook run, the render watch.
5. External services. The LLM proxy, the Graph API, the transcript providers.
6. Status and failures. The failure strip, run pills, toasts, empty and error states.
7. Configuration and settings. `appSettings`, thresholds, `scoreMinUsablePosts` and other tunables.

### Method

For each document:

1. Read where the interaction state lives (the server action, the client component that holds state) and the relevant tables in `src/server/db/schema.ts`.
2. Read the matching tests. Files under `src/server/services`, `src/server/queries`, and `src/server/actions` read as executable specifications of the edge cases.
3. Draft the document.
4. Try anything ambiguous in the running product at `http://localhost:3001`. Tests settle what happens; the running product settles how it feels, what is visible while an action is in flight, and what the timing is like.
5. Record the commit verified against.

### Verification

Drafting reads the code; verification watches the product. The `verification/` directory holds one checklist per cluster of documents, each item a single observable claim with setup, steps, expected result, a priority, and what it needs. A pass runs them at `http://localhost:3001`, records pass, fail, or blocked in the Result column, and files every failure in `bug-triage.md` with the item's ID. A document moves from `drafted` to `verified` only when every P1 and P2 item for it has passed or been filed.

`bug-triage.md` is the other half: every behavior the documents flagged as a likely defect, deduplicated, with reproduction steps, the reason in the code, a severity, and the decision the product team needs. Entries confirmed in the running product carry a Status line.

### Order of work

1. Pilot: the save to vault dialog on the video detail page. Small and self contained. Used to settle the template, tone, and depth.
2. Foundations: the data model, the interaction model, the shell and navigation, the background jobs. Everything else links to them.
3. The remix studio. The bulk of the experience and the hardest part, a six stage generation wizard. Written third so the template is already proven.
4. Everything else: the rest of the feed, mine, studio, and the cross-cutting documents. Drafted in parallel once the template and the exemplars exist, then a consistency pass and a verification pass across the whole set.

Progress is tracked in the [coverage table](#coverage) below.

### Scope decisions

- Core loop only. The routes under `(shell)` that are not on the path from feed to publish (ideas, runs, channels, persona, vault, settings, logs) are out of scope for this repo. Where the core loop hands off to one of them (generate idea writes to the ideas inbox), the document names the exit and stops there.
- First run onboarding is out of scope. The `/first-run` wizard is described only as a gate: the shell redirects to it until setup is done. The setup steps themselves are not documented here.
- The agent run terminal internals are out of scope. The cook run is described from the user's side: the Cook and Stop buttons, the run pills, what the terminal shows. The pseudo terminal, the websocket frames, and the pty plumbing are not documented.
- Settings and logs pages are out of scope. Settings values that change core loop behavior are named where they matter (for example `scoreMinUsablePosts`), but the settings and logs screens are not described.
- Single local user. One person, one machine, the default seeded configuration. There are no roles or plans, so the variant axis uses record state and service availability rather than permissions.
- Interaction shape. The unit of interaction is one action on a page, its phases are arrive, leave without acting, begin acting, while acting, finish. The interrupt list and the order of cross-cutting concerns are fixed as written in the document template above.
- These are prose documents, not numbered specifications. Stable heading anchors are enough for cross references.

## Structure

```
README.md                          this file
goal.md                            the standing instructions for whoever drafts
AGENTS.md, CLAUDE.md               entry points for agents: read README.md, then goal.md
glossary.md                        shared vocabulary
bug-triage.md                      suspected defects collected from every document, with repro steps and decisions needed

verification/
  README.md                        how to run a hand verification pass and record results
  foundations.md                   checklists for foundations/
  feed.md                          checklists for feed/
  remix.md                         checklists for remix/
  mine.md                          checklists for mine/
  studio.md                        checklists for studio/
  cross-cutting.md                 checklists for cross-cutting/

foundations/
  data-model.md                    the four nouns and their supporting records, what each means to the user, the states each can be in
  interaction-model.md             the five phases, what committed means, the cancel and interrupt definitions every document links to, the generation and background run model
  navigation-and-shell.md          the shell layout, sidebar, topbar, command menu, first run gate, refresh model, deep links
  background-jobs.md               the sidecar sync that writes videos, the cook run lifecycle and its statuses, the render watch, from the user side

feed/
  feed.md                          the outlier feed page: grid and list, follower bands, load more, empty states
  filters-and-saved-views.md       the filter bar, applying and clearing filters, URL state, manage saved views, add video
  quick-preview.md                 the quick preview sheet opened from a card
  video-detail.md                  the detail page: player and carousel, metric chips, median baseline, layout section, similar outliers, arrow key navigation
  analysis.md                      analyze and reanalyze a video, the analysis gate, transcript providers
  save-to-vault.md                 the save to vault dialog (pilot)
  generate-idea.md                 generate an idea from a video, an exit from the core loop into the ideas inbox

remix/
  remix-overview.md                the remix studio shell, stepper, stage routing, context rail, run log, quick remix, autosave
  stage-prompt.md                  the prompt stage: topic, niche, target length
  stage-research.md                the research stage: building research notes from vault and similar outliers
  stage-hook.md                    the hook stage: generating and choosing a hook
  stage-style.md                   the style stage: choosing a style vault item
  stage-script.md                  the script stage: generating variants, regenerating, saving a script
  stage-finish.md                  the finish stage: finishing the remix and creating the planned post

mine/
  mine-overview.md                 the my channel page: own channel picker, stat tiles, progress, tabs, graph connect panel
  calendar.md                      the month calendar, day cells, draft and scheduled and missed and published states, drag moves
  plan-dialog.md                   create and edit a planned post, attach and detach a script, schedule, unschedule, delete, mark published
  posts-and-metrics.md             the own post list, weekday rhythm, reach by post bars

studio/
  studio-overview.md               the studio brief screen and panel: the brief, layout fields, score
  cook-run.md                      Cook and Stop, the create run lifecycle and run pills, the terminal pane from the user side
  publish.md                       the publish gate, serve, mark published, save to calendar

cross-cutting/
  external-services.md             the LLM proxy, the Graph API, the transcript providers: what the user sees when each is unavailable
  status-and-failures.md           the failure strip, run pills, toasts, empty and error states
  persistence.md                   what is saved when: remix autosave, drafts, recently viewed, saved filters, settings
```

## Coverage

Status is one of `not started`, `drafted`, or `verified`.

| Document | Status |
| --- | --- |
| glossary.md | drafted |
| bug-triage.md | not started |
| verification/ (6 checklists) | not started |
| foundations/data-model.md | drafted |
| foundations/interaction-model.md | drafted |
| foundations/navigation-and-shell.md | drafted |
| foundations/background-jobs.md | drafted |
| feed/feed.md | not started |
| feed/filters-and-saved-views.md | not started |
| feed/quick-preview.md | drafted |
| feed/video-detail.md | not started |
| feed/analysis.md | not started |
| feed/save-to-vault.md | drafted |
| feed/generate-idea.md | not started |
| remix/remix-overview.md | drafted |
| remix/stage-prompt.md | drafted |
| remix/stage-research.md | drafted |
| remix/stage-hook.md | drafted |
| remix/stage-style.md | drafted |
| remix/stage-script.md | drafted |
| remix/stage-finish.md | drafted |
| mine/mine-overview.md | not started |
| mine/calendar.md | not started |
| mine/plan-dialog.md | not started |
| mine/posts-and-metrics.md | not started |
| studio/studio-overview.md | not started |
| studio/cook-run.md | not started |
| studio/publish.md | not started |
| cross-cutting/external-services.md | not started |
| cross-cutting/status-and-failures.md | not started |
| cross-cutting/persistence.md | not started |

## Reference

The source of truth is this repo at commit `4f26fb9`. The relevant locations for the core loop:

- `src/app/(shell)/feed`, `feed/[videoId]`, `feed/[videoId]/remix`, `mine`, `mine/[postId]/studio`: the surface this project describes.
- `src/server/actions`: the server actions that hold the write side (remix-actions, saved-post-actions, planned-post-actions, create-run-actions, analyze-actions, idea-actions, channel-actions, graph-actions).
- `src/server/services/remix.ts`: the remix stage logic.
- `src/server/queries`: the read side (feed, video, planned-posts, studio, remix-runs, own-channel).
- `src/server/db/schema.ts`: the tables (videos, channels, transcripts, videoAnalyses, remixSessions, remixRuns, scripts, plannedPosts, savedPosts, vaultItems, createRuns, ownPosts, appSettings).
- `src/server/terminal`: the create run websocket and pty (out of scope internals, referenced only for the run status frames the user sees).
- `src/components/{feed,video,remix,mine,studio}`: the UI.
- `src/lib/feed-filters.ts`, `src/server/config.ts`: filter parsing and the tunable numeric defaults.
