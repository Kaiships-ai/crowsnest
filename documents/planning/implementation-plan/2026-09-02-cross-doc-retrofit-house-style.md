---
status: active
components: [kit, onboarding, feed, analyze, remix, studio, mine, llm]
backlog: none
owner: session-2026-09-02
shipped: null
---

# Retrofit 8 components to the doc house-style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship-subagent-driven-development (independent-tasks PARALLEL mode) to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restructure the five docs of each of the eight remaining components onto the component house-style, matching the ig-sync exemplar, grounded in each component's real code.

**Architecture:** Eight independent tasks, one per component (kit, onboarding, feed, analyze, remix, studio, mine, llm). Each task rewrites only its own component's five docs. No task touches another component's files, so all eight run in parallel in one wave. The docs already exist and are filled; this is restructure, not rewrite.

**Tech Stack:** Markdown docs. Verification: `grep`, `scripts/plan-status.sh`, mermaid render check (kroki, or mermaid.ink fallback since kroki's mermaid endpoint has been flaky).

**Spec:** `.claude/skills/crowsnest-component/house-style.md` (the authoritative doc contract), its three references under `.claude/skills/crowsnest-component/references/`, and `documents/architect/core-components/ig-sync/` as the worked example to copy.

## Global Constraints

- **The house-style is the spec.** Every task applies `.claude/skills/crowsnest-component/house-style.md` verbatim and copies the structure of the already-retrofitted `ig-sync` docs. Do not invent a different shape.
- **Five-doc invariant.** Exactly `01`..`05` per component. Never a sixth file.
- **Numbered sections, global.** Every top-level `##` section heading in all five docs is numbered sequentially from 1, per doc. In `03-feature-description.md` the feature summary table is section 1, so feature detail sections begin at 2.
- **Feature summary table in 03.** Section 1 of `03`, columns `#`, Feature, What it does, Status, Grounded in, Open item; legend `● Built, ◐ Partial, ○ Roadmap`; `#` is the feature's detail-section number (starts at 2); a roadmap feature with no section leaves `#` blank.
- **02 must carry a drizzle ER diagram and at least one DB-operation sequence diagram** per `references/drizzle-er-and-sequence.md`, for the tables the component reads or writes. A component that owns no tables shows the tables it reads and says so plainly.
- **04 uses the four lenses** from `references/test-cases-format.md`: behavior, route and action, browse-e2e, security-lite.
- **Writing rule:** no em or en dashes, no curly quotes, sentence-case headings, grounded to real code, no invented facts. Evergreen rule: state the current system as fact, no `Date:` field, no dated evidence framing.
- **Preserve real content.** These docs are already filled with correct facts; keep them, restructure onto the house-style. Do not drop grounded detail.
- **No git, no commit** (parallel-mode contract). Write files only. The controller commits.

## Parallelization

One wave, eight tasks (Tasks 1 to 8), fully parallel. Each writes only its component's five files under `documents/architect/core-components/<component>/`. No shared files. No cross-task dependency.

Shared verification helpers (each task runs these on its own five files):

- Dash and curly-quote scan: `grep -nP '[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}]' <file>` -> no output.
- Numbered sections: `grep -nE '^## ' <file>` -> every heading starts with a number and a dot.
- Five-doc invariant: `ls documents/architect/core-components/<component> | grep -cE '^0[1-5]-'` -> 5.
- Mermaid render: extract each block in `02` to a temp `.mmd`, POST to `https://kroki.io/mermaid/svg` (expect 200); if kroki's mermaid endpoint errors, fall back to mermaid.ink and report which was used.
- `bash scripts/plan-status.sh` runs without error.

---

### Task 1: kit

**Files:** rewrite the five docs under `documents/architect/core-components/kit/`.

**Code sources to ground in:** `src/cli/kai.ts`, `src/cli/license.ts`, `src/cli/service-darwin.ts`, `src/cli/runtime.ts`, `packaging/` (install.sh.template, platforms.json, worker/, release.sh), `scripts/`, `documents/architect/shared/packaging-and-release.md`. Note the known `kai kit init` secret bugs (`evidence/10-onboarding-bugs.md`) in the feature summary / open-not-verified.

- [ ] **Step 1:** Read `house-style.md`, the three references, and the `ig-sync` five docs (the pattern). Read the current `kit` five docs and the code sources.
- [ ] **Step 2:** Rewrite the five `kit` docs onto the house-style: status headers, key-concepts + dependency-map tables in `01`; module table + drizzle ER (kit touches no app tables; show the entitlement/state files and say so) + sequence diagram for the license-and-install flow + open-not-verified in `02`; numbered sections everywhere; feature summary table in `03`; four lenses in `04`; single backlog table in `05`.
- [ ] **Step 3:** Run every shared verification helper on the five files. Fix any failure.
- [ ] **Step 4:** Write a report to the task report file. Do NOT commit.

### Task 2: onboarding

**Files:** rewrite the five docs under `documents/architect/core-components/onboarding/`.

**Code sources:** `src/app/first-run/`, `src/server/queries/first-run-gate.ts`, `src/app/(shell)/layout.tsx` (the gate), `src/cli/kai.ts` `cmdKitInit`, `evidence/10-onboarding-bugs.md`, `documents/architect/shared/navigation-and-shell.md`.

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current onboarding docs, and the code.
- [ ] **Step 2:** Rewrite the five onboarding docs onto the house-style (same checklist as Task 1 Step 2, applied to onboarding). Feature summary must carry the two kit-init secret defects with the right status and open-item pointers.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 3: feed

**Files:** rewrite the five docs under `documents/architect/core-components/feed/`.

**Code sources:** `src/app/(shell)/feed/`, `src/lib/feed-filters.ts`, `src/server/queries/feed.ts`, the saved-view / saved-post / vault actions, `src/server/db/schema.ts` (videos and related tables the feed reads).

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current feed docs, and the code.
- [ ] **Step 2:** Rewrite the five feed docs onto the house-style. The feed is largely read-only (URL-driven); the `02` ER shows the videos and saved-view/saved-post tables it reads and states that the feed writes none of them except saves.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 4: analyze

**Files:** rewrite the five docs under `documents/architect/core-components/analyze/`.

**Code sources:** `src/server/services/analyze.ts`, `src/server/actions/analyze-actions.ts`, `src/server/services/ideas.ts`, `src/server/services/auto-analyze.ts`, `src/components/video/video-detail.tsx`, `src/app/(shell)/feed/[videoId]/page.tsx`, `src/server/db/schema.ts` (analyses / transcript / ideas tables), `documents/architect/core-components/llm/01-concept-brief.md`.

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current analyze docs, and the code.
- [ ] **Step 2:** Rewrite the five analyze docs onto the house-style (same checklist). `02` ER shows the analysis and transcript tables; a sequence diagram for one analyze pass.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 5: remix

**Files:** rewrite the five docs under `documents/architect/core-components/remix/`.

**Code sources:** `src/server/services/remix.ts`, `src/server/actions/remix-actions.ts`, `src/components/remix/`, `src/app/(shell)/feed/[videoId]/remix/page.tsx`, `src/server/queries/remix-runs.ts`, `src/server/db/schema.ts` (`remixSessions`, `remixRuns`, scripts, planned posts).

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current remix docs, and the code.
- [ ] **Step 2:** Rewrite the five remix docs onto the house-style. `02` ER shows remixSessions / remixRuns / scripts / planned-post tables; a sequence diagram for one remix generation stage.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 6: studio

**Files:** rewrite the five docs under `documents/architect/core-components/studio/`.

**Code sources:** `src/app/(shell)/runs`, `src/app/api/runs`, `src/app/api/media`, `src/server/queries/studio.ts`, `src/server/actions/create-run-actions.ts`, `src/server/terminal/ws.ts`, `src/server/db/schema.ts` (create/cook run tables, render assets), `documents/architect/shared/background-jobs.md`.

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current studio docs, and the code.
- [ ] **Step 2:** Rewrite the five studio docs onto the house-style. `02` ER shows the run / render-asset tables; a sequence diagram for one cook run.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 7: mine

**Files:** rewrite the five docs under `documents/architect/core-components/mine/`.

**Code sources:** `src/app/(shell)/mine`, `/vault`, `/persona`, `src/server/queries/own-channel.ts`, `src/server/queries/planned-posts.ts`, the planned-post / graph / channel actions, `src/server/db/schema.ts` (planned posts, channel snapshots, persona/niche).

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current mine docs, and the code.
- [ ] **Step 2:** Rewrite the five mine docs onto the house-style. `02` ER shows planned-posts / channel-snapshots / persona tables; a sequence diagram for planning a post.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

### Task 8: llm

**Files:** rewrite the five docs under `documents/architect/core-components/llm/`.

**Code sources:** `src/server/llm/client.ts`, `src/server/llm/schemas.ts`, `src/server/llm/error-message.ts`, `src/server/llm/generation-probe.ts`, `src/server/secrets/store.ts`, the analyze and remix consumers, `documents/architect/shared/external-services.md`. Before writing any Claude model or API claim, read the `claude-api` skill and verify against the code; do not state model ids or pricing from memory.

- [ ] **Step 1:** Read `house-style.md`, references, ig-sync exemplar, current llm docs, and the code. Invoke the `claude-api` skill for any model/API fact.
- [ ] **Step 2:** Rewrite the five llm docs onto the house-style. The llm layer owns no tables; the `02` ER shows the secret-store row it reads (or states plainly that it is a stateless request-time layer) and a sequence diagram for one grounded generation call.
- [ ] **Step 3:** Run every shared verification helper. Fix failures.
- [ ] **Step 4:** Report. Do NOT commit.

---

## Self-review

**Spec coverage.** Each of the eight components has exactly one task that rewrites its five docs onto `house-style.md`. The house-style requirements (status header, key-concepts, dependency map, module table, drizzle ER, sequence diagram, open-not-verified, numbered sections, feature summary table, four lenses, backlog table) are the Global Constraints every task inherits, so each task covers them without restating them. ig-sync is not in scope (already retrofitted).

**Placeholder scan.** No "TBD" or "handle edge cases". The doc content is specified as "apply house-style.md and copy ig-sync," which is legitimate for a doc retrofit: the authoritative content lives in the referenced spec (house-style.md) and the worked example (ig-sync), exactly the sources a fresh implementer needs.

**Type consistency.** All eight tasks use identical file paths (`documents/architect/core-components/<component>/0[1-5]-*.md`), the same house-style reference, and the same verification helpers. The four lens names and the feature-table columns are fixed in the Global Constraints, identical to the ig-sync exemplar.

**Risk:** kroki's mermaid endpoint has been flaky; the shared helper names mermaid.ink as the fallback, and each task reports which renderer confirmed its diagrams.
