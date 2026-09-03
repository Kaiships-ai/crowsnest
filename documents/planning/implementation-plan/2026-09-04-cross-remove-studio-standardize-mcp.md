---
status: active
components: [mcp, studio, shared, kit]
backlog: none
owner: goal-2 (opus)
shipped: null
---

# Remove cook/serve/studio, standardize the MCP server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship:subagent-driven-development
> (recommended), or execute the plan directly in this session, phase by phase, verifying
> each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the create studio (brief + embedded terminal + cook/serve) and make the
MCP server the product's handoff surface to Reel Factory.

**Architecture:** Two movements. (1) Deletion: strip the terminal websocket from
`server.ts`, delete `src/server/terminal/*`, `src/server/studio/*`, the studio route and
components, the create-run query/action layer, and the `create_runs` table (with a logging
migration); remove the create branch from the shared `/runs` read; drop node-pty/xterm and
their packaging wiring. (2) MCP standardization: one output helper that returns JSON text
plus `structuredContent`, typed error results, MCP-layer pagination on list tools, source
media file paths for the Reel Factory handoff, and a rename of `getStudioBrief` ->
`getPostBrief`. Then docs.

**Tech Stack:** TypeScript, Next 16 (custom `tsx server.ts`), Drizzle + better-sqlite3,
`@modelcontextprotocol/sdk`, zod, Vitest.

**Spec:** `documents/planning/spec/2026-09-04-remove-studio-standardize-mcp.md`

## Global Constraints

- Before commit, the full gate must pass: `npm run typecheck && npm run lint && npm run
  test && npm run build && bash scripts/testid-audit.sh`. Working tree clean.
- Baseline is 1608 tests passing (121 files). Deletion tasks lower the count as their tests
  go; MCP/docs tasks raise it. Never a failure.
- GitNexus: `impact` before editing a symbol, `detect_changes --scope all` before commit,
  warn on HIGH/CRITICAL. `rename` for symbol renames, never find-replace. Index is stale
  (16 commits behind at plan time) — reindex in the worktree before the rename task:
  `node .gitnexus/run.cjs analyze --index-only`.
- Tool names on the MCP stay stable: `/cn-remix` and `/cn-weekly` depend on `crowsnest_feed`,
  `crowsnest_video`, `crowsnest_remix_*`. No renames of registered tools.
- `crowsnest_plans` stays read-only, output non-narrowed, `state` free-form (Goal 4 owns
  it). Ping Goal 4 (`term_e478413a`) before changing that tool's output shape.
- No em/en dashes, straight quotes, sentence-case headings in docs (house-style).
- After merge, ping Goal 3 (`term_97cb131c`) so it can enhance `/runs`.

---

## Phase 1: Deletion

### Task 1: Strip the terminal websocket from server.ts

**Files:**
- Modify: `server.ts`
- Test: none (thin bootstrap; covered by build + a manual MCP smoke in verify)

**Interfaces:**
- Consumes: `handleMcpRequest` from `src/server/mcp/http.ts` (unchanged).
- Produces: a `server.ts` that mounts only Next + `/api/mcp`, no ws, no pty, no create-run
  reconcile.

- [ ] **Step 1: Confirm the blast radius.** Run
  `node .gitnexus/run.cjs impact "attachTerminal" --direction upstream --repo .`. Expect
  the sole caller to be `server.ts` (LOW). Same for `ensurePtyExecutable` and
  `reconcileOrphanCreateRuns`.

- [ ] **Step 2: Rewrite `server.ts` to this exact content:**

