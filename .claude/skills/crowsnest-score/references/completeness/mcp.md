# mcp completeness

Use this rubric when scoring Completeness for the `mcp` surface: the in-process Model
Context Protocol server at `/api/mcp` that exposes the app's data and remix pipeline as
tools, and carries the handoff from crowsnest to the producer that renders the reel.

## Category scope

- Tool surface: the registered `crowsnest_*` tools spanning read, remix, monthly and
  weekly planning, content artifacts, and on-demand transcription, each a thin wrapper
  over a query or service the dashboard already uses.
- Result contract: every handler returns a consistent result or error result, JSON text
  and structured content always agreeing, errors carried as machine-readable payloads
  rather than thrown across the boundary.
- Media handoff: for a video or brief, the stored asset's on-disk path, byte size, and
  duration returned so the producer opens a local file, not an expiring URL.
- In-process single-writer: mounted in the app's own process over the one SQLite
  connection, never becoming a second writer.
- Transport: a fresh server and transport per request, torn down on response close.

## Completeness questions

- Are the full documented tool set registered and reachable at the endpoint, each backed
  by the same query or service the UI uses?
- Does every tool return through the shared result or error-result contract, with text and
  structured content agreeing and errors returned rather than thrown?
- Does the media handoff return a real local path, size, and duration, and null cleanly
  when an asset is missing rather than erroring?
- Does the server stay in-process over the single connection, so it never races the app's
  own writes?
- Does the stateless per-request transport set up and tear down cleanly?
- Can an MCP client drive a remix from research through to a saved script through the tool
  surface, matching the UI's pipeline?
- Is the tool reference documentation in sync with the registered tools?

## Evidence

- Workflow: `mcp/01-concept-brief.md`, `mcp/03-feature-description.md`;
  `documents/architect/shared/mcp-tool-reference.md`, `shared/data-action-brain.md`.
- Known gaps: `mcp/05-backlog-to-enhance.md`.
- Coverage: `mcp/04-test-cases.md`, vitest, `scripts/e2e-coverage.sh`.
