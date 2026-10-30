# What this repo is

crowsnest is one Electron app, Lead Studio. Its workspace (terminal, chat, browser tab, split
panes, agents) comes from a one-time copy of Orca and lives at the repo root (`src/main/`,
`src/renderer/`, `src/preload/`, `src/shared/`, `src/cli/`, `config/`). crowsnest's own server
code runs inside the app's main process: `src/server/` (data, jobs, MCP), the parts of
`src/lib/` it uses, `drizzle/` migrations, and the IG sidecar in `services/ig/`. The `kai` CLI
for the packaged Kit is in `src/kai-cli/`. There is no web app and no Next.js.

One toolchain: pnpm and node 24 (`package.json` `engines`). `scripts/heavy.sh` refuses any
other node major and names the fix.

# Skills

General workflow (plan, build, debug, verify, review, PR) runs on pstack: start with
`/poteto-mode`. `.claude/skills/` holds only what pstack does not cover, flat, one directory
per skill, invoked by bare name:

- Code graph: the `gitnexus-*` family.
- Design lane (whenever work touches UI): `hallmark`, `apple-design`, `emil-design-eng`,
  `pick-ui-library`, `shadcn`, `find-animation-opportunities`, `improve-animations`,
  `review-animations`, `animation-vocabulary`.
- `verify`: launch an isolated Lead Studio app, drive it with app journeys, capture evidence.
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
- `scripts/e2e/cases/<part>.md`: each part's built-feature list and test cases.
- Backlog: GitHub issues labelled `backlog` and `area:<part>`, never files.
- `test-shots/` are local and gitignored.
- `docs/` is Orca's engineering notes (`docs/STYLEGUIDE.md`, `docs/reference/`), kept for the
  workspace code they describe.

`documents/index.md` is the index. Preview with `mkdocs serve`.

## Writing rule (docs)

Enforced in review, not by hooks: no em or en dashes, straight quotes only, sentence-case headings, grounded to code with
no invented facts. Docs are evergreen: state the current system as fact, no `Date:`
field, no dated "verified on" framing, no ticket IDs as inline citations. Each part gets one
architecture page and one cases file; no extra per-part docs. Plans live under `documents/plans/`. (The prior humanizer hooks that enforced this are removed; do not re-add them.)

# Build and CI

Locally, prove behavior with the verify skill's journeys on a running app (dev mode,
`APP_DEV=1`), plus at most one test file you wrote (`pnpm test --project <project> <file>`).
`pnpm test`, `test:changed`, `lint` and `typecheck` refuse to run off CI: push the branch and
CI runs them. Nothing merges until CI is green, and the working tree stays clean. `pnpm dev`
opens the app.

- `build` is the Electron app (`electron-vite build`). Packaging (`build:mac` and friends) is
  separate.
- `typecheck` runs Orca's projects and `config/tsconfig.crowsnest.json` (server, lib, kai CLI,
  scripts).
- `lint` is oxlint plus Orca's ratchets. `.oxlintrc.json` keeps correctness rules on
  crowsnest's own code and turns Orca's style rules off there; the code-quality audits skip
  `src/server`, `src/lib` and `src/kai-cli`. `.oxfmtrc.json` keeps oxfmt (and the pre-commit
  hook) off crowsnest's files, which keep their own style.
- `test` runs every vitest project in `config/vitest.config.ts`; crowsnest's tests are the
  `crowsnest` project (`pnpm test --project crowsnest`).

