# Architecture decision: Crowsnest is the data and action brain

## Decision

Crowsnest is the data and action brain. The reasoning brain is an external agent (Claude,
Codex, or another MCP client), never a model embedded in Crowsnest. The core content
workflow does not depend on an internal Anthropic API key.

## Context

Crowsnest holds the source of truth for social data (channels, posts, outliers,
transcripts, metrics, media), for workflow state, and for content artifacts. The valuable,
defensible part is that data and the deterministic actions over it (sync, score, persist),
not a model call anyone can make directly against an LLM provider. Bundling an internal
model would put Crowsnest in competition with the very agents a buyer already pays for, and
would make the core flow fail whenever an API key is missing or a proxy is down.

## What this means concretely

- Every core operation is exposed as an MCP tool (see `mcp-tool-reference.md`) or a clear
  executable bootstrap. The full content machine runs over MCP plus the agent's own
  reasoning: fresh sync, inspect outliers and transcripts and metrics, analyze, persist
  analysis and artifacts, generate angles and an idea bank and a monthly plan and briefs,
  remix to a draft post.
- The generate stages are keyless. The remix hooks, outline, and variants tools return an
  assembled `{ system, user, context }` prompt; the calling agent writes the result and
  reports it back (`crowsnest_remix_choose_hook`, `crowsnest_remix_save_script`). Crowsnest
  assembles context and persists output; it does not call a model to produce that output.
- Agent-authored output is persisted with provenance. `crowsnest_save_analysis` and
  `crowsnest_save_artifact` stamp who reasoned (agent), the model, the source video ids,
  and the assumptions, so a later reader knows where an artifact came from.
- The internal-model analyze and auto-analyze paths were retired from the normal path. The
  one remaining internal-model generator is the in-app dashboard idea button, an optional
  convenience gated on an optional key; it is not on the MCP core path, and the keyless MCP
  idea bank (`crowsnest_save_artifact` with kind `idea_bank`) replaces it for the content
  machine. An internal model is kept only where it adds buyer value without making the core
  flow depend on a key.

## Consequences

- A buyer can run the entire content machine with only their own agent and no Crowsnest
  API key. The optional `ANTHROPIC_API_KEY` in `kai kit init` enables in-app AI analysis
  and the in-app Vault pipeline only, never the MCP core flow.
- The MCP surface is the product surface. The app UI reads and writes through the same
  services and queries the MCP tools use (`src/server/queries`, `src/server/services`,
  `src/server/actions`), so there is one contract, not two.
- New reasoning capability is added by improving what Crowsnest exposes and persists, not
  by adding model calls inside Crowsnest.
