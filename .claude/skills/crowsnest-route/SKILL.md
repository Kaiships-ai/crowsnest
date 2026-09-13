---
name: crowsnest-route
description: Daily FAST vs CAREFUL router for crowsnest. Reads a request, picks a track against a Next.js danger list, and prints a runnable stage to skill launch sequence. Owns the TDD track that crowsnest-testing reads. Routes only, does not build. Trigger:/crowsnest-route
---

# crowsnest-route, the FAST vs CAREFUL router

You ROUTE, you do not build. Read the request, pick a track, print a short scannable verdict block. That is it.

This skill owns the test track. `crowsnest-testing` reads the track you set here: FAST means the lightest meaningful check, CAREFUL means full failing-test-first coverage, a bug fix is always red-first.

## When triggered

1. Parse the request (everything after `/crowsnest-route`).
2. Scan it against the danger list below.
3. If risk is ambiguous, ask ONE clarifying question, then route. Otherwise route immediately.
4. Print the verdict block. Keep it short, this is a daily quick call, not an essay.

## Decision rule (the core)

Default to FAST. Switch to CAREFUL only if the request touches the danger list. No hit means FAST, which is about 80 percent of the work.

### Danger list (any hit means CAREFUL)

- **auth / RBAC** - login, sessions, tokens, permissions, roles, OAuth, anything under the auth layer.
- **money** - Stripe, billing, payments, pricing, credits, subscriptions, the Kit license or Polar checkout.
- **DB migration / schema** - a new column or table, a drizzle migration up or down, an index change (`npm run db:generate` / `db:migrate`).
- **middleware + server action** - a change to `middleware.ts`, a Next server action, or the request boundary they guard.
- **API route contract** - the request or response shape of an app-router route handler, an MCP `crowsnest_*` tool contract, or a webhook.
- **providers** - an LLM provider through 9router (adapters, model registry, SSE) or a channel/integration provider (a new Instagram or channel surface, OAuth, API keys and creds).
- **multiple surfaces at once** - web app plus MCP tools plus the Kit CLI together, or app-router plus edge plus client in one change.

No danger-list hit means FAST.

## Output format, a runnable launch sequence

Print a checklist run top to bottom. Every step names the EXACT thing to trigger, a `/skill`, an MCP tool, or a shell command, filled in for THIS request with real file names, real symbols, real test paths. Never copy the examples, reason the plan from the actual request.

```
🎯 <restate the request in one line>
Track: FAST | CAREFUL - <why: name the real danger triggers, or "no danger hit">

Steps (run in order):
☐ <n> <Stage> → `<exact command / skill>` - <what to do for THIS request, 1 line>
   …only the stages that actually apply…
Skip: <stage numbers> - <one-line why for THIS request>
[CAREFUL only] Guard: <the specific non-negotiables that apply, e.g. drizzle migration up/down, tenant/user scope on the query, route-contract test>

▶ Start now: `<the very first command to type>`
```

### How to tailor it (reason per request, do not copy the example)

- Estimate the files and surfaces the request implies. Two files or fewer AND no cross-package call means skip stage 3 (Plan) and stage 5 (seam test). Any signal or data crossing a package or route boundary means KEEP stage 5 and name the seam.
- Fill every `` `command` `` with the real trigger: `impact({target:"<symbol>"})`, `npm run test src/<path>`, `/spec <topic>`, `gh pr create`.
- FAST drops the heavy skills. CAREFUL includes `/spec`, `writing-plans`, `subagent-driven-development`, `/code-review high`, `ship`.
- One line per step. If risk is ambiguous, ask ONE question first.
- Use REAL symbols, never invent. If you do not know the exact symbol or test path, run `impact` or grep before writing the step. A descriptive phrase beats a fabricated symbol name.

## FAST track plan (small, clear, low risk, ~80 percent of work)