CI on every PR (`.github/workflows/ci.yml`) runs typecheck, lint, the tests the change can
affect (`vitest --changed`, four shards, none for a docs-only change),
`scripts/testid-audit.sh`, `scripts/skill-lint.sh` (validates every `.claude/skills` skill:
name matches folder, closed frontmatter, a description, sane `disable-model-invocation`, no
duplicate names), `scripts/check-migrations.mjs`, `scripts/check-doc-paths.mjs`, and
`scripts/check-verify-coverage.mjs`. The Kit changelog is `packaging/CHANGELOG.md`.

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
| A pull from Graph or the sidecar that is partial or failed is never stored or reported as success | The type: every pull returns `PullResult` (`src/server/lib/pull-result.ts`), and each writer of current numbers (`storeChannelPull` in `sync-engine.ts`, `storePostCapture` and `storeBreakdowns` in `own-measure.ts`) takes `CompletePull`, so passing a partial pull is a compile error |
| Tests never hard-code a date that will pass (a fixed `2026-09-10` turned CI red) | Doc rule: compute it, as `FUTURE_SCHEDULE` in `src/server/actions/planned-post-actions.test.ts` does |
| Find callers with GitNexus `impact`/`context`, not grep alone (plans missed `scripts/live-sync.ts`) | Doc rule; see the GitNexus section |
| Never edit, switch, or build in the operator's own checkout; work in a fresh worktree | Doc rule. The operator's app opens that checkout's `data/crowsnest.db` |
| Heavy jobs (build, test, typecheck, lint) run one at a time per machine, niced, with capped vitest workers, so parallel agents never swap the Mac to a halt | `scripts/heavy.sh` wraps `pnpm run build`, `test`, `typecheck` and `lint`; `config/vitest.config.ts` caps `maxWorkers` at 2 off CI. Call the pnpm scripts, never `electron-vite` or `vitest` directly |
| Test, typecheck and lint run in CI, not on the shared Mac (a lane ran a build, the app and a wide `test:changed` at once and froze a 16 GB Mac; lint alone takes about 2 min and 3.3 GB) | `scripts/heavy.sh` exits 1 on `test`, `test:changed`, `typecheck` and `lint` unless `CI=true`, except a `test` run that names exactly one `*.test.*` file |
| Agents never type a heavy command around `scripts/heavy.sh` (builders ran `tsc --noEmit` directly twice in PR 242) | `scripts/agent-guard.sh`, a PreToolUse hook in `.claude/settings.json`, refuses a direct `tsc`, `vitest`, `oxlint` or `electron-vite build` off CI and names the verify journeys instead |
| One lane app on the Mac at a time (four parallel lane apps pushed the load average to 70) | `app-up.sh` exits 1 when another worktree's dev app runs; the operator's own app does not count |
| Every state a PR shows has an approved prototype, and a proof never calls noise a mismatch (PR 242 showed 4 states with no prototype; PR 244 marked 2.20 s vs 2.27 s as a mismatch) | `proof-page.mjs` adds a failing check for each state without a prototype and compares a number within its `tolerancePct` |
| Every command runs under node 24 (Orca's native modules fail under 22, the Mac's default) | `scripts/heavy.sh` exits with the PATH fix when `node` is another major |
| No Orca style rewrite of crowsnest code (the first pre-commit hook run reformatted the verify scripts) | `.oxfmtrc.json` `ignorePatterns` |
| A commit adds no unlocalized renderer string (11 of 300 commits fixed one after CI caught it) | `.husky/pre-commit` runs `config/scripts/check-staged-localization.mjs` on staged `src/renderer/src` files, under the same allowlist as CI. Catalog and extraction failures still only show in CI |
| A PR that changes `src/renderer/` or `src/server/` adds or updates a verify feature file, not just `features/README.md`, and its app journey (G-03) | `scripts/check-verify-coverage.mjs` in CI |
| Test runs cover only what changed (a full Orca run took 23 min locally and about 90 min on one CI runner) | `ci.yml` runs `vitest --changed` in four shards and no tests for a docs-only change; nothing runs the full suite. Tiers in `.agents/playbooks/lead-studio-v1.md` |
| A verify run never changes the installed Orca.app's hooks (PR-M1 overwrote `~/.claude/settings.json`) | `app-down.sh` fails with `app: HOST CHANGED` |

# Workspace code (from Orca)

These rules come from Orca and still hold for `src/main/`, `src/renderer/`, `src/preload/`,
`src/shared/` and `src/cli/`.

- UI follows `DESIGN.md` first, then `docs/STYLEGUIDE.md`. Use the tokens in
  `src/renderer/src/assets/main.css` and the shadcn primitives in
  `src/renderer/src/components/ui/`; do not invent colors, font sizes, or shadow tiers.
- Run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`. Never
  steal focus or reveal test windows; use CDP screenshots of hidden renderers.
  `tests/AGENTS.md` has the launch rules for e2e helpers.
- Reuse before reimplementing: check for an existing function, IPC channel, store, or flow
  first and extend it.
- Name files after what they contain, never `helpers`, `utils`, `common`, or `misc`.
- Avoid type assertions except `as const`; an unavoidable cast carries a `SAFETY:` comment.
- Guard platform-specific behavior at runtime. Before changing processes, shells, paths, or
  native modules, read `docs/reference/cross-platform-support.md`.
- Consider folder workspaces as well as git worktrees.
- Code around `git`, `gh`, or source control: read `docs/reference/git-workflow.md`.
- Avoid low-value tests (`docs/reference/test-antipatterns.md`).

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
