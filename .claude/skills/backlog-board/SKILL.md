---
name: backlog-board
description: Use when adding, closing, or reviewing bug and enhancement items in a crowsnest component's backlog. Keeps 05-backlog-to-enhance.md tables consistent so the generated board stays accurate. Trigger:/backlog-board
disable-model-invocation: true
---

# backlog-board

Each component owns its bugs and enhancements in `05-backlog-to-enhance.md`. This skill keeps
those tables in the one shape the board script counts.

## The table

```
| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ONB-1 | one line | blocker | bug | live test | open |
```

- ID: short and stable (B-01, ONB-1, ENH-1).
- Severity: blocker | high | medium | low.
- Type: bug | enhancement.
- Source: where it was found (bug-triage, observed-bugs, a live test, a session).
- Status: `open` or `done`. The board counts rows ending in `| open |`.

## Add an item

1. Find the owning component (`documents/architect/core-components/<name>/`). A cross-cutting
   item with no single owner goes in `documents/architect/shared/backlog-to-enhance.md`.
2. Append a row with Status `open`.
3. If you are about to start work on it, write a plan with the `writing-plans` skill and set the
   plan's `backlog:` field to `<component>#<id>`, then link the plan from the row.

## Close an item

Change its Status cell to `done` (keep the row as history) when the fix has shipped. Confirm the
board reflects it: `scripts/plan-status.sh`.

## Do not

- Do not keep a second, aggregated bug list. The per-component tables plus the script are the
  single source. A rolled-up committed file would go stale and conflict across sessions.
