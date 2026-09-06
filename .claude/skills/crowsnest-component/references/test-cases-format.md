# The four test lenses

This reference defines the shape of `04-test-cases.md` for a crowsnest component. It is the
funflow product-owner, API, e2e, and security lenses, re-cut for a single-user Next.js plus
SQLite/drizzle plus Python sidecar desktop app with no multi-tenancy and no roles.

During Phase 2b of the `crowsnest-component` skill, parallel test-case agents write across these
four lenses after `03-feature-description.md` exists, then their output is merged into one
`04-test-cases.md`. Each lens is its own section in that file, in the order below, and each
section is a table of cases plus an optional "Not checkable by hand" list for anything the lens
cannot exercise without a tool the component does not have.

## Result markers and evidence

The Result column is blank at authoring time. Once a case is actually run during Phase 4's test
gate (or Phase 5 verification), it carries one of these markers, never bare prose:

- 🟢 pass: the case ran and Expected held. A browser-run case (the whole browse-e2e lens, plus
  any behavior case driven through `browse`) MUST embed the screenshot that proves it, so a
  reader can double-check the result without re-running it.
- 🔴 fail: the case ran and Expected did not hold. Name what actually happened, and embed the
  screenshot of the wrong state. A 🔴 on a P1 case blocks the phase; it is filed as a
  `05-backlog` row, not left as the only record.
- 🟡 blocked: the case could not run because a dependency the sandbox lacks was missing (no
  sidecar, no real credentials, no LLM key). Name the missing dependency and the release gate it
  is deferred to. 🟡 is for a genuinely un-runnable layer, never for a layer that was simply
  skipped.

A case still shows `not run` only before its phase's test gate has run; a mandatory case left
`not run` blocks the phase (see the `crowsnest-component` skill, Phase 4).

**Evidence folder.** Every component keeps its browser screenshots in a `test-shots/` folder
beside its five docs (`documents/architect/core-components/<name>/test-shots/`). Name each shot
for the case it proves, lower-cased: `test-shots/e2e-02.png`, `test-shots/beh-07.png`. Embed it
from the Result cell as an inline image so it renders in the mkdocs site and in the doc itself,
for example `🟢 ![E2E-02](test-shots/e2e-02.png) bar read 2, action posted 200, selection
cleared`. One shot per case is enough; capture the single frame that proves Expected (or, for a
🔴, disproves it).

Use `documents/architect/core-components/feed/04-test-cases.md` as the worked example of the
table shape and the writing style: a top-of-file "how to run this file" paragraph naming the
dev server, the seed data needed, and which rows need an external service, then one table per
page or surface, then a "Not checkable by hand" list of open questions.

## behavior

Product-owner style, sourced from `03-feature-description.md`: what the user sees and does.
Arrive at the surface, act on it, finish, and the visible states along the way, including empty
states, loading states, and error copy the user actually reads.

Write one row per user-visible claim, each row traceable to a feature bullet in
`03-feature-description.md` (link back to it the way `feed/04-test-cases.md` does, for example
`([the simple case](03-feature-description.md#the-thing))`).

Table columns:

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

- ID: a short prefix per surface plus a number, for example `FEED-01`.
- P: priority, P1 for the primary path and anything a broken build would show first, P2 for
  secondary paths and edge cases, P3 for cosmetic or low-traffic detail.
- Needs: what the case takes to run by hand, for example `mouse`, `keyboard`, a named fixture
  such as `a soft removed video`, or an external dependency such as `post-fetch provider up`.
- Claim: the one-sentence behavior being asserted, with a link back to the feature bullet it
  comes from.
- Setup: the data or state the case needs before the steps start.
- Steps: the numbered actions a person takes.
- Expected: what should be true after the steps.
- Result: left blank at authoring time; filled in during Phase 4's test gate or Phase 5 with a
  🟢/🔴/🟡 marker per "Result markers and evidence" above. A behavior case driven through
  `browse` embeds its screenshot from `test-shots/`; one checkable purely by reading a value
  carries the marker and a one-line note.

