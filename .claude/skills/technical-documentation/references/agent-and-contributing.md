# Agent and governance principles

This reference consolidates the core rules for agent-policy and contributor-governance
docs. In crowsnest the governance files are `AGENTS.md` (canonical) and `CLAUDE.md` (the
alias, which opens with `@AGENTS.md`). There is no separate `CONTRIBUTING.md` today; if the
repo adopts one, apply the CONTRIBUTING guidance below to it.

You must:

1. Discover repo-level and nested instruction files with:
   `rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g 'AGENTS.*.md' -g '.claude/**'`
2. Read the root and nearest-scope `AGENTS.md`/`CLAUDE.md` pair before editing.
3. Normalize to one canonical source (`AGENTS.md`), with `CLAUDE.md` as a compatibility
   alias that includes it rather than restating it.
4. Document conflicting instructions and precedence decisions.

## GitHub + AGENTS baseline

Source: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors
Source: https://agents.md/
Source: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/

Use these as default operating principles:

1. Keep contributor guidance discoverable and actionable (root or `documents/`).
2. Keep agent instructions concrete: real commands, real paths, clear boundaries.
3. Use explicit behavior boundaries for agents: `Always`, `Ask first`, `Never`.
4. Keep contributor and agent rules aligned with actual repository workflows.
5. Give agents clear guidance on if, when, and how to raise issues and pull requests.

## Canonical and alias policy

Source: https://agents.md/
Source: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/

1. Treat `AGENTS.md` as canonical.
2. Keep `CLAUDE.md` as a compatibility surface that includes `AGENTS.md` (`@AGENTS.md`) and
   adds only Claude-specific guidance on top.
3. Keep policy DRY: store one shared policy core in `AGENTS.md` and expose it through the
   alias instead of duplicating rule text.
4. Document how any additional alias maps back to canonical policy.

## Context-awareness by agent platform

Source: https://github.com/openai/codex/blob/main/AGENTS.md

1. Keep rule files narrow and bounded; skills live flat under `.claude/skills/`, one
   directory per skill, invoked by bare name.
2. Avoid over-referencing large path sets that inflate context.
3. Prefer explicit file references and deterministic commands.
4. Keep long runbooks outside top-level policy files; link to scoped docs under
   `documents/`.
5. Ensure a happy path exists regardless of which coding agent runs the task.

## Dual-mode and deliverable standards

1. Author one shared policy core (same commands, boundaries, and precedence) in
   `AGENTS.md`.
2. Expose that core through `CLAUDE.md` via `@AGENTS.md`, not by copying the text.
3. Where styles diverge, prefer the smallest common structure and avoid duplicating policy
   text.
4. Treat `AGENTS.md` and `CLAUDE.md` as first-class deliverables when in scope.
5. Preserve required structure, constraints, and examples from existing files.
6. Align wording and commands with active repository instructions
   (`npm run build/test/lint/typecheck`).

## Proactive issue discovery and remediation

1. Run a conflict-matrix review across `AGENTS.md`, `CLAUDE.md`, and related skill/command
   docs before finalizing.
2. Treat these as high-priority defects: missing referenced files, non-existent setup
   commands, command scope mismatches (for example `pnpm` where the repo uses `npm`), and
   branch/commit policy conflicts.
3. Do not stop at caveat-only notes when a low-risk fix is clear; apply the fix in the same
   pass.
4. If a canonical entry file is missing (for example a directory README that docs depend
   on), create a minimal actionable file and update references.
5. Long-running investigations are acceptable when needed to uncover cross-file drift,
   especially in agent-instruction ecosystems.

## Discovery

1. Agents prefer simple terminal commands, so a well-defined `npm run *` set is ideal.
2. Agents can discover terminal commands through shell completion, so providing shell
   completion helps.

## CONTRIBUTING size and scope control

Source: https://contributing.md/how-to-build-contributing-md/

Apply this only if crowsnest adopts a `CONTRIBUTING.md`:

1. Keep a root contributor guide focused on setup, issue flow, PR flow, testing, and
   review gates.
2. Use issue/PR template links instead of embedding every process detail inline.
3. When the file grows too large, split by domain and link from root.
4. Move large content into `documents/` to avoid a bloated contributor guide.
5. Optimize for agent/machine readability as well as humans.

## Example repos to emulate

Source: https://github.com/openai/codex/blob/main/AGENTS.md
Source: https://github.com/processing/p5.js/blob/main/AGENTS.md
Source: https://github.com/agentsmd/agents.md/blob/main/AGENTS.md
Source: https://github.com/rails/rails/blob/main/CONTRIBUTING.md
Source: https://github.com/kubernetes/kubernetes/blob/master/CONTRIBUTING.md

1. OpenAI Codex: strict command discipline and explicit scope control.
2. p5.js: explicit AI-policy guardrails in agent instructions.
3. agents.md spec: compact, context-efficient AGENTS patterns.
4. Rails/Kubernetes: contributor guidance patterns at different project scales.

## Practical merge policy

When these rules conflict:

1. Preserve contributor and reader task success first.
2. Preserve instruction clarity and unambiguous boundaries second.
3. Preserve long-term maintainability and context-efficiency third.
4. Add extra agent optimization only if it does not reduce human clarity or there is an
   explicit need.
5. Use your judgment as the expert.
