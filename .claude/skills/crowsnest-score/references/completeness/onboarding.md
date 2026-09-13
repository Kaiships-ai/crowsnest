# onboarding completeness

Use this rubric when scoring Completeness for the `onboarding` surface: everything between
`kai up` opening a browser and the user reaching a working feed, in two halves joined by
`.env.local` and the first-run-completed flag.

## Category scope

- Terminal half: `kai kit init` writes `.env.local`, prompts for the Instagram account
  (masked password) and an optional Anthropic key, generates the sidecar secret, asks for
  the vault location, creates the database, and hands off to `kai up`.
- In-app half: the five-screen `/first-run` flow (welcome, focus, connect, sources, first
  sync) served outside the app shell.
- First-run gate: a database with no channels and the flag unset is routed to first-run
  before any other page; once a channel exists or the flag is set, never again.
- Connect step: the one real credential screen, validating an Instagram login against a
  real sidecar (including two-factor and challenge) before saving.
- Credential correctness: paired Instagram username and password saved together, no
  plaintext key echo, and the packaged sidecar's launchd job carrying the credentials into
  its own environment.
- Settings panels: the Instagram connection panel and the local-binaries status list
  after onboarding.

## Completeness questions

- Does `kai kit init` capture all required credentials with a masked password, create the
  database, and hand off to `kai up`, requiring a cached license?
- Does the five-screen first-run flow complete from welcome to first sync?
- Does the first-run gate route only a genuinely empty, unflagged install to the wizard,
  and never route a real database back into it?
- Does the connect step validate an Instagram login against a real sidecar, including the
  two-factor and challenge branches, before saving anything?
- Are the credential-entry defects (empty password, plaintext key echo) fixed, and are
  the credentials carried into the packaged sidecar's environment?
- Do AI features fall back to calling Anthropic directly when a valid key is set but the
  local proxy is not running?
- Are the post-onboarding Settings panels (Instagram reconnect, local binaries check)
  present and correct?

## Evidence

- Workflow: `onboarding/01-concept-brief.md`, `onboarding/03-feature-description.md`;
  `ig-sync/` for the sidecar login, `llm/` for the key fallback.
- Known gaps: `onboarding/05-backlog-to-enhance.md`; note the `01` status line records the
  earlier secret-prompt defects as fixed.
- Coverage: `onboarding/04-test-cases.md`, vitest, browse journeys,
  `scripts/e2e-coverage.sh`.
