---
status: active
components: [kit, onboarding, ig-sync, feed, mine, studio, shared]
backlog: none
owner: session-2026-09-02
shipped: null
---

# Devex hardening: auto-fix, fast release, test infra to 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship-subagent-driven-development. Two waves; within each wave tasks are independent and run in PARALLEL. Steps use checkbox syntax.

**Goal:** Raise three repo capabilities to at least 8/10: auto-fix bugs, fast release, test infrastructure. Fix the `kai kit init` release blocker as a prerequisite. Build on the existing ship-* skills, the generated bug board, vitest, the `browse` skill, and the packaging pipeline. Do not add Playwright.

**Architecture:** Phase 0 (release blocker) and Phases 1-4 (CI, release automation, test infra, auto-fix loop) delivered as tasks over two waves. Wave 1 builds the isolated foundations (CLI hardening, CI, data-testids, release automation, auto-fix tooling). Wave 2 builds what depends on Wave 1 (the e2e harness needs the data-testids; the pilot fixes and nightly routine need CI and the fix skill).

**Tech Stack:** TypeScript (Next.js, drizzle, the `kai` CLI), Python sidecar (unchanged here), vitest, bash, GitHub Actions, the gstack `browse` CLI. No new runtime dependencies.

**Spec:** the fable consultant findings recorded in this session, and `.claude/skills/crowsnest-component/references/browse-e2e-qa.md`.

## Global Constraints

- **Do not break the 110 existing vitest tests.** Every task that touches `src/` runs `npm test` and `npm run typecheck` and must leave both green.
- **No push, no tag, no release to buyers, no merge to main, no branch-protection change.** Build and prove green locally on the branch. The live `kai update` round-trip and enabling CI as a required check are left for the user.
- **Root cause, not symptom.** The `kai kit init` fix replaces the broken readline hack, it does not patch around it.
- **Writing rule for docs touched:** no em or en dashes, no curly quotes, sentence-case headings, grounded to real code.
- **The bug board is the boundary.** A backlog row is closed only by flipping its Status cell to `done` (leave the row as history); `scripts/plan-status.sh` counts `| open |`.
- **Test-first for fixes.** Any bug fix writes its failing regression test before the fix.

## Parallelization

- **Wave 1 (parallel): Tasks 1-6.** Distinct file sets: T1 owns `src/cli/kai.ts`; T2 owns `src/cli/license.ts`; T3 owns `.github/` + `scripts/testid-audit.sh`; T4 owns `src/components`/`src/app` testids + the `04-test-cases` blocked cells; T5 owns `scripts/release-prep.sh` + `packaging/`; T6 owns `scripts/next-bug.sh` + `.claude/skills/fix-backlog-item/`. No two share a file.
- **Wave 2 (parallel): Tasks 7-10.** T7 (e2e harness) needs T4's testids and edits `scripts/release-prep.sh` (created by T5) plus `package.json`; T8 and T9 are pilot bug fixes in disjoint files; T10 (nightly routine) references T6's skill. Run Wave 1 to completion and commit before Wave 2.

Shared verification helper: `npm test` (vitest), `npm run typecheck`, `npm run lint`, `bash scripts/plan-status.sh`.

---

### Task 1: CLI hardening (the release blocker + KIT-3 + rollback)

**Files:** Modify `src/cli/kai.ts`. Create `src/cli/kai.test.ts`.