```ts
// server.ts
import { createServer } from "node:http";
import next from "next";
import { handleMcpRequest } from "./src/server/mcp/http";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, port });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    // The MCP endpoint is served in-process so its tools share this server's one SQLite
    // connection (see src/server/mcp/http.ts). Everything else goes to Next.
    if (req.url && req.url.startsWith("/api/mcp")) {
      void handleMcpRequest(req, res);
      return;
    }
    handle(req, res);
  });

  // HOST is unset in dev (binds all interfaces, unchanged). The packaged LaunchAgent sets
  // HOST=127.0.0.1 so a buyer's Mac never shows the "accept incoming connections" firewall
  // prompt on first run.
  const host = process.env.HOST;
  const onReady = () => console.log(`ready on http://localhost:${port}`);
  if (host) server.listen(port, host, onReady);
  else server.listen(port, onReady);
});
```

  Note: the custom server stays because `/api/mcp` is served in-process; only the terminal
  upgrade handler, `ws`, `ensurePtyExecutable`, and `reconcileOrphanCreateRuns` go. The
  Next upgrade handler (`getUpgradeHandler`) went with the ws block; Next HMR in dev runs
  over its own webpack/websocket path in the App Router and does not need the manual
  `server.on("upgrade", ...)` bridge that only existed to fork terminal traffic away from
  Next.

- [ ] **Step 3: Verify build.** Run `npm run build`. Expected: succeeds (no reference to the
  deleted symbols — but they still exist until Task 2, so this passes now and after).

- [ ] **Step 4: Commit.**

```bash
git add server.ts
git commit -m "refactor(server): drop terminal websocket, keep MCP mount"
```

### Task 2: Delete the terminal and studio server modules

**Files:**
- Delete: `src/server/terminal/` (all 15 files: `ws.ts`, `session.ts`,
  `session-registry.ts`, `cook-queue.ts`, `render-watch.ts`, `harness-profile.ts`,
  `pty-perms.ts`, `resolve-post.ts`, and their `.test.ts` siblings)
- Delete: `src/server/studio/` (`paths.ts`, `paths.test.ts`, `write-brief.ts`,
  `write-brief.test.ts`)

**Interfaces:**
- Consumes: nothing (Task 1 removed the only non-test importers of `server/terminal`;
  `server/studio` is imported only by `server/terminal` and `config.ts`, both handled here
  and in Task 7).
- Produces: no `src/server/terminal` or `src/server/studio` directory.

- [ ] **Step 1: Confirm no live importers remain.** Run
  `grep -rln "server/terminal\|server/studio" src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`.
  Expected: only `src/server/config.ts` (handled in Task 7). If anything else appears, stop
  and report.

- [ ] **Step 2: Delete the directories.**

```bash
git rm -r src/server/terminal src/server/studio
```

- [ ] **Step 3: Verify.** Run `npm run typecheck`. Expected: errors only in files that still
  import these (studio components, create-run actions, config) — those are deleted or fixed
  in Tasks 3-7. Note the error list; it is the checklist for the next tasks. Do not fix
  config yet.

- [ ] **Step 4: Commit.**

```bash
git commit -m "refactor: delete terminal and studio server modules"
```

### Task 3: Remove the create-run branch from the shared /runs read

**Files:**
- Modify: `src/server/queries/runs.ts`
- Modify: `src/server/queries/runs.test.ts`

**Interfaces:**
- Consumes: `tables.syncJobs`, `tables.remixRuns` (unchanged).
- Produces: `listRuns` and `getRun` over sync + remix only; `RunType = "sync" | "remix" |
  "download"`; no `fromCreateRun`, no `getCreateRun` import.

This is the HIGH-risk edit (GitNexus: `fromCreateRun` upstream = 6 impacted across the
runs stream, run detail, and runs list). The changes are surgical: three deletions.

- [ ] **Step 1: Update the failing tests first.** In `src/server/queries/runs.test.ts`,
  delete every test that seeds a `create_runs` row or asserts a `type: "create"` run
  appears in `listRuns`/`getRun`. Keep all sync and remix assertions. Run
  `npx vitest run src/server/queries/runs.test.ts` and expect failures now come only from
  the still-present create imports (compile), which the next step removes.

- [ ] **Step 2: Edit `runs.ts`.**
  - Delete the import: `import { getCreateRun, type CreateRunSelect } from "@/server/queries/create-runs";`
  - In the `RunType` union, remove `"create"` so it reads
    `export type RunType = "sync" | "remix" | "download";`
  - Delete the whole `function fromCreateRun(row: CreateRunSelect, now: number): RunSummary { ... }`.
  - In `listRuns`, delete the `createRows` query line and the
    `...createRows.map((r) => fromCreateRun(r, now)),` spread.
  - In `getRun`, delete the create-run fallback block (the `if (!summary) { const createRow
    = getCreateRun(runId); ... return { ...createSummary, events: createEvents,
    itemsEnriched: null }; }` branch) and let a null summary return `null` as it already
    does for a bad link.

- [ ] **Step 3: Run tests.** `npx vitest run src/server/queries/runs.test.ts`. Expected: PASS.

- [ ] **Step 4: Run the runs-stream and runs-page tests** to confirm the HIGH-risk consumers
  still pass: `npx vitest run src/app src/components/runs`. Expected: PASS. If a runs-list or
  run-detail component test asserts create-run rendering, delete that assertion (create runs
  no longer exist); note it in the commit body.

- [ ] **Step 5: Commit.**

```bash
git add src/server/queries/runs.ts src/server/queries/runs.test.ts
git commit -m "refactor(runs): drop create-run rows, keep sync and remix"
```

### Task 4: Delete the create-run query and action layer

**Files:**
- Delete: `src/server/queries/create-runs.ts`, `src/server/queries/create-runs.test.ts`
- Delete: `src/server/actions/create-run-actions.ts`

**Interfaces:**
- Consumes: nothing after Task 3 (runs.ts no longer imports create-runs).
- Produces: no create-run query or action modules. The only remaining importer,
  `src/components/studio/studio-panel.tsx`, is deleted in Task 5.

- [ ] **Step 1: Confirm importers.** Run
  `grep -rln "queries/create-runs\|create-run-actions" src | grep -v '\.test\.'`. Expected:
  only `src/components/studio/studio-panel.tsx` (deleted next task) and `runs.ts` (already
  cleaned). If `runs.ts` still appears, Task 3 is incomplete.

- [ ] **Step 2: Delete.**

```bash
git rm src/server/queries/create-runs.ts src/server/queries/create-runs.test.ts src/server/actions/create-run-actions.ts
```

- [ ] **Step 3: Verify.** `npm run typecheck`. Expected: remaining errors point only at the
  studio components (Task 5). Commit.

```bash
git commit -m "refactor: delete create-run query and action layer"
```

### Task 5: Delete the studio route, components, and topbar entry

**Files:**
- Delete: `src/app/(shell)/mine/[postId]/studio/` (the `page.tsx` and its directory)
- Delete: `src/components/studio/` (`studio-panel.tsx`, `terminal-pane.tsx`,
  `studio-screen.tsx`)
- Modify: `src/components/layout/topbar.tsx`
- Modify: `src/components/layout/topbar.test.ts` (if it asserts the studio title)

**Interfaces:**
- Consumes: nothing after this task.
- Produces: no `/mine/[postId]/studio` route, no studio components. `queries/studio.ts`
  survives (it is the MCP brief backend, renamed in Task 10).

- [ ] **Step 1: Delete the route and components.**

```bash
git rm -r "src/app/(shell)/mine/[postId]/studio" src/components/studio
```

- [ ] **Step 2: Remove the topbar entry.** In `src/components/layout/topbar.tsx`, delete the
  line `{ pattern: /^\/mine\/[^/]+\/studio$/, title: "Studio" },` from `ROUTE_TITLES`. Keep
  the `Remix studio` entry (`/feed/[^/]+/remix`).

- [ ] **Step 3: Fix the topbar test.** If `src/components/layout/topbar.test.ts` asserts a
  `/mine/.../studio` title, delete that case. Run `npx vitest run src/components/layout`.
  Expected: PASS.

- [ ] **Step 4: Verify typecheck.** `npm run typecheck`. Expected: clean except for
  `queries/studio.ts` being imported by the deleted studio route (now gone) — should be
  clean. Commit.

```bash
git commit -m "refactor: delete studio route and components"
```

### Task 6: Repoint the studio links (coordination edits)

**Files:**
- Modify: `src/components/remix/stage-finish.tsx` (Goal 1 surface, confirmed no conflict)
- Modify: `src/components/mine/plan-dialog.tsx` (Goal 4 surface)

**Interfaces:**
- Consumes: nothing new.
- Produces: a remix finish view and a plan dialog that link to `/mine/[postId]` (the post
  detail), never to the deleted `/mine/[postId]/studio`.

- [ ] **Step 1: Fix `stage-finish.tsx`.** Remove the anchor to `/mine/${postId}/studio` and
  its "Open the studio ->" / "Finish and open studio" copy. Replace with a link to
  `/mine/${postId}` labelled "View in your plan", and change the toast copy from
  "Open the studio to cook it." / "Opening the studio for this remix." to "Added to your
  plan." / "Opening your plan." Keep the finish action itself (it creates the planned post)
  unchanged. Update `src/components/remix/stage-finish.test.tsx` assertions on that copy and
  href if present.

- [ ] **Step 2: Fix `plan-dialog.tsx`.** Replace the `Create in Studio` button (which pushes
  `/mine/${plan!.id}/studio`) with a `View post` button that pushes `/mine/${plan!.id}`.
  Update any test asserting the old label/route.

- [ ] **Step 3: Run tests.** `npx vitest run src/components/remix src/components/mine`.
  Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/components/remix/stage-finish.tsx src/components/mine/plan-dialog.tsx
git commit -m "refactor: repoint studio links to the post detail"
```

