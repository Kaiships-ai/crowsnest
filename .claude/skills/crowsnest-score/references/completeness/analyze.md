# analyze completeness

Use this rubric when scoring Completeness for the `analyze` surface: a video's stored
analysis (hook, structure, tags, why) plus Generate idea, both authored by an external
agent through MCP rather than by an in-app model call.

## Category scope

- Analysis authoring: agent writes an analysis through the MCP save path, validated
  against the analysis schema, upserting one row per video, stamped as agent-authored.
- Grounding read: the agent can read a video's caption, metrics, full transcript, and
  any existing analysis in one call before authoring.
- Rendering: the video detail page shows hook and structure, why it worked, and a clear
  "no analysis yet" state when none exists.
- Generate idea: turns one analyzed video plus the creator persona into a single idea in
  the ideas inbox, capped at one active idea per video.
- Ideas pass: the batch that turns already-analyzed outliers into ideas, capped and
  threshold-gated, never throwing on a single bad candidate.

## Completeness questions

- Can an external agent author and save an analysis end to end, with the payload
  validated and one row per video enforced?
- Does the grounding read return everything an agent needs (caption, metrics, transcript,
  existing analysis) in a single call?
- Does the detail page render an existing analysis and show an explicit empty state when
  none exists, with no phantom button or key check?
- Does Generate idea produce a grounded idea and respect the one-active-idea-per-video
  cap?
- Does the batch ideas pass stay bounded and non-throwing when a candidate is bad?
- Is the text analysis kept separate from the layout or frame pass so one does not
  overwrite the other?
- Is a real Generate idea call with a live key proven end to end on a Kit install, or is
  that path still unproven?

## Evidence

- Workflow: `analyze/01-concept-brief.md`, `analyze/03-feature-description.md`.
- Known gaps: `analyze/05-backlog-to-enhance.md`; the `01` status line flags the live
  Generate idea path as not proven end to end.
- Coverage: `analyze/04-test-cases.md`, vitest, `scripts/e2e-coverage.sh`.