**Read first:** `src/cli/kai.ts` (esp. `io()`/`ask()` lines ~29-70 and `cmdKitInit`/`cmdUp`/`cmdDoctor`/`cmdUpdate`), `src/cli/license.test.ts` (the `KAI_HOME` tmpdir test pattern), `services/ig/crowsnest_ig/config.py` (the sidecar's paired-creds rule), `evidence/10-onboarding-bugs.md`.

- [ ] **Step 1: Write the failing test** `src/cli/kai.test.ts`: drive `ask()` with an injected `{input, output}` where `input` is a `PassThrough` with `isTTY=true` and a no-op `setRawMode`, feeding `"hunter2\r"`. Assert the resolved value is `"hunter2"` and that nothing written to `output` contains `hunter2`. Add a second case: piped (non-TTY) input still returns the line.
- [ ] **Step 2:** Run `npx vitest run src/cli/kai.test.ts` -> FAIL (ask not injectable / echoes).
- [ ] **Step 3: Replace the secret read.** Make `ask` accept an optional `{ input, output }` (default `process.stdin`/`process.stdout`). When `secret` and `input.isTTY`: close the readline interface, set raw mode, read bytes until CR/LF accumulating the password, handle backspace (0x7f) and Ctrl-C (0x03 -> exit), echo nothing, restore mode, recreate the interface via the existing lazy `io()`. Non-secret TTY and all piped input keep the async-iterator path. Remove the `_writeToOutput` override entirely.
- [ ] **Step 4:** Run the test -> PASS. Run `npm test` and `npm run typecheck` -> green.
- [ ] **Step 5: Defense in depth.** In `cmdKitInit`, after reading creds, if `IG_USERNAME` is non-empty and `IG_PASSWORD` empty, die with a clear message (mirror the sidecar rule) rather than writing `.env.local`. In `cmdUp`, after the `:3000` poll, also GET `http://127.0.0.1:8765/health` with the `X-IG-Token` header; on failure print the tail of the ig log. In `cmdDoctor`, add a `config: IG creds paired` line and a `sidecar health` line.
- [ ] **Step 6: KIT-3.** Change `cmdUpdate`'s default install URL to `https://crowsnest-gate.kaiships.workers.dev/install.sh` (the value in `install.sh.template`).
- [ ] **Step 7: `kai rollback`.** Add a `rollback` command: flip `~/.kai/app/current` to the other `v*` directory and re-run the post-update routine; refuse if the two versions' `drizzle/` migration sets differ (print why).
- [ ] **Step 8:** Add a test for the empty-pair refusal and for `cmdUpdate`'s URL. Run `npm test` + `npm run typecheck` -> green. Write report. Do NOT commit.

**Board:** in the report, note that ONB-1/ONB-2/KIT-1/KIT-2 (the kit-init secret defects) are now fixed so the controller can close those rows.

### Task 2: Entitlement path (KIT-4)

**Files:** Modify `src/cli/license.ts`. Modify `src/cli/license.test.ts`.

**Read first:** `src/cli/license.ts` (`entitlementPath()` and readers/writers), `packaging/install.sh.template` (step that reads `~/.kai/state/entitlement.json`).

- [ ] **Step 1: Failing test.** Add a `license.test.ts` case asserting `entitlementPath()` resolves under `~/.kai/state/` and that a file at the OLD `~/.kai/entitlement.json` is still read once (fallback).
- [ ] **Step 2:** Run -> FAIL.
- [ ] **Step 3:** Move `entitlementPath()` to `<KAI_HOME>/state/entitlement.json`; on read, if the new path is absent and the old path exists, read the old one and migrate it.
- [ ] **Step 4:** Run `npx vitest run src/cli/license.test.ts` -> PASS; `npm test` + `npm run typecheck` -> green. Report. Do NOT commit.

### Task 3: CI workflow + testid audit

**Files:** Create `.github/workflows/ci.yml`. Create `scripts/testid-audit.sh`.

- [ ] **Step 1: `scripts/testid-audit.sh`.** Extract every `data-testid="..."` value named in `documents/architect/core-components/*/04-test-cases.md`, and for each, `grep -rq` it under `src/`; exit 1 listing any missing. Make it print `OK: N ids all present` on success.
- [ ] **Step 2:** Run it now. It WILL fail (ids not added yet). That is expected; Task 4 adds them. Note the failing list in your report; do not make the audit pass by weakening it.
- [ ] **Step 3: `.github/workflows/ci.yml`.** On `pull_request` and `push`, ubuntu-latest, Node from `.nvmrc`/package engines: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `bash scripts/testid-audit.sh`. Keep it under ~40 lines.
- [ ] **Step 4:** Validate the YAML parses (`node -e "require('js-yaml')"` is not available; instead `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`). Report. Do NOT commit.

### Task 4: data-testid rollout (24 ids)

**Files:** Modify UI files under `src/components/` and `src/app/(shell)/`. Modify the `browse-e2e` lens rows in the relevant `documents/architect/core-components/*/04-test-cases.md` (flip `blocked: data-testid gap` to `not run`).

**Read first:** each component's `04-test-cases.md` browse-e2e lens for the exact ids; `src/components/channels/{kanban-board,add-channel-dialog,channel-card}.tsx` and the feed/mine/studio component trees.

- [ ] **Step 1:** Add every `data-testid` the browse-e2e lenses name. Group by component: channels/onboarding/ig-sync (`channels-add-channel-trigger`, `add-channel-tab-handle`, `add-channel-handle-input`, `add-channel-submit-handle`, `channels-tracked-count`, `channel-card`); feed (`feed-filter-min-score`, `outlier-card`, `preview-open-full-page`, `save-post-button`, `save-post-confirm`, `save-to-vault-trigger`, `save-to-vault-confirm`, `remix-hook-seed-select`); mine (`own-channel-picker-choose`, `mine-calendar-day`, `mine-calendar-plan-day`, `plan-dialog-title`, `plan-dialog-save`, `mine-calendar-mark-published`); studio (`studio-cook-button`, `studio-run-pill`, `studio-render-video`, `studio-publish-button`). For a repeated list item (`channel-card`, `outlier-card`, `mine-calendar-day`) add a sibling `data-id` for per-row targeting.
- [ ] **Step 2:** Flip each `blocked` browse-e2e cell in the `04-test-cases.md` docs to `not run` (the harness in Task 7 will run them).
- [ ] **Step 3:** Run `npm run typecheck` + `npm test` (unchanged behavior) and `bash scripts/testid-audit.sh` -> now OK. Run the dash scan on any doc you edited. Report. Do NOT commit.

### Task 5: Release automation

**Files:** Create `scripts/release-prep.sh`, `packaging/rollback.sh`. Modify `packaging/release.yml` (or `.github/workflows/release.yml`).

**Read first:** `packaging/release.sh`, `packaging/build-bundle.sh` (the existing smoke, lines ~122-150), `.github/workflows/release.yml`, `packaging/gen-install.sh`, `package.json`.

- [ ] **Step 1: `scripts/release-prep.sh <version>`.** Refuse on a dirty tree or off `main`; `npm version <version> --no-git-tag-version`; prepend a `## <version>` section to `packaging/CHANGELOG.md` built from `git log --oneline <last-tag>..HEAD`; run `npm test`; if `scripts/e2e/run.sh` exists, prompt to run `npm run e2e`; if `git diff` since last tag touched `services/ig` or `src/server/ig`, prompt to run `verify:live` first; commit `release: v<version>`; `git tag v<version>`; print the `git push origin main v<version>` line and STOP (do not push).
- [ ] **Step 2:** Add a pre-build gate to the release workflow: `npm ci && npm run typecheck && npm test` before `build-bundle.sh`.
- [ ] **Step 3: Fresh-HOME Kit smoke** in the release workflow after `build-bundle.sh`, before upload: extract the built tarball into a temp `HOME`, write a fixture `~/.kai/state/entitlement.json`, run `printf 'user\npass\n\n\n' | kai kit init`, assert `.env.local` has a non-empty `IG_PASSWORD` and a generated `IG_SERVICE_TOKEN` and the db migrated; then start the sidecar directly (`python -m crowsnest_ig`) and curl `/health` -> 200. Fail the job on any assertion.
- [ ] **Step 4: `packaging/rollback.sh <version>`.** Fetch the old tarball from R2, run `gen-install.sh` against it, re-upload `install.sh` + `latest.json`. Model it on `release.sh`.
- [ ] **Step 5:** Shellcheck-clean the two scripts if `shellcheck` is available; otherwise `bash -n` them. Validate the workflow YAML with python yaml. Report. Do NOT commit. (Do not actually run a release.)

### Task 6: Auto-fix tooling

**Files:** Create `scripts/next-bug.sh`, `.claude/skills/fix-backlog-item/SKILL.md`.

**Read first:** `scripts/plan-status.sh` (the grep over `05-backlog-to-enhance.md` boards), `.claude/skills/{crowsnest-component,where-are-we,ship-systematic-debugging,ship-verification-before-completion}/SKILL.md`.

- [ ] **Step 1: `scripts/next-bug.sh`.** Read every `documents/architect/core-components/*/05-backlog-to-enhance.md`, print open rows with `Type=bug`, sorted blocker > high > medium > low, excluding rows whose title links a plan. Support `--verify vitest|browse` filtering via a heuristic (source names a `.tsx` or a "shows/renders/overlay" title -> browse; else vitest). One line per item: `component ID severity verify source title`.
- [ ] **Step 2:** Run it; confirm it prints real open rows. `bash scripts/plan-status.sh` still runs.
- [ ] **Step 3: `.claude/skills/fix-backlog-item/SKILL.md`.** An orchestrator skill (frontmatter `name: fix-backlog-item`, `disable-model-invocation: true`, trigger `/fix-backlog-item`): take one board row -> read its `Source` and the component `02-architecture.md` for the seam -> branch via `ship-using-git-worktrees` -> `ship-systematic-debugging` phases 1-2, failing test first (vitest for server/lib/routes, a `scripts/e2e/*.sh` journey for UI rows) -> fix -> `ship-verification-before-completion` + `npm test && npm run typecheck` -> flip the row `done`, open a PR, never merge. Skip `ship-writing-plans` for fixes touching 3 files or fewer. Encode the blast-radius guardrail: auto-eligible (Type=bug, diff small, files only under `src/lib|src/server/queries|src/components|src/app`, a test present) opens a normal PR labelled `auto-fix`; anything touching `src/cli`, `packaging`, `src/server/db`, `services/ig`, `.env*`, `service-darwin.ts`, or `Type=enhancement` opens a DRAFT PR labelled `needs-human` and sets the row to `in-review`, never `done`.
- [ ] **Step 4:** Follow the writing rules for the skill (this is a skill file, prose). Report. Do NOT commit.

### Task 7: e2e harness (Wave 2)

**Files:** Create `scripts/seed-e2e.ts`, `scripts/e2e/run.sh`, `scripts/e2e/feed-e2e-01.sh`, `scripts/e2e/mine-e2e-02.sh`, `scripts/e2e/ig-sync-e2e-01.sh`. Modify `package.json` (add `"e2e"`). Modify `scripts/release-prep.sh` (call `npm run e2e`). Amend `.claude/skills/crowsnest-component/references/browse-e2e-qa.md`.

**Read first:** the browse-e2e lens rows for feed/mine/ig-sync in their `04-test-cases.md`; `src/server/db/{migrate,bootstrap}.ts` and the drizzle schema; `~/.claude/skills/gstack/browse/SKILL.md` for the `browse` CLI verbs; the data-testids added in Task 4.

- [ ] **Step 1: `scripts/seed-e2e.ts`.** Build a fixture SQLite at `CROWSNEST_DB_PATH=data/e2e.db` with the state the `04-test-cases` intros describe (one tracked channel, more than 24 scored videos, one at least 5x, one analyzed, one soft-removed, one carousel). Reuse `migrate.ts` + `bootstrap.ts` + the schema. No new abstraction.
- [ ] **Step 2: journey scripts** `scripts/e2e/<c>-<id>.sh` using the `browse` CLI, one Arrive/Act/Assert per case row, selecting by `[data-testid=...]`. The ig-sync journey runs with the sidecar down and asserts the inline error path.
- [ ] **Step 3: `scripts/e2e/run.sh`.** Seed the fixture db, start `PORT=3001 CROWSNEST_DB_PATH=data/e2e.db npm run dev`, wait for `:3001`, run every `scripts/e2e/*.sh`, stop the server, non-zero on any failure. Add `"e2e": "bash scripts/e2e/run.sh"` to `package.json`.
- [ ] **Step 4:** Run `npm run e2e` -> the 3 journeys pass. Wire `npm run e2e` into `scripts/release-prep.sh`. Amend `browse-e2e-qa.md`: the lasting artifact is the case table AND `scripts/e2e/<component>-<id>.sh` (no Playwright, no page objects). Report. Do NOT commit.

### Task 8: Pilot fix B-14 (Wave 2)

**Files:** the file B-14 names (a feed video route returning 200 for notFound). Test alongside.

**Read first:** the B-14 row and its `Source`, the route under `src/app/(shell)/feed/[videoId]`.

- [ ] **Step 1:** Write the failing test asserting the route returns a 404 (not 200) for a missing video.
- [ ] **Step 2:** Run -> FAIL. **Step 3:** Fix the route (call `notFound()` / return the 404 path). **Step 4:** Run -> PASS; `npm test` + `npm run typecheck` green. **Step 5:** Flip B-14's Status to `done`. Report. Do NOT commit.

### Task 9: Pilot fix B-05 (Wave 2)

**Files:** the save-to-vault write path (`src/server`), test alongside.

**Read first:** the B-05 row and its `Source`, the save-to-vault action/query.

- [ ] **Step 1:** Write the failing test reproducing the half-write or duplicate (concurrent or repeated save).
- [ ] **Step 2:** Run -> FAIL. **Step 3:** Wrap the write in a transaction / add the idempotent upsert. **Step 4:** Run -> PASS; `npm test` + `npm run typecheck` green. **Step 5:** Flip B-05's Status to `done`. Report. Do NOT commit.

### Task 10: Nightly auto-fix routine (Wave 2)

**Files:** Create the schedule/cron config for a nightly routine (per the `schedule` skill's format), referencing `scripts/next-bug.sh` + the `fix-backlog-item` skill.

**Read first:** the `schedule` skill; `scripts/next-bug.sh` and `fix-backlog-item/SKILL.md` (from T6).

- [ ] **Step 1:** Define a nightly routine that runs `scripts/next-bug.sh --verify vitest | head -1` and invokes `/fix-backlog-item` on that row, opening a PR. Document that it only takes vitest-verifiable rows (cloud cannot drive `browse`).
- [ ] **Step 2:** Validate the config is well-formed. Report. Do NOT commit. (Do not actually register a live cron without the user; leave it as a committed config plus a one-line how-to-enable.)

---

## Self-review

**Spec coverage.** P0 -> T1 (+ board closes). P1 -> T3. P2 -> T1 (KIT-3, rollback), T2 (KIT-4), T5. P3 -> T4, T3 (audit), T7. P4 -> T6, T8, T9, T10. Every consultant recommendation maps to a task.

**Placeholder scan.** Each task names exact files, exact steps, and a runnable verify. The bug-fix tasks carry the failing-test-first discipline explicitly.

**Type/consistency.** `scripts/next-bug.sh`, `scripts/testid-audit.sh`, `scripts/release-prep.sh`, `scripts/e2e/run.sh` are referenced consistently across tasks and CI. The data-testid set in T4 matches the ids T7's journeys select and T3's audit checks.

**Risk:** T1's raw-mode secret read cannot be verified against a real terminal in this environment; the injectable-IO vitest test is the proxy, and the fresh-HOME Kit smoke (T5) is the integration backstop. The one true live proof (`kai kit init` on a real TTY, and a live `kai update`) is left to the user, as the plan boundary states.
