<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Skills

All skills live flat under `.claude/skills/`, one directory per skill, invoked by their
bare name (no plugin, no `ship:` / `taste:` prefix). Product skills carry a `crowsnest-`
prefix; generic and vendor skills keep plain names (the `gitnexus-*` family stays as is).

- Build-and-ship lifecycle: `brainstorming`, `writing-plans`,
  `subagent-driven-development`, `systematic-debugging`, `using-git-worktrees`,
  `verification-before-completion`, `finishing-a-development-branch`, `writing-skills`.
- Design lane (whenever work touches UI): `hallmark`, `apple-design`, `prototype`,
  `pick-ui-library`, `find-animation-opportunities`, `improve-animations`,
  `review-animations`, `animation-vocabulary`, `emil-design-eng`.

# Component workflow

New or reworked components go through the `/crowsnest-component` skill
(`.claude/skills/crowsnest-component/SKILL.md`): a 5-phase, 4-gate orchestrator that
delegates plan to `writing-plans`, build to `subagent-driven-development`,
and verification to `verification-before-completion`, then wires the five-doc set
into the docs site via `crowsnest-document-component`. Its quality bar is
`.claude/skills/crowsnest-component/house-style.md`.

Bug backlog auto-fix: `scripts/next-bug.sh` pulls the top open `05-backlog` row and the
`/crowsnest-fix-backlog-item` skill fixes it in a worktree (systematic debugging, failing test
first, verification, opens a PR, never self-merges).

# Documentation

Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`,
`docs_dir: documents`). Two layers: `business-requirement/` (what crowsnest is and must
do) and `architect/` (how it is built, one folder per component under `core-components/`
plus cross-cutting `shared/`). Specs and plans go under `documents/planning/`;
`documents/archive/` is frozen and must not be cited as current. `documents/index.md` is
the index. Preview with `mkdocs serve`.

## Writing rule (docs)

Enforced by the doc skills (`house-style.md`, `crowsnest-document-component`), not by hooks:
no em or en dashes, straight quotes only, sentence-case headings, grounded to code with
no invented facts. Docs are evergreen: state the current system as fact, no `Date:`
field, no dated "verified on" framing, no ticket IDs as inline citations. Each component
carries exactly five docs (`01`..`05`); plans live under `documents/planning/`, never a
sixth doc. (The prior humanizer hooks that enforced this are removed; do not re-add them.)

# Build and CI

Before committing: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`
must all pass, and the working tree stays clean. CI on every PR (`.github/workflows/ci.yml`)
runs typecheck, lint, vitest, `scripts/testid-audit.sh`, and `scripts/skill-lint.sh`
(validates every `.claude/skills` skill: name matches folder, closed frontmatter, a
description, sane `disable-model-invocation`, no duplicate names). Release is
`scripts/release-prep.sh <ver>` then `.github/workflows/release.yml`; the Kit changelog
is `packaging/CHANGELOG.md`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **crowsnest** (14148 symbols, 27770 relationships, 664 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/crowsnest/context` | Codebase overview, check index freshness |
| `gitnexus://repo/crowsnest/clusters` | All functional areas |
| `gitnexus://repo/crowsnest/processes` | All execution flows |
| `gitnexus://repo/crowsnest/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
