---
status: active
owner: goal-2 (opus)
---

# Spec: remove cook/serve/studio, standardize the MCP server

## Problem

The create studio (`/mine/{postId}/studio`) is a brief plus an embedded Claude Code
terminal plus an output rail. Cook (`/ksa:cooking`) and serve (`/ksa:serve`) run inside
it. This duplicates Reel Factory and couples crowsnest to one fragile in-app rendering
flow. The product direction is: crowsnest finds, analyzes, and remixes, then hands off
through its MCP server to Reel Factory, which produces, and the user publishes.

- Before: find + analyze + remix + cook + serve.
- After: find + analyze + remix, then MCP handoff.

## Outcomes

1. All cook/serve/create-studio code, UI, deps, and the terminal websocket are gone. The
   remix studio (`/feed/[id]/remix`) and `/runs` (sync + remix runs) stay.
2. The MCP server is the product's handoff surface: consistent tool contracts (described
   zod schemas, `crowsnest_*` names, structured output, typed errors, pagination on list
   tools) and enough exported data for a self-contained Reel Factory handoff (source media
   file paths on the video and the post brief).
3. The MCP is a documented component (`documents/architect/core-components/mcp/01..05`).
   Studio docs are archived. README, PRODUCT.md, and mkdocs nav no longer sell cook/serve.
4. `/crowsnest-weekly` and `/crowsnest-remix` still work against the MCP end to end.

## Constraints and decisions

- **create_runs data (B-lite, orchestrator-signed):** drop the `create_runs` table via a
  drizzle migration that logs the dropped row count. No backup code (cook-run history is
  transient, dev-local SQLite). Remove the table from `schema.ts`. Note it in
  `packaging/CHANGELOG.md`.
- **`/runs` stays.** It renders sync + remix + create rows today; remove only the create
  branch so it shows sync + remix. Goal 3 enhances `/runs` after this merges.
- **Tool names stay stable.** `/crowsnest-remix` and `/crowsnest-weekly` call `crowsnest_feed`,
  `crowsnest_video`, `crowsnest_remix_*`. Standardization changes output shape, errors, and
  pagination, never a rename.
- **`crowsnest_plans` stays read-only** (Goal 4 owns the plans query and its `state`
  field). Non-narrowing structured-output addition only; ping Goal 4 before any shape change.
- **No plans write tool** (Goal 4 owns writes).
- **MCP surface carries no "studio" word.** Rename `getStudioBrief` -> `getPostBrief` with
  the GitNexus call-graph-aware rename, and retitle the `crowsnest_brief` tool.
- **Coordination edits (link-only, Goal 2 merges first):**
  - `src/components/remix/stage-finish.tsx` (Goal 1 surface, confirmed no wave-2 conflict):
    remove the "Open the studio -> cook" link and copy; remix ends at the planned post.
  - `src/components/mine/plan-dialog.tsx` (Goal 4 surface): remove the "Create in Studio"
    button; repoint to `/mine/[postId]`.
- **Ping panes when the PR merges:** Goal 3 (`/runs` enhancement) and Goal 4/Goal 1 (rebase).

## Non-goals

- Scheduling and publishing (Goal 4). Planned-post writes stay out of the MCP.
- Sync performance and `/runs` enhancement (Goal 3).
- Any remix-flow behavior change beyond removing the studio link.