### Task 7: Drop cook/studio config and env vars

**Files:**
- Modify: `src/server/config.ts` (and `src/server/config.test.ts` if it asserts these vars)
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a config schema with no `COOK_*`, no `WAITING_IDLE_MS`, no studio-root/vault var.

- [ ] **Step 1: Find the studio-root/vault var names.** Read `src/server/config.ts` around
  the two comments referencing "the create studio" (near lines 61-66) to get the exact keys
  (the sandbox dir root and the Obsidian vault path). Note both key names.

- [ ] **Step 2: Delete from the schema.** Remove the `// --- cook harness ---` block
  (`COOK_MODEL`, `COOK_CONCURRENCY`, `COOK_WATCHDOG_MS`, `WAITING_IDLE_MS`) and the two
  studio-root/vault keys found in Step 1. Leave everything else, including the `--- existing
  ---` and Graph API blocks, untouched.

- [ ] **Step 3: Update `config.test.ts`.** If any test asserts a default for a removed key,
  delete that assertion. Run `npx vitest run src/server/config.test.ts`. Expected: PASS.

- [ ] **Step 4: Clean `.env.example`.** Remove the vault-path var and any `COOK_*` lines.

- [ ] **Step 5: Grep for stragglers.** Run
  `grep -rn "COOK_\|WAITING_IDLE_MS\|STUDIO_ROOT" src --include='*.ts'`. Expected: no hits.
  Fix any. Commit.

```bash
git add src/server/config.ts src/server/config.test.ts .env.example
git commit -m "refactor(config): remove cook harness and studio vars"
```

