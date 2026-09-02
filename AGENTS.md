<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Skills and plugins

Two local plugins live under `plugins/`, registered by `.claude-plugin/marketplace.json`
as the `crowsnest-local` marketplace and enabled in `.claude/settings.json`:

- `ship` (8 skills): the build-and-ship lifecycle. Invoke as `ship:<name>`, e.g.
  `ship:brainstorming`, `ship:writing-plans`, `ship:subagent-driven-development`,
  `ship:systematic-debugging`, `ship:using-git-worktrees`,
  `ship:verification-before-completion`, `ship:finishing-a-development-branch`,
  `ship:writing-skills`.
- `taste` (9 skills): the design lane, dropped in whenever work touches UI. Invoke as
  `taste:<name>`, e.g. `taste:hallmark`, `taste:apple-design`, `taste:prototype`,
  `taste:pick-ui-library`, `taste:find-animation-opportunities`,
  `taste:improve-animations`, `taste:review-animations`, `taste:animation-vocabulary`,
  `taste:emil-design-eng`.

Always use the namespaced `ship:` / `taste:` form. The old unprefixed and hyphenated
names (`ship-writing-plans`) are gone.

# Component workflow

New or reworked components go through the `/crowsnest-component` skill
(`.claude/skills/crowsnest-component/SKILL.md`): a 5-phase, 4-gate orchestrator that
delegates plan to `ship:writing-plans`, build to `ship:subagent-driven-development`,
and verification to `ship:verification-before-completion`, then wires the five-doc set
into the docs site via `document-component`. Its quality bar is
`.claude/skills/crowsnest-component/house-style.md`.

Bug backlog auto-fix: `scripts/next-bug.sh` pulls the top open `05-backlog` row and the
`/fix-backlog-item` skill fixes it in a worktree (systematic debugging, failing test
first, verification, opens a PR, never self-merges).

# Documentation

Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`,
`docs_dir: documents`). Two layers: `business-requirement/` (what crowsnest is and must
do) and `architect/` (how it is built, one folder per component under `core-components/`
plus cross-cutting `shared/`). Specs and plans go under `documents/planning/`;
`documents/archive/` is frozen and must not be cited as current. `documents/index.md` is
the index. Preview with `mkdocs serve`.

## Writing rule (docs)

Enforced by the doc skills (`house-style.md`, `document-component`), not by hooks:
no em or en dashes, straight quotes only, sentence-case headings, grounded to code with
no invented facts. Docs are evergreen: state the current system as fact, no `Date:`
field, no dated "verified on" framing, no ticket IDs as inline citations. Each component
carries exactly five docs (`01`..`05`); plans live under `documents/planning/`, never a
sixth doc. (The prior humanizer hooks that enforced this are removed; do not re-add them.)

# Build and CI

Before committing: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`
must all pass, and the working tree stays clean. CI on every PR (`.github/workflows/ci.yml`)
runs typecheck, lint, vitest, and `scripts/testid-audit.sh`. Release is
`scripts/release-prep.sh <ver>` then `.github/workflows/release.yml`; the Kit changelog
is `packaging/CHANGELOG.md`.
