# Doc-sync report: architect docs vs code

A full reconciliation of `documents/architect/core-components` (and the shared docs) against the
current code. It records the drift found per component, what was synced, and the follow-ups that
are out of a documentation pass's scope. Every component was checked against the real source, not
the doc's own word.

## Verdict per component

| Component | Verdict before | Highest-severity drift | Now |
| --- | --- | --- | --- |
| mcp | already synced (v0.3) | 27 to 29 tools, artifact tools | in sync |
| kit | already synced (v0.3) | kai mcp, rollback, mcp-register | in sync |
| ig-sync | major | no multi-account section; stale metrics and concurrency | synced |
| analyze | minor | one retired repro step (Re-analyze) | synced |
| feed | minor | stale landing-page path | synced |
| discover | major | SeedPicker documented as unmounted (it is mounted in first-run); wrong migration, route, and seed counts | synced |
| mine | major | studio still documented (removed); no publish pipeline; edit described as four non-atomic writes | synced |
| onboarding | minor | secret prompt described as the removed `_writeToOutput` hook | synced |
| publish | minor | mine-page route path | synced |
| remix | in sync | two cosmetic nits | synced |
| llm | major | the retired in-app analyze path documented as a live caller, including a sequence diagram on a deleted function and green test rows on removed buttons | synced |
| shared/data-model | major | `createRuns` still listed (removed); `content_artifacts`, `ig_accounts`, `channels.accountId` missing | synced |

## What was synced

- shared/data-model: removed the `createRuns` record (the cook studio and its table are gone),
  added `content_artifacts`, `ig_accounts`, and `channels.accountId`, and updated the channel and
  remix-run entries.
- ig-sync: added the multi-account model, sticky assignment, the `planAccountSync` scheduler, and
  the accounts UI to the module table, the feature summary, and a new feature section, with the
  honest cross-account limit stated; corrected "concurrency 2" to 1 and the stale "planned
  crowsnest_metrics" and "future dashboard" claims (both shipped).
- discover: SeedPicker rewritten as mounted in the first-run sources step; migration citation
  corrected to `0025_black_titanium_man.sql`; route path corrected to the `(loaded)` group; seed
  counts corrected to the real 113 (27 fitness, 26 finance, 30 tech, 30 business).
- mine: removed the studio handoff; added a "Publish a planned post" feature (upload, caption,
  publish now or schedule, cancel, retry) cross-referencing the publish component; rewrote the plan
  edit as the single atomic `savePlanEditAction`; corrected the action count (8 to 15) and the route
  path; added the publish and confirm dialog rows.
- llm: removed analyze as a live caller across all five docs; rebuilt the section-5 sequence diagram
  around `generateIdea`; retired the test rows built on the removed in-app Analyze and Re-analyze
  buttons and repointed the structured-call happy path to a remix generation stage.
- analyze, feed, onboarding, publish, remix: the smaller path, mechanism, and marker fixes above.

House style verified across all changed docs: no em or en dashes, straight quotes only.

## Follow-ups (out of a docs-only pass)

These are real but need a code change or a separate test pass, so they are recorded here rather than
done in this sync:

- Code comment drift. `src/server/llm/client.ts` (the `resolveModel` JSDoc) still cites analyze.ts
  writing `video_analyses.model` as the reason the function is exported; nothing writes that column
  now. `src/server/llm/error-message.ts` still names `analyze-actions.ts` as a caller. Both are
  stale code comments, not docs.
- The `video_analyses.model` column exists in the schema but no current caller writes it. Decide
  whether to keep it for provenance or drop it in a later migration.
- GitNexus index is stale (it still reports the deleted analyze-to-llm call edges). Re-index with
  `node .gitnexus/run.cjs analyze --index-only` so graph queries match the current source.
- mine/04-test-cases has no browse-e2e journey for the new publish feature, and mine/03 lacks the
  closing "interactions" and "edge cases" sections the house style calls for. Both are pre-existing
  gaps; filed for a later test-and-doc pass.
- ig-sync's status line still calls the empty `IG_PASSWORD` onboarding path a hard buyer blocker.
  Verify against the current onboarding and sidecar behavior (session-file auth allows a blank
  password by design) and update the status if it is stale.
- feed's FEED-Q1: the default-view logic disagrees with stale comments in `feed-filters.ts` and
  `resolve-feed-nav.ts`. Already tracked; a code-comment reconciliation, not a doc fix.
