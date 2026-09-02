---
name: document-component
description: Use when creating or updating a crowsnest component's docs. Scaffolds or edits the five-doc lego block under documents/architect/core-components and wires it into the index. Trigger:/document-component
disable-model-invocation: true
---

# document-component

Every crowsnest component is a lego block with EXACTLY five docs. This skill keeps that
invariant and the index in sync.

## The five docs (never more, never fewer)

```
documents/architect/core-components/<name>/
  01-concept-brief.md        what it is, why it exists, its boundaries
  02-architecture.md         key files, data flow, decisions
  03-feature-description.md  user-facing behavior (feeds site + user guide + MCP)
  04-test-cases.md           what proves it works, end to end
  05-backlog-to-enhance.md   bugs and enhancements, one table
```

## Create a new component

1. Pick a short kebab-case name. Confirm it is a real seam, not a feature of an existing block.
2. Create the folder and the five files. Each starts with a heading and one line of intent.
   `05-backlog-to-enhance.md` starts with the table header and "No open items."
3. Add a row to the component table in `documents/index.md` and a nav entry in
   `mkdocs.yml` under Components.
4. Do not add a sixth file. Plans go in `documents/planning/`, not here.

## Update an existing component

- New behavior: edit `03-feature-description.md`.
- New design or a decision: edit `02-architecture.md`.
- A confirmed bug or a wanted enhancement: add a row to `05-backlog-to-enhance.md` (columns:
  ID, Title, Severity, Type, Source, Status). Set Status to `open`. `scripts/plan-status.sh`
  counts rows ending in `| open |`.
- A test that now exists: record it in `04-test-cases.md`.

## Backlog row format

```
| ID | Title | Severity | Type | Source | Status |
| B-01 | one line | high | bug | bug-triage | open |
```

Close an item by changing its Status cell from `open` to `done` (leave the row as history), or
by removing the row. The board reads Status, not presence.

## Writing rules

Component docs are prose. Follow the repo writing rules: no em or en dashes, straight quotes,
sentence-case headings, no invented facts.