## route and action

Server actions, API routes, and drizzle reads and writes, tested with `vitest` against a
temporary SQLite database. This lens does not touch the browser; it calls the action or route
handler directly and asserts on its return value and on the rows a following drizzle query sees.

Table columns:

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

- ID: a short prefix plus a number, for example `ACTION-01` or `ROUTE-01`.
- P: same P1 to P3 priority scale as the behavior lens.
- Layer: `server action`, `API route`, or `drizzle query`, naming the file under test, for
  example `src/server/actions/keep-post.ts`.
- Claim: the one-sentence contract being asserted (return shape, error code, row written, row
  updated in place versus a new row, transaction rolled back on failure).
- Setup: the temp SQLite database state before the call: schema migrated, seed rows inserted
  with `drizzle`, any mocked upstream (sidecar, LLM proxy, Graph API) stubbed or left unmocked.
- Call: the exact function or endpoint invocation, with its arguments.
- Expected: the return value and the resulting database state, read back with a drizzle query
  in the same test.
- Result: left blank at authoring time; filled in when the vitest suite runs, with a 🟢/🔴/🟡
  marker per "Result markers and evidence" above (no screenshot; this lens has no browser).
  A case written but not yet wired to a real test file is 🟡 with that noted, not left blank.

Each row here should be reachable from a case in the behavior lens (the same user action, one
level lower), but this lens also covers cases the behavior lens cannot reach by hand, such as a
concurrent write race or a database constraint violation.

## browse-e2e

Real browser journeys through the shipped UI, driven by the `browse` skill in place of a
Playwright suite. See the sibling reference `browse-e2e-qa.md` for the full convention: the
`data-testid` discipline (every element a journey interacts with carries a stable
`data-testid`; text and role selectors are the exception, because they collide silently), how a
journey is written, and a worked example.

### Coverage mandate

The browse-e2e lens must carry, per component, at least one happy-path journey for every `●`
(Built) or `◐` (Partial) feature in the `03-feature-description.md` summary table, plus at least
five journeys that each exercise a distinct corner-case type from the taxonomy below. A `○`
(Roadmap) feature needs no journey. Five distinct types, not five rows of one type: a component
with three empty-state journeys and two boundary journeys has covered two types, not five.

The floor is mechanical because it anchors to something already counted. The count of `●` plus
`◐` rows in the summary table is the number of required happy-path journeys, which a person or a
script reads off directly. Every browse-e2e row names, in the `Feat` column, the summary `#` it
covers, so breadth is measured by distinct `Feat` values covered, not by row count: one journey
that spans several features (`Feat: 2,4,5`) counts toward all of them.

If a corner-case type genuinely does not apply to a component (a component with no external call
has no `network` type), record a one-line "not applicable" reason under the browse-e2e heading,
the same latitude security-lite already has when it says it has no threat surface. What is not
allowed is silence: five real types, or a named reason a type does not apply.

### Corner-case taxonomy

Each name maps to a real crowsnest surface, so these are not generic QA buckets. A type counts
only when it has its own named journey and an observable assertion.

