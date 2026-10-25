<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Skills

General workflow (plan, build, debug, verify, review, PR) runs on pstack: start with
`/poteto-mode`. `.claude/skills/` holds only what pstack does not cover, flat, one directory
per skill, invoked by bare name:

- Code graph: the `gitnexus-*` family.
- Design lane (whenever work touches UI): `hallmark`, `apple-design`, `emil-design-eng`,
  `pick-ui-library`, `shadcn`, `find-animation-opportunities`, `improve-animations`,
  `review-animations`, `animation-vocabulary`.
- `verify`: launch an isolated app on :3001, drive it, capture evidence.
- `proof-video` (UI proof recordings) and `product-description`.

# Documentation

Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`,
`docs_dir: documents`). Where things live:

- `PRODUCT.md` and `DESIGN.md` at the repo root: what crowsnest is and must do; the visual
  system, interaction model, and shell.
- `documents/architecture/`: how it is built. `overview.md` plus one page per part, each with
  the data it holds, its boundaries, and its invariants.
- `documents/decisions/`: big decisions still in force.
- `documents/plans/`: running plans only. Delete a plan when it ships; git history keeps it.
- `scripts/e2e/cases/<part>.md`: each part's built-feature list and browse-e2e test cases.
- Backlog: GitHub issues labelled `backlog` and `area:<part>`, never files.
- `test-shots/` are local and gitignored.

`documents/index.md` is the index. Preview with `mkdocs serve`.

## Writing rule (docs)

Enforced in review, not by hooks: no em or en dashes, straight quotes only, sentence-case headings, grounded to code with
no invented facts. Docs are evergreen: state the current system as fact, no `Date:`
field, no dated "verified on" framing, no ticket IDs as inline citations. Each part gets one
architecture page and one cases file; no extra per-part docs. Plans live under `documents/plans/`. (The prior humanizer hooks that enforced this are removed; do not re-add them.)

# Build and CI

Before committing: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`
must all pass, and the working tree stays clean. CI on every PR (`.github/workflows/ci.yml`)
runs typecheck, lint, vitest, `scripts/testid-audit.sh`, and `scripts/skill-lint.sh`
(validates every `.claude/skills` skill: name matches folder, closed frontmatter, a
description, sane `disable-model-invocation`, no duplicate names). Release is
`scripts/release-prep.sh <ver>` then `.github/workflows/release.yml`; the Kit changelog
is `packaging/CHANGELOG.md`.

# Rules and what enforces them

Each rule here comes from a mistake agents made at least twice. Prefer the enforcement over
the prose: when a rule has a check, the check is the source of truth. When Kai corrects an
agent, fix the mistake and add or tighten the row; a row with no enforcement that gets
broken again needs a check, not more words.

| Rule | Enforced by |
| --- | --- |
| Every skill in `.claude/skills` is valid (name, frontmatter, description, unique) | `scripts/skill-lint.sh` in CI |
| Every `drizzle/*.sql` has a unique number and a journal entry (parallel PRs both took 0024) | `scripts/check-migrations.mjs` in CI |
| Docs and agent files cite only files that exist (deletes and moves left dead citations) | `scripts/check-doc-paths.mjs` in CI; old debt in `scripts/doc-paths.baseline`, only new dead citations fail |
| UI elements journeys drive carry a `data-testid` | `scripts/testid-audit.sh` in CI |
| Graph API calls are counted against the hour's budget in one place | Architecture: `graphRequest` is private to `src/server/graph/client.ts`, so no other module can call Graph |
| A Graph result that is partial or failed is never stored or reported as success | Not enforced yet (doc rule). The most repeated mistake in `fix(mine)`/`fix(graph)` history; it needs result types that make a partial batch unwritable |
| Tests never hard-code a date that will pass (a fixed `2026-09-10` turned CI red) | Doc rule: compute it, as `FUTURE_SCHEDULE` in `src/server/actions/planned-post-actions.test.ts` does |
| Find callers with GitNexus `impact`/`context`, not grep alone (plans missed `scripts/live-sync.ts`) | Doc rule; see the GitNexus section |
| Never edit, switch, or build in the operator's own checkout; work in a fresh worktree | Doc rule. Its dev server on :3000 serves whatever that checkout has |
| Heavy jobs (build, test, typecheck, lint) run one at a time per machine, niced, with capped vitest workers, so parallel agents never swap the Mac to a halt | `scripts/heavy.sh` wraps `npm run build`, `test`, `typecheck` and `lint`; `vitest.config.ts` caps `maxWorkers`. Call the npm scripts, never `next build` or `vitest` directly |
| A PR that changes `studio/src/renderer/` or `src/server/` adds or updates its verify feature and app journey (G-03) | `scripts/check-verify-coverage.mjs` in CI |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **crowsnest**.

> Index stale? `node .gitnexus/run.cjs status` shows the indexed commit; `node .gitnexus/run.cjs analyze` refreshes it from the project root. No `.gitnexus/run.cjs` yet? Bootstrap with `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939). `.gitnexusrc` sets `skipAgentsMd` and `skipSkills`, so `analyze` only rebuilds the index and never rewrites AGENTS.md, CLAUDE.md, or `.claude/skills`. This block is maintained by hand.

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