### Task 8: Drop the create_runs table with a logging migration

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/<generated>.sql` (via `npm run db:generate`)
- Modify: `packaging/CHANGELOG.md`

**Interfaces:**
- Consumes: nothing (no query references `tables.createRuns` after Task 3-4).
- Produces: no `create_runs` table in the schema; a migration that logs the row count it
  drops.

- [ ] **Step 1: Confirm no references.** Run
  `grep -rn "createRuns\|create_runs" src --include='*.ts'`. Expected: only the definition
  in `schema.ts`. If a query still references it, an earlier task is incomplete.

- [ ] **Step 2: Remove the table.** In `src/server/db/schema.ts`, delete the
  `export const createRuns = sqliteTable("create_runs", { ... }, (t) => [ ... ]);` block
  (around lines 693-707).

- [ ] **Step 3: Generate the migration.** Run `npm run db:generate`. Drizzle emits a
  `DROP TABLE` migration under `drizzle/`. Open it.

- [ ] **Step 4: Make the drop log its row count.** Drizzle's generated SQL is a bare
  `DROP TABLE`. Because migrations here run as plain SQL (better-sqlite3), add a guard that
  is honest about what it removes. Prepend to the generated file:

```sql
-- Goal 2: cook/create studio removed. create_runs held transient cook-run history only
-- (dev-local SQLite, no backup by decision). The drop is logged at migrate time by the
-- runner below; this comment records intent for anyone reading the migration.
```

  Then, in the migration runner (`src/server/db/migrate.ts` or wherever `db:migrate` reads
  files — find it with `grep -rln "migrat" src/server/db`), if the runner supports a
  pre-step hook, log `SELECT count(*) FROM create_runs` before applying. If the runner is a
  plain "apply every .sql in order" loop with no hook, do NOT over-engineer it: instead make
  the drop safe and logged by editing the generated SQL to:

```sql
-- log-and-drop create_runs (transient cook-run history)
CREATE TEMP TABLE _dropped_create_runs AS SELECT count(*) AS n FROM create_runs;
--> statement-breakpoint
DROP TABLE `create_runs`;
```

  and add one line to the migrate runner that, after running a file, checks for a
  `_dropped_create_runs` temp table and `console.log`s
  `dropped N create_runs rows` when present. If neither hook is clean, fall back to the
  simplest correct thing: keep the plain `DROP TABLE` and `console.log` the count from a
  one-off read in the runner's startup, guarded by "table exists". Pick the smallest option
  that actually prints the count once; record which you chose in the commit body.
  `ponytail:` a plain logged drop is enough here; no reversible-migration machinery.

- [ ] **Step 5: Apply and verify.** Run `npm run db:migrate` against a scratch copy of the
  DB (`cp data/crowsnest.db /tmp/g2-scratch.db && CROWSNEST_DB_PATH=/tmp/g2-scratch.db npm
  run db:migrate`). Expected: it logs the dropped count and the table is gone
  (`sqlite3 /tmp/g2-scratch.db ".tables"` shows no `create_runs`).

- [ ] **Step 6: Note it in the Kit changelog.** Add a line under the current unreleased
  section of `packaging/CHANGELOG.md`: "Removed the in-app create studio (cook/serve) and
  its create_runs table; remixing now hands off to Reel Factory through the MCP server."

- [ ] **Step 7: Run the schema tests.** `npx vitest run src/server/db` and
  `npx vitest run` on any `migrations.test.ts`. Expected: PASS. Commit.

- [ ] **Step 8: Migration-collision rule (program notice).** Goals 2/3/4/5 each add a
  migration from the same base, so numbers and `drizzle/meta/_journal.json` WILL collide. Do
  NOT hand-edit migration numbers. This task generates yours normally. The regeneration
  happens later (Task 20 and after any rebase): if `main` gained a migration since you
  generated yours, delete your generated `.sql` + its `drizzle/meta` journal/snapshot
  entries, re-run `npm run db:generate` on top of the new `main` so yours is last, and re-run
  `migrations.test.ts`. Expected merge order: G2, G3, G5, G4.

```bash
git add src/server/db/schema.ts drizzle packaging/CHANGELOG.md src/server/db
git commit -m "feat(db): drop create_runs table with a logged migration"
```

### Task 9: Remove node-pty and xterm deps and their packaging wiring

**Files:**
- Modify: `package.json`, `package-lock.json`
- Delete: `scripts/fix-node-pty-perms.mjs`
- Modify: `packaging/build-bundle.sh`
- Modify: `src/cli/kai.ts`, `src/cli/kai.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a dependency tree and packaging path with no node-pty or xterm.

- [ ] **Step 1: Drop the deps.** In `package.json` remove `node-pty`, `@xterm/xterm`,
  `@xterm/addon-fit`, and the `"postinstall": "tsx scripts/fix-node-pty-perms.mjs"` script.
  Run `npm install` to update the lockfile.

- [ ] **Step 2: Delete the perms script.** `git rm scripts/fix-node-pty-perms.mjs`.

- [ ] **Step 3: Clean the bundle script.** In `packaging/build-bundle.sh`, drop `node-pty`
  from the `run_npm rebuild better-sqlite3 node-pty` line (leave `better-sqlite3`), delete
  the `fix-node-pty-perms.mjs` invocation line, and drop `node-pty` from the natives smoke
  (`require('.../node-pty')`), keeping the `better-sqlite3` require.