| Type key | What it means on this app | Real example surface |
| --- | --- | --- |
| `empty` | The zero-data state and its recovery link | feed's empty states (no channels, no sync, empty search, empty filter slice), each with recovery copy |
| `failure` | An action that fails and shows its reason inline, not a toast | Add channel with the sidecar down: `add-channel-dialog.tsx`'s error Alert, "The Instagram service isn't running." |
| `boundary` | A count, page size, or cap at its edge | feed page size of 24 then Load more to `limit=48`; recently-viewed capped at eight |
| `invalid` | Malformed, blank, or junk input rejected | a pasted profile URL rejected as invalid input, writing no channel row |
| `concurrency` | Two tabs or a double click racing one row | a second sync returns `SYNC_ALREADY_RUNNING` while the first is still active |
| `auth` | A license, sidecar-token, or Graph-token gate refusal driven through the UI | a missing Graph token shows the connect panel without hiding stored metrics |
| `stale` | Optimistic UI or reload reconciliation, the window where the visible state and the database disagree | a keep button flips only after the page re-reads; a saved view deleted in another tab returns `SAVED_VIEW_NOT_FOUND` |
| `network` | An external service unreachable mid-journey | a stopped sidecar produces `IG_SERVICE_DOWN` and no running job remains |
| `repeat` | The same action run twice: dedupe or upsert, not duplicate | re-importing an existing post upserts rather than creating a duplicate |

The taxonomy is a menu, not a mandate to hit all nine. Five distinct applicable types is the
floor; a genuinely inapplicable type is the one-line "not applicable" note above.

### Table columns

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- ID: a short prefix plus a number, for example `E2E-01`.
- P: same P1 to P3 priority scale.
- Feat: the `03` feature summary `#` this journey covers, for example `2`, or `2,4` when the
  journey spans two features. This is what makes the coverage mandate countable: sum the distinct
  `Feat` values against the built-feature list. Breadth is distinct-`Feat`-covered, so a journey
  covering several features counts for all of them; a corner-case journey still names the feature
  it stresses.
- Type: `happy` for a happy-path journey, or one taxonomy key (`empty`, `failure`, `boundary`,
  `invalid`, `concurrency`, `auth`, `stale`, `network`, `repeat`) for a corner case.
- Mode: `offline` or `live`. `offline` journeys run against the seeded fixture database with no
  external service, and are the ones `npm run e2e` can run everywhere. `live` journeys need a real
  service (the sidecar logged into a burner account, an LLM key, the Graph token) and are honestly
  🟡 in a bare sandbox. Naming this in a column, instead of burying it in Setup prose, is what lets
  the 4b gate treat a 🟡 on a `live` row as expected and a 🟡 on an `offline` row as a failure to
  run something that could have run.
- Journey: the named multi-step flow this case belongs to, for example "import a post then find
  it in the feed."
- Setup: the dev server state, seed data, and any service that must be reachable for the whole
  journey to complete (the sidecar, the LLM proxy, the post-fetch provider).
- Steps: the `data-testid`-driven actions the `browse` skill performs, in the three-part
  Arrive / Act / Assert shape (see `browse-e2e-qa.md`), one user action per step, each naming the
  `data-testid` it targets.
- Expected: the observable end state after the full journey. Every assertion must name the
  `data-testid` it reads (no vague "the channel appears" or "the page works"); an assertion that
  cannot name a testid says which `lib.sh` helper reads it instead (`assert_text` reads cleaned
  page text, `assert_url_contains` reads the URL).
- Script: the path to the checked-in `scripts/e2e/<component>-<id>.sh`, for example
  `scripts/e2e/feed-e2e-01.sh`, or `none` if the journey is hand-run only. `none` is allowed only for a
  `live` journey no harness can seed; an `offline` row with `Script: none` is unfinished.
- Result: left blank at authoring time; filled in during Phase 4's test gate or Phase 5 when the
  journey is actually driven through `browse`, with a 🟢/🔴/🟡 marker AND an embedded screenshot
  from `test-shots/` per "Result markers and evidence" above, plus a one-line note in the cell of
  what was actually observed. A browse-e2e row that shipped can never stay `not run`: it is either
  driven (🟢/🔴 with a shot) or 🟡 with the named missing dependency. `browse` being unavailable is
  itself a 🟡, not a silent skip.

### Tightened rules

- Every assertion in Expected names the `data-testid` it reads. Prose assertions on unnamed
  elements ("the channel appears", "the page works") are how a journey silently asserts on the
  wrong node, the collision the `data-testid` discipline in `browse-e2e-qa.md` warns about.
