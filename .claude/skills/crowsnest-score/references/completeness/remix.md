# remix completeness

Use this rubric when scoring Completeness for the `remix` surface: the six-stage studio at
`/feed/{videoId}/remix` that turns one analyzed source video into a script in the buyer's
own voice.

## Category scope

- Six stages: prompt, research, hook, style, script, finish, with one resumable session
  per source video.
- Studio shell: the stepper, Back, Restart, Continue controls, the source context rail,
  the run log, and the Quick Remix shortcut.
- Model stages: hook, style, and script call the model through the llm layer; prompt,
  research, and finish make no model call.
- Autosave and run log: each stage autosaves its edits, and every generation attempt,
  success or failure, writes a run-log row.
- Quick Remix: one pass that runs research, hooks (auto-picking the first), outline, then
  variants, landing at the script stage with earlier stages still reachable.
- Failure handling: a failed generation leaves the prior value intact and a logged trace;
  the studio blocks model stages when it infers the proxy is down from recent run-log
  rows.
- Chosen values: chosen hook stored as raw text, chosen variant index null until picked,
  never coerced to a default.

## Completeness questions

- Can a buyer take a source video through all six stages to a script on the plan, and does
  returning resume the existing session?
- Do the studio controls (Back, Restart, Continue, stepper, run log, source rail) all
  work, with furthest stage and active stage kept distinct?
- Do the three model stages call through the llm layer, and do the three non-model stages
  assemble without one?
- Does each stage autosave, and does every generation attempt write a run-log row on both
  success and failure?
- Does Quick Remix run the full sequence in one pass and land at the script stage with
  earlier stages reachable?
- Does a failed generation preserve the prior value and log a trace rather than dead-end?
- Are the three known bugs (research assembly stranding the loading skeleton, a regenerated
  outline leaving stale variants, Quick Remix not blocked when the proxy is down)
  accounted for rather than assumed fixed?

## Evidence

- Workflow: `remix/01-concept-brief.md`, `remix/03-feature-description.md`; the model layer
  in `llm/`, the source analysis in `analyze/`.
- Known gaps: `remix/05-backlog-to-enhance.md`; the `01` status line lists the three open
  bugs above.
- Coverage: `remix/04-test-cases.md`, vitest, browse journeys, `scripts/e2e-coverage.sh`.