- [ ] **Step 4: Clean the CLI doctor.** In `src/cli/kai.ts`, remove the
  `require(join(REPO, "node_modules", "node-pty"));` line and change the "native modules"
  doctor check to only load `better-sqlite3` (update the message from "better-sqlite3 +
  node-pty load" to "better-sqlite3 loads"). Update the matching assertion in
  `src/cli/kai.test.ts`.

- [ ] **Step 4b: Remove the dead VAULT_PATH prompt (Task 7 spillover).** `src/server/config.ts`
  no longer reads `VAULT_PATH` (it was the create studio's Obsidian vault, removed in Task 7),
  so the kit-init flow still prompting for it and writing it to `.env.local` is dead. In
  `src/cli/kai.ts` delete the four-line block (around 264-267):
  `const defaultVault = join(homedir(), ".crowsnest", "vault");`, the
  `const vault = await ask("\nVAULT_PATH", { fallback: defaultVault });`, the
  `mkdirSync(vault, { recursive: true });`, and `env = setEnv(env, "VAULT_PATH", vault);`.
  If `homedir`/`mkdirSync` become unused after this, remove them from the imports (check they
  are not used elsewhere in the file first). In `src/cli/kai.test.ts:93`, the "falls back when
  the line is blank" test uses `"VAULT_PATH"` only as an arbitrary prompt label for the generic
  `ask()` fallback behavior — rename that label to a neutral string (e.g. `"PROMPT"`) so the
  test still verifies `ask` fallback without naming a removed var. Confirm `grep -rn "VAULT_PATH" src`
  returns nothing after.

- [ ] **Step 5: Grep clean.** Run
  `grep -rn "node-pty\|xterm\|fix-node-pty" src packaging/build-bundle.sh package.json | grep -v node_modules`.
  Expected: no hits. Run `npx vitest run src/cli`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add package.json package-lock.json packaging/build-bundle.sh src/cli/kai.ts src/cli/kai.test.ts
git commit -m "chore(deps): drop node-pty and xterm, clean packaging wiring"
```

### Task 10 (Phase 1 gate): full gate + grep-clean checkpoint

- [ ] **Step 1: Reindex GitNexus** for the rename in Phase 2:
  `node .gitnexus/run.cjs analyze --index-only`.
- [ ] **Step 2: Run `node .gitnexus/run.cjs detect-changes --scope all --repo .`** and
  confirm no unexpected HIGH/CRITICAL beyond the runs.ts edit already reviewed.
- [ ] **Step 3: Run the full gate:** `npm run typecheck && npm run lint && npm run test &&
  npm run build && bash scripts/testid-audit.sh`. Expected: all green, test count below
  baseline (studio/terminal/create tests gone), no failures.
- [ ] **Step 4: Grep the DoD invariant:**
  `grep -riE "cook|ksa:|studio|create.?run" src --include='*.ts' --include='*.tsx'`.
  Every remaining hit must be one of the intended keeps: `queries/studio.ts` (renamed in
  Task 11), remix "studio" copy for `/feed/[id]/remix`, or the substring inside an unrelated
  word (`cookie`, `discover`). List each surviving hit in the phase report; anything else is
  a bug to fix before Phase 2.

- [ ] **Step 5: Push the branch early (orchestrator add).** Push so Goal 4 can merge the
  deletion in early:

```bash
git push -u origin worktree-goal-2-remove-studio-mcp
```

  Then print the compare URL (`gh repo view --json url` + the branch, or
  `gh pr create --dry-run` to surface the compare link, or the plain
  `https://github.com/<owner>/<repo>/compare/main...worktree-goal-2-remove-studio-mcp`).
  Do NOT open the PR yet (the PR opens after Task 19). Push a RESULT to the orchestrator
  and to Goal 4 (`term_e478413a`) with the compare URL and the note that Phase 1 (all
  deletion) is on the branch.

---

## Phase 2: MCP standardization

### Task 11: Rename getStudioBrief -> getPostBrief (call-graph aware)

**Files:**
- Rename: `src/server/queries/studio.ts` -> `src/server/queries/post-brief.ts` (and its
  `.test.ts`)
- Modify: `src/server/mcp/mcp-server.ts` (import + tool title/description)

**Interfaces:**
- Consumes: `getPostBrief(postId)` -> `Promise<PostBrief | null>` (same shape, renamed
  types `StudioBrief` -> `PostBrief`, `StudioRemix` -> `PostBriefRemix`).
- Produces: no "studio" identifier on the MCP path.

- [ ] **Step 1: Rename the symbol with GitNexus.** Run
  `node .gitnexus/run.cjs rename "getStudioBrief" "getPostBrief" --repo .` (call-graph
  aware; updates the definition and the `mcp-server.ts` importer). Verify with
  `grep -rn "getStudioBrief" src` -> no hits.

- [ ] **Step 2: Rename the interfaces** `StudioBrief` -> `PostBrief` and `StudioRemix` ->
  `PostBriefRemix` the same way (`node .gitnexus/run.cjs rename ...`), or by hand if they
  are file-local and GitNexus reports UNKNOWN — confirm with a text search first per
  CLAUDE.md.

- [ ] **Step 3: Move the file.** `git mv src/server/queries/studio.ts
  src/server/queries/post-brief.ts` and its test. Update the import path in
  `mcp-server.ts` to `@/server/queries/post-brief`. Refresh the file's doc comments to drop
  "studio" framing (it is now "the post brief for the Reel Factory handoff").

- [ ] **Step 4: Retitle the MCP tool.** In `mcp-server.ts`, `crowsnest_brief`: title
  "Studio brief" -> "Post brief"; description "The studio brief for a planned post" -> "The
  brief for a planned post"; and drop "a studio brief" from the server `instructions`
  string.

- [ ] **Step 5: Test.** `npx vitest run src/server/queries/post-brief.test.ts` and a
  typecheck. Expected: PASS. Commit.

```bash
git add -A src/server/queries src/server/mcp/mcp-server.ts
git commit -m "refactor(mcp): rename studio brief to post brief"
```

### Task 12: One structured-output helper + typed errors

**Files:**
- Modify: `src/server/mcp/mcp-server.ts`
- Create: `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `result(value)` and `errorResult(payload)` helpers, applied to every tool
  except the additive note on `crowsnest_plans` (Step 4).

- [ ] **Step 1: Write the failing test** at `src/server/mcp/mcp-server.test.ts`:

```ts
import { expect, test } from "vitest";

test("result() returns JSON text and structuredContent that agree", async () => {
  const { result } = await import("./mcp-server");
  const r = result({ ok: true, n: 2 });
  expect(r.content[0]).toMatchObject({ type: "text" });
  expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ ok: true, n: 2 });
  expect(r.structuredContent).toEqual({ ok: true, n: 2 });
});

