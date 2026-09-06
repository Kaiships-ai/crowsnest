# Browser e2e QA via the browse skill

This is the convention for the browse-e2e lens in `04-test-cases.md`, and for actually
running those journeys once a feature is implemented. It applies to every crowsnest
component doc set, not just one route.

## Why browse, not Playwright

Crowsnest has two real test surfaces: vitest for unit and route/action level coverage, and
the `browse` skill for driving the running app in a real headless browser. There is no
Playwright suite in this repo, no `e2e-tests` package, and no page object layer. Do not
propose adding one just because another codebase in this environment uses Playwright for
its e2e layer. `browse` already covers what a Playwright spec would: navigate a real route,
click and type against the rendered DOM, and assert on what actually appears, without a
second toolchain, a second dependency set, or a second CI job to maintain.

Treat `browse` as a QA tool, not a second test framework: there is no spec file format,
no page object layer, and no assertion DSL to learn beyond a case's own Arrive/Act/Assert
steps. But a journey is still worth keeping runnable, not just narrated once and
forgotten, so once a case's `data-testid`s exist, its journey is written down as a small
shell script under `scripts/e2e/<component>-<id>.sh` (for example
`scripts/e2e/feed-e2e-01.sh` for feed's E2E-01) -- plain bash calling the `browse` CLI
directly, one script per case, no shared spec runner, no fixtures beyond a seeded
database. `npm run e2e` (`scripts/e2e/run.sh`) seeds a fixture database, starts the dev
server on port 3001 against it, runs every `scripts/e2e/*-e2e-*.sh` script in turn, and
exits non-zero on the first journey that fails; `scripts/release-prep.sh` calls it before
a release, same as `npm test`. The lasting artifact of a browse-e2e case is therefore two
things together: the case table in `04-test-cases.md`, which is the source a journey
script is written from, and the checked-in `scripts/e2e/<component>-<id>.sh` script
itself, which is what actually runs it. Neither one is a `.spec.ts` file, and this is
still not Playwright: no page object layer, no `test.describe` blocks, no second
dependency set to keep current.

## data-testid discipline

Every element a browse-e2e journey touches must carry a stable `data-testid`. This mirrors
the funflow `core-component-impl` skill's Phase 4a rule and applies here unchanged:

- The trigger or button that opens something, each distinguishable row or item action, form
  fields that get filled, badges or counts that get asserted, and empty-state placeholders
  all need their own `data-testid`.
- Text and role selectors (`getByText`, `getByRole` with a visible label) are the exception,
  not the default, because they collide silently. A selector aimed at one row can match an
  unrelated element elsewhere on the same screen that happens to carry the same text, and the
  journey then acts on the wrong thing with no error, only a wrong result later.
- A shared `data-testid` across a list of repeated rows or dropdown items is fine when the
  journey only needs to count how many exist or confirm at least one is present. It is not
  fine for targeting one specific row. When a journey needs "the second item" or "the row
  matching X", either add a per-item distinguishing attribute alongside the shared testid
  (for example `data-id`), or fall back to a scoped filter and say so explicitly in the case
  table rather than leaving the ambiguity unstated.
- If a journey in `04-test-cases.md` needs an element that has no `data-testid` yet, that is
  a real gap to fix in the component's own code, not a reason to reach for a text or role
  selector instead. Add the testid before scripting the journey against it.

## Writing a journey

Source journeys from the browse-e2e lens in `04-test-cases.md`, using the case format in
`references/test-cases-format.md`. Each case becomes one journey with three parts:

- **Arrive.** State the route the journey starts on and any precondition (signed in, a
  channel already tracked, a fleet already created).
- **Act.** The sequence of clicks, typing, and navigation the journey performs, each step
  naming the `data-testid` it targets. Keep each step to one user action.
- **Assert visible state.** What must actually appear on screen after the action, named
  concretely (a toast message, a new row, a count updating, a dialog closing) and, where the
  case calls for it, the `data-testid` of the element the assertion reads from.

A journey should read the same way a manual tester would narrate it: go here, do this, see
that. Do not fold multiple unrelated user goals into one journey; a case that mixes an add
flow with an unrelated delete flow is two cases, not one.

The three parts map onto the browse-e2e table's `Steps` column (Arrive and Act steps) and its
`Expected` column (the Assert visible state), per the column definitions in
`references/test-cases-format.md`. Keep each step to one user action naming its `data-testid`, and
name in Expected the `data-testid` every assertion reads: an assertion that cannot name a testid
says which `lib.sh` helper reads it (`assert_text` for cleaned page text, `assert_url_contains`
for the URL). Vague assertions such as "the channel appears" or "the page works" are the wrong-node
collision this discipline exists to prevent, and are rejected at the Phase 4b gate.

Before writing any rows, build a scratch feature-to-journey coverage matrix from
`03-feature-description.md`: one row per `●`/`◐` feature down the side, the nine corner-case types
across the top. Write a happy-path journey for every built feature (the floor), then corner rows
until five distinct types are covered. The matrix does not ship; it just makes the gaps visible.
One happy-path journey per built feature, not one per business rule (rules stay in the behavior
lens), and a single journey may cover several features (`Feat: 2,4,5`), so breadth is measured by
distinct `Feat` values covered, not by row count. The `Mode` column says whether a journey is
`offline` (runs against the seeded fixture database, so `npm run e2e` runs it everywhere) or
`live` (needs the sidecar, an LLM key, or the Graph token, and is honestly 🟡 in a bare sandbox);
a 🟡 on a `Mode: offline` row is a gate failure, and an `offline` row with `Script: none` is
unfinished.

## Capturing evidence (mandatory)

Driving a journey is only half of running it. The other half is leaving proof a human can
double-check without re-running it. For every browse-e2e case you actually drive:

1. At the frame that proves Expected (the toast, the new row, the count that changed, the bar
   that appeared), take a screenshot: `browse screenshot <abs path>` or `browse snapshot -a -o
   <abs path>` for an annotated one.
2. Save it into the component's own evidence folder, `documents/architect/core-components/<name>/
   test-shots/`, named for the case, lower-cased: `test-shots/e2e-02.png`, `test-shots/beh-07.png`.
3. Read the screenshot back yourself (the `browse` skill's own rule 11) so you have actually seen
   what you are about to assert, then set the case's Result cell to the marker plus the embedded
   image, per `references/test-cases-format.md`: `🟢 ![E2E-02](test-shots/e2e-02.png) <one-line
   note>`. A 🔴 embeds the shot of the wrong state; a 🟡 embeds nothing and names the missing
   dependency.

The screenshot is not decoration. It is the artifact that lets the person reviewing the component
confirm the test was run and passed, which is exactly why a browse-e2e row can never be marked
🟢 without one.

## Worked example

Journey: track a new channel by handle from the Channels board.

Source route: `src/app/(shell)/channels/page.tsx`, rendering `ChannelsKanban`
(`src/components/channels/kanban-board.tsx`), which renders `AddChannelDialog`
(`src/components/channels/add-channel-dialog.tsx`).

- **Arrive.** Open `/channels`. The board is showing at least one fleet column and the
  Unassigned column.
- **Act.**
  1. Click the "Add channel" trigger, `data-testid="channels-add-channel-trigger"`.
  2. Confirm the dialog opens on the "By handle" tab, `data-testid="add-channel-tab-handle"`.
  3. Type a handle into the Instagram handle field, `data-testid="add-channel-handle-input"`.
  4. Click "Track channel", `data-testid="add-channel-submit-handle"`.
- **Assert visible state.**
  - A success toast reading "{handle} tracked" appears.
  - The dialog closes.
  - The board's tracked count, `data-testid="channels-tracked-count"`, increments by one.
  - A new column or card for the handle appears in the Unassigned bucket,
    `data-testid="channel-card"` (shared across cards; use it to confirm one more exists,
    not to pick out the new one by position, since new cards are not guaranteed to land in a
    predictable order).

These `data-testid` values now exist on `kanban-board.tsx` and `add-channel-dialog.tsx` --
adding them was a prerequisite for scripting this journey at all, not an optional nice to
have, per the data-testid discipline above.

As a browse-e2e case-table row, in the columns `references/test-cases-format.md` defines, this
journey reads:

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 1 | happy | live | Track a new channel by handle from the Channels board | Dev server up, sidecar logged into a burner account, `/channels` open with one fleet and the Unassigned column | Arrive on `/channels`; Act: click `data-testid="channels-add-channel-trigger"`, confirm `data-testid="add-channel-tab-handle"`, type the handle into `data-testid="add-channel-handle-input"`, click `data-testid="add-channel-submit-handle"` | Toast reads "{handle} tracked"; dialog closes; `data-testid="channels-tracked-count"` increments by one; after reload a card persists in the Unassigned bucket (`data-testid="channel-card"`, used for presence or count only) | `scripts/e2e/ig-sync-e2e-01.sh` | blank until run |

The `Mode` here is `live` because the "{handle} tracked" success path needs a real sidecar; the
checked-in `Script` runs the same add-channel form `offline` against the inline error path, as the
next paragraph describes.

The checked-in script closest to this worked example is `scripts/e2e/ig-sync-e2e-01.sh`,
with one deliberate difference: it runs with the Instagram sidecar down and asserts the
inline error path (`add-channel-dialog.tsx`'s `error` Alert, "The Instagram service isn't
running.") instead of the live "{handle} tracked" success path this worked example
describes. A harness that runs `npm run e2e` cannot assume a machine has the sidecar
logged into a real burner Instagram account, so the checked-in journey exercises the part
of this flow that is honestly runnable everywhere: the same add-channel form, the same
submit action, a different, still-real outcome. The live success path stays exactly what
this worked example above says -- run it by hand, or against a machine that does have the
sidecar up, when that path itself needs checking.
