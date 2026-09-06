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

Table columns:

| ID | P | Journey | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

- ID: a short prefix plus a number, for example `E2E-01`.
- P: same P1 to P3 priority scale.
- Journey: the named multi-step flow this case belongs to, for example "import a post then find
  it in the feed."
- Claim: the one-sentence end-to-end behavior being asserted, spanning at least two surfaces or
  a full round trip (act, then reload or navigate, then confirm the effect persisted).
- Setup: the dev server state, seed data, and any service that must be reachable for the whole
  journey to complete (the sidecar, the LLM proxy, the post-fetch provider).
- Steps: the `data-testid`-driven actions the `browse` skill performs, in order.
- Expected: the observable end state after the full journey.
- Result: left blank at authoring time; filled in during Phase 4's test gate or Phase 5 when the
  journey is actually driven through `browse`, with a 🟢/🔴/🟡 marker AND an embedded screenshot
  from `test-shots/` per "Result markers and evidence" above. A browse-e2e row that shipped can
  never stay `not run`: it is either driven (🟢/🔴 with a shot) or 🟡 with the named missing
  dependency. `browse` being unavailable is itself a 🟡, not a silent skip.

Cases here should be journeys, not single-page checks; a single-page visual check belongs in
the behavior lens instead.

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