test("errorResult() sets isError and carries the payload", async () => {
  const { errorResult } = await import("./mcp-server");
  const r = errorResult({ error: "not found", id: "x" });
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toMatchObject({ error: "not found", id: "x" });
});
```

- [ ] **Step 2: Run it.** `npx vitest run src/server/mcp/mcp-server.test.ts`. Expected: FAIL
  (`result`/`errorResult` not exported).

- [ ] **Step 3: Implement and export the helpers**, replacing the current `text()`:

```ts
// A tool result the SDK will surface both ways: JSON text for a text-only client, and
// structuredContent for a client that reads structured output. The two always agree
// because they come from the same value.
export function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

// A typed, non-throwing error: isError true so the caller sees a failure, with a machine
// -readable payload rather than a thrown exception crossing the MCP boundary.
export function errorResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true as const,
  };
}
```

- [ ] **Step 4: Apply to every tool.** Replace each `text(...)` call with `result(...)`, and
  each error-shaped `text({ error: ... })` with `errorResult({ error: ... })` (the
  `crowsnest_video`, `crowsnest_brief`, `crowsnest_metrics`, and
  `crowsnest_remix_save_script` not-found/failure returns). For `crowsnest_plans`: wrap its
  return in `result(...)` — this is additive (the `content[0].text` JSON is byte-identical
  to before, `structuredContent` is new and non-narrowing). Ping Goal 4 (`term_e478413a`)
  in the task report that the plans tool now also carries `structuredContent`.

- [ ] **Step 5: Test + typecheck.** `npx vitest run src/server/mcp`. Expected: PASS. Commit.

```bash
git add src/server/mcp/mcp-server.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): structured output and typed error results"
```

### Task 13: Pagination on the list tools

**Files:**
- Modify: `src/server/mcp/mcp-server.ts`
- Modify: `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: `getScripts()` and `listIdeas({tab})` (unchanged — paginate at the MCP layer).
- Produces: `crowsnest_scripts` and `crowsnest_ideas` accept `limit`/`offset` and return
  `{ total, count, items }`. `crowsnest_feed` already paginates in SQL (leave it).
  `crowsnest_plans` stays as-is (Goal 4).

- [ ] **Step 1: Write the failing test** (append to `mcp-server.test.ts`): build the server
  with `buildMcpServer()`, call `crowsnest_scripts` with `{ limit: 1, offset: 0 }` against a
  seeded in-memory DB (follow the seeding pattern in `src/server/queries/vault.test.ts`),
  and assert the result has `total >= count` and `items.length <= 1`. Run it; expect FAIL.

- [ ] **Step 2: Add pagination to `crowsnest_scripts`.** Give it an input schema
  `{ limit: z.number().optional().describe("Max items, default 50."), offset:
  z.number().optional().describe("Skip this many, for paging.") }` and slice:

```ts
async (args) => {
  const all = await getScripts();
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 50;
  const items = all.slice(offset, offset + limit);
  return result({ total: all.length, count: items.length, items });
}
```

  `ponytail:` naive in-memory slice over the full read; local single-user SQLite, swap for a
  SQL LIMIT/OFFSET in `getScripts` if the vault ever holds thousands of scripts.

- [ ] **Step 3: Add the same to `crowsnest_ideas`**, keeping its existing `tab` arg and
  slicing the `listIdeas({ tab })` array the same way with the same `total`/`count`/`items`
  envelope.

- [ ] **Step 4: Test + typecheck.** `npx vitest run src/server/mcp`. Expected: PASS. Commit.

```bash
git add src/server/mcp/mcp-server.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): paginate scripts and ideas list tools"
```

### Task 14: Source media paths for the Reel Factory handoff

**Files:**
- Modify: `src/server/mcp/mcp-server.ts`
- Modify: `src/server/mcp/mcp-server.test.ts`

**Interfaces:**
- Consumes: `getAsset(assetId)` and `resolveAssetPath(storagePath)` from
  `@/server/media/store`; `VideoDetail.videoAssetId` / `.thumbnailAssetId`. The asset row
  (`media_assets`) already stores `byteSize` (notNull) and `durationSec` (nullable).
- Produces: `crowsnest_video` and `crowsnest_brief` output carry a `media` object for the
  source and thumbnail: `{ path, byteSize, durationSec }` (path absolute, or null) so Reel
  Factory can locate and size the mp4 without a second lookup. **Never reads the file at
  request time (orchestrator add): every field comes from the stored asset row.**

- [ ] **Step 1: Write the helper + failing test.** Test (append to `mcp-server.test.ts`):
  seed a media asset with a known `byteSize` and `durationSec` (pattern from
  `src/server/media/store.test.ts`), then assert `mediaInfoFor(assetId)` returns
  `{ path: <absolute ending in the ext>, byteSize: <n>, durationSec: <n> }` and
  `mediaInfoFor(null)` returns null. Assert the helper makes no filesystem stat call (it
  reads only the DB row). Run it; expect FAIL.

