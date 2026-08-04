@AGENTS.md

# Humanizer exemption for implementation plans

Files under `docs/superpowers/plans/` skip the humanizer doc check
(`.claude/hooks/humanizer-doc-check.sh`).

Why: a plan is mostly fenced code quoted verbatim out of this codebase. The hook greps
the whole file instead of parsing fences, so it fires on dashes that live inside code we
did not write and must not alter. One example is the `{row.value ?? "-"}` fallback in
`layout-section.tsx`, where the real character is an em dash and changing it would change
the rendered UI.

Prose docs stay enforced. This exemption covers the plans directory only, not specs, not
READMEs, not anything else. Write the prose parts of a plan to the same standard anyway.