- A 🟡 on a `Mode: offline` row is a gate failure. An offline row has, by definition, no external
  dependency to be blocked on, so a 🟡 there means the author skipped a runnable journey. A 🟡 is
  honest only on a `Mode: live` row, where it names the real missing dependency.
- An `offline` row with `Script: none` is unfinished. The lasting artifact of a browse-e2e case is
  the table row plus the checked-in script, so an offline journey that could be scripted but was
  not is incomplete work, not a passing row.

Cases here should be journeys, not single-page checks; a single-page visual check belongs in
the behavior lens instead.

### Authoring the breadth (Phase 2b)

Before writing rows, build a scratch feature-to-journey coverage matrix: one row per `●`/`◐`
feature down the side, the nine corner-case types across the top. Write a happy-path journey for
every built feature (the floor), then corner rows until five distinct types are covered. The
matrix does not ship; it just forces the gaps into view, the way cn-weekly's funnel table forces
coverage into view. Guardrails against busywork: one happy-path journey per built feature, not one
per business rule (rules stay in the behavior lens), and a journey may cover several features
(`Feat: 2,4,5`) so breadth is distinct-`Feat`-covered, not row count.

### Migration

Do not rewrite all eleven `04` docs at once. Backfill incrementally, worst-first: kit and mcp
(zero browse-e2e rows today) first, then the six single-row components (analyze, discover, llm,
remix, plus feed, ig-sync, and mine, which are closest). Let each component's backfill ride its
next Phase 5b doc-sync, and track the shortfall as a `test-coverage` row (Status `open`) in that
component's `05-backlog-to-enhance.md` so `scripts/plan-status.sh` counts the remaining gap.
Grandfather the existing rows: annotate them with the new `Feat`, `Mode`, and `Script` columns
(defaulting `Script` to `none` and `Mode` from their Setup prose) rather than deleting them.

## security-lite

A local-desktop threat model, explicitly not OWASP multi-tenant. Crowsnest is a single-user
desktop app with no roles and no separate tenants, so this lens does not cover authorization
matrices, session fixation, or cross-tenant data leaks. It covers the threats that are real on
this shape of app:

- Secret handling in `.env.local`: a key is read from the environment, never logged, never
  written back to the database or to a response body, and never shipped in a client bundle.
- The license gate: a component that should be gated behind a valid license refuses to run
  without one, and the check cannot be bypassed from the client.
- The sidecar shared token: the Next.js app and the Python sidecar authenticate to each other
  with the shared token; a request without it, or with the wrong one, is refused.
- No buyer data leaving the box: nothing the component does should make an outbound call that
  sends buyer or channel data anywhere other than the configured provider for that exact
  feature (for example, only the transcript provider gets transcript audio; the LLM proxy gets
  only what a prompt needs).

Table columns:

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

- ID: a short prefix plus a number, for example `SEC-01`.
- P: same P1 to P3 priority scale; a secret leak or a bypassable license gate is P1.
- Threat: which of the four threat categories above the case exercises.
- Claim: the one-sentence guarantee being asserted.
- Setup: the state needed to attempt the threat, for example a missing or malformed
  `.env.local` key, an invalid or absent sidecar token, no license present.
- Steps: how the case attempts to violate the guarantee.
- Expected: the refusal, the redaction, or the absence of the leak.
- Result: left blank at authoring time; filled in when the case is run, with a 🟢/🔴/🟡 marker
  per "Result markers and evidence" above. A secret-handling or sidecar-token case driven through
  the browser or a shell attempt embeds its screenshot or names the command output as evidence.

Do not add rows for threats that do not apply to a local single-user desktop app, such as
per-tenant rate limiting or role escalation. If a component genuinely has no security-lite
surface (it touches no secret, no license gate, no sidecar call, and sends nothing off the
box), say so in one line under the section heading instead of inventing rows.