- [ ] **Step 2: Implement `mediaInfoFor`** in `mcp-server.ts`:

```ts
import { getAsset, resolveAssetPath } from "@/server/media/store";

export interface MediaInfo {
  path: string | null;
  byteSize: number;
  durationSec: number | null;
}

// On-disk location and stored size/duration for a media asset id, for the Reel Factory
// handoff. Null when the id is null or the asset row is gone. Every field comes from the
// media_assets row: this NEVER stats or reads the file, and never throws across the MCP
// boundary. path is null (not an error) if the stored storagePath is somehow invalid.
async function mediaInfoFor(assetId: string | null | undefined): Promise<MediaInfo | null> {
  if (!assetId) return null;
  const asset = await getAsset(assetId);
  if (!asset) return null;
  let path: string | null;
  try {
    path = resolveAssetPath(asset.storagePath);
  } catch {
    path = null;
  }
  return { path, byteSize: asset.byteSize, durationSec: asset.durationSec ?? null };
}
```

- [ ] **Step 3: Enrich `crowsnest_video`.** After fetching `detail`, add
  `const media = await mediaInfoFor(detail.videoAssetId); const thumbnail = await
  mediaInfoFor(detail.thumbnailAssetId);` and return `result({ ...detail, media, thumbnail })`.

- [ ] **Step 4: Enrich `crowsnest_brief`.** The brief carries `video: VideoDetail | null`;
  when present, resolve and attach `media`/`thumbnail` onto that nested video the same way.
  Leave the rest of the brief unchanged.

- [ ] **Step 5: Test + typecheck.** `npx vitest run src/server/mcp`. Expected: PASS. Commit.

```bash
git add src/server/mcp/mcp-server.ts src/server/mcp/mcp-server.test.ts
git commit -m "feat(mcp): expose source media paths for the Reel Factory handoff"
```

### Task 15: Verify the zod-schema and name audit

**Files:** none (audit + fixes only)

- [ ] **Step 1: Audit every registered tool** in `mcp-server.ts`: name matches
  `^crowsnest_[a-z_]+$`; every input field has a `.describe(...)`; every tool returns
  through `result`/`errorResult`; every not-found or failure path uses `errorResult`. Fix
  any tool missing a description on an input field (add a one-line `.describe`).
- [ ] **Step 2: Confirm `structuredContent` everywhere.** Grep `mcp-server.ts` for `text(`;
  expected: no hits (all migrated to `result`/`errorResult`).
- [ ] **Step 3: Full gate.** `npm run typecheck && npm run lint && npm run test && npm run
  build`. Expected: green. Commit any audit fixes.

```bash
git add src/server/mcp/mcp-server.ts
git commit -m "refactor(mcp): audit tool schemas and output consistency"
```

---

## Phase 3: Docs

### Task 16: Write the MCP component five-doc block

**Files:**
- Create: `documents/architect/core-components/mcp/01-concept-brief.md` ... `05-backlog-to-enhance.md`
- Modify: `mkdocs.yml`, `documents/index.md`

- [ ] **Step 1: Scaffold with the skill.** Run the `document-component` skill for the `mcp`
  component. It creates the five files and the mkdocs nav entry.
- [ ] **Step 2: Fill `01`..`04` grounded in code** (`src/server/mcp/mcp-server.ts`,
  `http.ts`, `server.ts`): 01 what the MCP is and why (the Reel Factory handoff surface);
  02 architecture (in-process mount sharing the one SQLite connection, tool contract:
  `result`/`errorResult`, pagination, media paths); 03 the tool catalogue (all 19 tools,
  read vs write, inputs); 04 test cases (the `mcp-server.test.ts` cases). House-style: no
  em/en dashes, straight quotes, sentence-case headings, no invented facts.
- [ ] **Step 3: `05-backlog-to-enhance.md`** starts empty except any deferrals from the
  rounds (Task 8 migration-runner choice, pagination SQL-pushdown).
- [ ] **Step 4: Commit.**

```bash
git add documents/architect/core-components/mcp mkdocs.yml documents/index.md
git commit -m "docs(mcp): add the five-doc component block"
```

### Task 17: Archive studio docs and fix the nav

**Files:**
- Move: `documents/architect/core-components/studio/` -> `documents/archive/studio/`
- Modify: `mkdocs.yml`, `documents/index.md`

- [ ] **Step 1: Move the docs.** `git mv documents/architect/core-components/studio
  documents/archive/studio`.
- [ ] **Step 2: Remove the studio nav entry** from `mkdocs.yml` and its link from
  `documents/index.md`. Do not add the archived copy to nav (archive is frozen, not
  navigated).
- [ ] **Step 3: Verify the site builds.** If mkdocs is available, `mkdocs build --strict`
  and confirm no broken-link error for the moved studio pages. Fix any remaining internal
  link that pointed at the old studio path (repoint to the archive path or remove).
- [ ] **Step 4: Commit.**

```bash
git add documents mkdocs.yml
git commit -m "docs: archive the studio component docs"
```

### Task 18: Update README, PRODUCT.md, and business requirements

**Files:**
- Modify: `README.md` (sections 4, 5, 10, 11), `PRODUCT.md`,
  `documents/business-requirement/*` (the files that describe cook/serve)

- [ ] **Step 1: README.** In sections 4/5/10, remove cook/serve from the described loop
  (find -> analyze -> remix -> MCP handoff, not cook/publish in-app). Add a short "Connect
  the MCP" subsection with the exact line to register it from Claude Code:

