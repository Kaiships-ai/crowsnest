---
name: crowsnest-status
description: Use to see the crowsnest lego status at a glance. Prints each component's open backlog count and active plans, plus the list of active plans. Trigger:/crowsnest-status
disable-model-invocation: true
---

# crowsnest-status

One command, the whole board. Answers "which part has bugs, how many, and what is in flight."

## Run it

```bash
scripts/plan-status.sh
```

It reads, live:
- each component's `05-backlog-to-enhance.md` (rows ending in `| open |`)
- `documents/planning/*.md` frontmatter (`status: active` plans, and which `components:` they name)

and prints a board of component, open backlog count, active plans, then the list of active plans.

## Why there is no committed board file

A committed status file would be the one file every parallel session edits at once, so it would
conflict constantly. The board is generated on demand instead. Never create a
`documents/STATUS.md` or similar; run the script.

## When a number looks wrong

- Backlog count off: check the component's `05-backlog-to-enhance.md` for rows whose Status cell
  is not exactly `open`.
- Plan not counted: check its frontmatter has `status: active` and lists the component in
  `components:`.
