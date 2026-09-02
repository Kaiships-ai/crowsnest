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

Treat `browse` as a QA tool you run interactively or from a script during a work session,
not as a persisted spec file checked into the repo. The lasting artifact of a browse-e2e
run is the case table in `04-test-cases.md` plus whatever the running skill reports back,
not a `.spec.ts` file.

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

None of these `data-testid` values exist in the current markup. Adding them to
`kanban-board.tsx` and `add-channel-dialog.tsx` is a prerequisite for scripting this journey,
not an optional nice-to-have, per the data-testid discipline above.
