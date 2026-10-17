# 0002: Crowsnest is the data and action brain

## Context

Crowsnest holds the source of truth for social data (channels, posts, outliers, transcripts, metrics, media), for workflow state and for content artifacts. The defensible part is that data and the deterministic actions over it (sync, score, persist), not a model call anyone can make against a provider. Bundling a model would put crowsnest in competition with the agents a buyer already pays for, and would make the core flow fail whenever a key is missing or a proxy is down.

## Decision

Crowsnest is the data and action brain. The reasoning brain is an external agent (Claude, Codex or another MCP client), never a model embedded in crowsnest. The core content workflow does not depend on an internal Anthropic API key.

- Every core operation is an MCP tool served in-process at `/api/mcp` (`src/server/mcp/mcp-server.ts`): sync, inspect, save analysis, save artifacts, remix to a draft post.
- Generate steps are keyless. The remix hooks, outline and variants tools return an assembled `{ system, user, context }` prompt; the agent writes the result and reports it back with `crowsnest_remix_choose_hook` or `crowsnest_remix_save_script`. Crowsnest assembles context and persists output.
- Agent output is stored with provenance. `crowsnest_save_analysis` and `crowsnest_save_artifact` record the agent, model, source video ids and assumptions (`content_artifacts`, `video_analyses`).
- Crowsnest holds no model key and makes no model calls. In-app analysis, remix generation and Generate idea were retired; analysis, hooks, outlines, scripts and ideas are authored only through MCP.

## Consequences

- A buyer can run the whole content machine with only their own agent. There is no model key to set.
- The MCP surface is the product surface. The UI and the tools call the same queries, services and actions (`src/server/queries`, `src/server/services`, `src/server/actions`), so there is one contract, not two.
- New reasoning capability comes from improving what crowsnest exposes and persists, not from adding model calls inside it.
- Tests pin the keyless path (`src/server/mcp/mcp-remix-keyless.test.ts`).