```
claude mcp add crowsnest --transport http http://localhost:3000/api/mcp
```

  and one sentence that `/cn-weekly` and `/cn-remix` consume it. Confirm the transport +
  path against `src/server/mcp/http.ts` before writing the line; correct it if the endpoint
  differs.
- [ ] **Step 2: PRODUCT.md.** In "Product Purpose", "Capabilities and Constraints", and
  "Terminology", drop "cook" from the terminology list and rewrite the loop sentence so it
  ends at the remix -> MCP handoff; keep read key, channel, sync, vault, remix. Do not
  invent a Reel Factory capability the app does not ship; describe the MCP as the handoff.
- [ ] **Step 3: Business requirements.** Grep
  `grep -rniE "cook|serve|studio" documents/business-requirement` and rewrite the hits so
  no delivered-capability claim references the removed studio. House-style throughout.
- [ ] **Step 4: Commit.**

```bash
git add README.md PRODUCT.md documents/business-requirement
git commit -m "docs: retire cook/serve from README, product, and requirements"
```

### Task 19: End-to-end skill check (DoD)

**Files:** none (verification)

- [ ] **Step 1: Bring the stack up** (`/crowsnest-up`, or `npm run dev` in a pane) against
  the main-tree DB copied in for real data.
- [ ] **Step 2: Run `/cn-weekly`** far enough to confirm `crowsnest_feed`, `crowsnest_video`,
  `crowsnest_ideas`, `crowsnest_metrics` all answer through the MCP with the new structured
  output. Record the tool responses as evidence.
- [ ] **Step 3: Run `/cn-remix`** one full pass on a real video: `crowsnest_feed` ->
  `crowsnest_video` -> `crowsnest_remix_session` -> ... -> `crowsnest_remix_finish`, and
  confirm the finish returns a planned post id and `crowsnest_brief` on it now carries the
  `media` object with `path`, `byteSize`, `durationSec`. Save the transcript under
  `evidence/mcp/`.
- [ ] **Step 4: Report** any tool that failed as a `05-backlog` row, not a silent skip.

### Task 20: Open the PR (ship:finishing-a-development-branch)

**Files:** none (git + gh)

- [ ] **Step 1: Final gate + verification.** Run `ship:verification-before-completion`, then
  the full gate: `npm run typecheck && npm run lint && npm run test && npm run build &&
  bash scripts/testid-audit.sh`. Working tree clean.
- [ ] **Step 2: `detect-changes` regression review** (controller runs the GitNexus MCP
  `detect_changes` with `scope: "compare"`, `base_ref: "main"`; the CLI runner is absent in
  this worktree).
- [ ] **Step 2b: Regenerate the migration on latest main (program notice).** If `main` gained
  a migration since Task 8 generated yours (check `git log origin/main -- drizzle`), delete
  your generated `.sql` and its `drizzle/meta` journal/snapshot entries, re-run
  `npm run db:generate` on top of the current `main` so yours is numbered last, and re-run
  `migrations.test.ts` (green). Record the main SHA you regenerated on.
- [ ] **Step 3: Open the PR** with `gh pr create --base main`. NEVER self-merge (Kai merges).
  The body MUST include (orchestrator requirements): a list of **every deleted file**
  (generate with `git diff --diff-filter=D --name-only main...HEAD`), the **migration
  row-count line** printed by `db:migrate` when it dropped `create_runs`, and the line
  **`migration regenerated on <main sha>`**. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Push RESULT with the PR URL**, and ping Goal 3 (`term_97cb131c`) and Goal 4
  (`term_e478413a`) that the PR is open (Goal 4 may merge early; Goal 3 enhances `/runs`
  after merge).

---

## Definition of done (Round 0)

- `src/server/terminal`, `src/server/studio`, the studio route, cook/serve UI,
  node-pty/xterm deps, and the ws upgrade in `server.ts` are gone.
- `grep -riE "cook|serve|studio|ksa:" src` returns only the intentional hits listed in
  Task 10 Step 4.
- Migration for the dropped `create_runs` table, logging its row count; CHANGELOG noted.
- All 19 MCP tools: described zod schemas, `crowsnest_*` names, `result`/`errorResult`
  output, pagination on `crowsnest_scripts` and `crowsnest_ideas`.
- `documents/architect/core-components/mcp/01..05` written; studio docs archived; README +
  PRODUCT.md + mkdocs nav updated.
- `/cn-weekly` and `/cn-remix` each run once end to end against the MCP (Task 19).
- Full gate green; working tree clean; PR opened.

## Self-review notes

- Spec coverage: deletion (Tasks 1-9), migration (8), `/runs` keep with create removed (3),
  MCP standardize (11-15), Reel Factory media handoff (14), plans read-only preserved (12
  Step 4), docs (16-18), skills e2e (19). All spec outcomes mapped.
- Type consistency: `RunType` loses `"create"` (Task 3) and nothing else references it;
  `getStudioBrief`/`StudioBrief` -> `getPostBrief`/`PostBrief` consistently (Task 11);
  `result`/`errorResult` names used identically in Tasks 12-14.
- Open judgment call flagged for the executor: Task 8 Step 4 migration-runner logging shape
  (pick the smallest correct option, record which). Per orchestrator rule, take the ponytail
  default and note the assumption if unresolved.
