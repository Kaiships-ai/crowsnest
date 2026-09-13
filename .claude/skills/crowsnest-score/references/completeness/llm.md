# llm completeness

Use this rubric when scoring Completeness for the `llm` surface: the single client layer
every in-app AI feature goes through to reach a language model, with a native Anthropic
path and a proxy-compatible path picked at runtime.

## Category scope

- One client interface: `generateText`, `generateParsed`, and `ping`, with two
  implementations chosen by whether the proxy base URL is set.
- Native path: the real Anthropic API with native structured output.
- Compat path: an OpenAI-compatible local router in front, falling back to prompt-asked
  JSON with one-retry-then-fail parsing.
- Key resolution and errors: the secret store resolves the key database-first with an
  environment fallback; a missing key throws a distinct configuration error before any
  request, separate from a connection failure after a real attempt.
- Model selection: the configured model with a default when unset.
- Health probe: a real one-word generation alongside ping, classified up, reachable but
  unverified, or down.
- Graceful degrade: the rest of the app degrades around a missing or unreachable model
  instead of failing.

## Completeness questions

- Does one interface serve every caller, with the native or compat implementation chosen
  at runtime and callers never coupled to which they got?
- Does the native path use structured output and the compat path fall back to prompt-asked
  JSON, both with the same retry-then-fail behavior?
- Is a missing key thrown as a configuration error before any network call, distinct from
  a post-attempt connection failure?
- Does a key set in Settings take effect on the next call without a server restart?
- Does the model default correctly when unset, and is the model named consistently across
  text, structured, and ping calls?
- Does the generation probe classify up, reachable but unverified, and down correctly,
  rather than trusting ping alone?
- Do dependent surfaces degrade gracefully when the model is missing or unreachable?
- Is the no-proxy path (a real Kit install talking straight to Anthropic) proven to
  complete a live generation end to end, or is it still unproven?

## Evidence

- Workflow: `llm/01-concept-brief.md`, `llm/03-feature-description.md`;
  `documents/architect/shared/external-services.md`, `shared/status-and-failures.md`.
- Known gaps: `llm/05-backlog-to-enhance.md`; the `01` status line flags the no-proxy live
  path as unproven end to end.
- Coverage: `llm/04-test-cases.md`, vitest, `scripts/e2e-coverage.sh`.