- 0 Slice - one user-visible change, three files or fewer, ships today.
- 1 Lock idea - skip, two lines in chat.
- 2 Spec - two or three acceptance bullets in the PR body.
- 3 Plan - native plan mode if multi-file, skip if two files or fewer.
- 4 Build - `impact({target})` FIRST, then edit; one build agent end-to-end (see `subagent-driven-development`, fan-out is opt-in).
- 5 ⭐ Test the seam first - `crowsnest-testing` at FAST depth: the smallest failing check before the fix on any cross-boundary signal; skip only for a single-file change. Author tests through the `test-audit` gate.
- 6 Prove green - `verification-before-completion` gate + `npm run typecheck && npm run test` + `npm run build` when boundaries change + `detect_changes` before commit.
- 7 Review - `/code-review low`; `/simplify` for cleanup.
- 8 Ship - `crowsnest-pr` or `git commit` + `gh pr create`; never self-merge.

## CAREFUL track plan (danger list)

- 1 Lock idea - `brainstorming`.
- 2 Spec - `/spec`.
- 3 Plan - `writing-plans`.
- 4 Build - `impact({target})` then `subagent-driven-development` (one build agent unless tasks are genuinely independent).
- 5 ⭐ Test seam - `crowsnest-testing` at CAREFUL depth: full failing-test-first coverage of boundaries, plus route-contract tests, auth and RBAC paths, and drizzle migration up and down. Browser behavior goes through `crowsnest-e2e`.
- 6 Prove green - verification gate + `crowsnest-qa-testing` for UI + `npm run test` + `npm run e2e` + a green `crowsnest-e2e` spec; confirm migration applied both ways.
- 7 Review - `/code-review high` + `autoreview`.
- 8 Ship - `ship` then `crowsnest-release-*` when it is a release.

## Orchestration line (include when relevant)

Independent features get one worktree each. Sub-features within one feature use subagents in one worktree. Never split one feature across worktrees. Default to one build agent plus one reviewer, not a fan-out.

## Non-negotiables (state if the request is about to skip one, both tracks)

- Slice first.
- Test the seam first on cross-boundary signals, the test name is the contract map.
- `impact` before edit, `detect_changes` before commit.
- Verification gate, run the command and read the output.
- Branch per work, never commit to main.
- No heavy skill on small FAST work.

## Examples (illustrative, reason your own per request, do not copy)

### FAST - Request: add an empty state to the creators feed when no rows match

```
🎯 Empty state on the creators feed when the filter returns nothing.
Track: FAST - no danger hit (single surface, no auth/money/migration/route contract).

Steps (run in order):
☐ 0 Slice → the feed list component + its empty branch (~2 files).
☐ 4 Build → `impact({target:"CreatorsFeed"})` then add the empty branch.
☐ 6 Prove → `npm run typecheck && npm run test src/…/CreatorsFeed` + `/run` once.
☐ 7 Review → `/code-review low`.
☐ 8 Ship → `git commit` + `gh pr create`.
Skip: 1,2,3,5 - clear scope, two files, no cross-boundary signal.

▶ Start now: `impact({target:"CreatorsFeed"})`
```

### CAREFUL - Request: add a per-account monthly post quota, new column, enforced in the publish route

```
🎯 Per-account monthly post quota, enforced at publish time.
Track: CAREFUL - DB migration + API route contract (+ money-adjacent quota).

Steps (run in order):
☐ 2 Spec → `/spec post quota` - column shape, enforcement point, over-quota response.
☐ 3 Plan → `writing-plans`.
☐ 4 Build → `impact({target:"publish route handler + account store"})` then edit.
☐ 5 Seam test → `crowsnest-testing` CAREFUL - failing tests: over-quota publish blocked; migration up/down.
☐ 6 Prove → `npm run test` + `npm run e2e` + a `crowsnest-e2e` spec on the publish flow; confirm drizzle migration both ways.
☐ 7 Review → `/code-review high` + `autoreview`.
☐ 8 Ship → `ship`.
Skip: 1 - scope already clear.
Guard: drizzle migration up and down; account scope on the quota read and write; a route-contract test on the publish handler response.

▶ Start now: `/spec per-account monthly post quota`
```
