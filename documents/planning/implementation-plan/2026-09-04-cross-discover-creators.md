---
status: active
components: [discover, shared]
backlog: none
owner: Goal 5 lead (opus) — session_01Sx1bicD14WGgTi8b4h9Joh
shipped: null
---

# Discover Creators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended), or execute the plan directly in this session — phase by phase, verifying each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a fresh install a fast on-ramp to value: a curated, preseeded list of ~100 creators across four niches the user can browse, filter, and follow in one click (follow = add channel + queue sync), plus a drop-in seed-picker for first-run.

**Architecture:** Curated static seed files under `data/seeds/*.json` (handle + niche + why + source, no metrics) are verified against the live sidecar `/profile` at authoring time, then loaded idempotently into a new `creator_seeds` table by `npm run db:bootstrap`. A new `/channels/discover` surface reads the table (with an "already tracked" flag), a niche filter, and a Follow button that calls the existing `addChannelAction` then `startSyncAction`. A self-contained `seed-picker` component is exported for Goal 1 to mount in first-run without any first-run edits by us. The feed -> idea -> copy-to-LLM journey reuses `export.ts` unchanged and its one-click wiring is deferred until Goal 1 wave 3 merges `/feed` + `/ideas`.

**Tech Stack:** Next 16 (custom `tsx server.ts`), React server components + server actions, drizzle-orm / better-sqlite3, drizzle-kit migrations, vitest, Tailwind (Instrument Panel design tokens), instagrapi sidecar.

**Spec:** This plan (Goal 5 brief `/tmp/crowsnest-goals/goal-5-analyze-value.md` + brainstorm gate, option (a), approved by orchestrator). No separate spec doc — the brief + DoD in `/tmp/crowsnest-goals/01-dod-and-rounds.md` are the source.

## Global Constraints

- No fabricated data. Seeds carry `handle`, `niche`, `why` (curation rationale, not a metric), `source` (URL verified from). Metrics come only from sync. A capability the app lacks does not appear in the UI.
- Every seed handle MUST be verified to exist via the sidecar (`igClient.profile(handle)`) before its row is committed; drop any that fail.
- Niches (exactly these four, 25 each = 100): `fitness`, `finance`, `tech`, `business`.
- Design system BINDING (DESIGN.md Instrument Panel): amber `--primary` only on the score + one primary action per screen; square corners; IBM Plex Mono tabular numbers; flat depth (no shadow on dark). Follow is the one primary (amber) action on the discover card. Niche filter, tabs, badges = neutral surfaces. Never `colorize`/`delight`/`bolder`.
- This is NOT stock Next.js — read `node_modules/next/dist/docs/` before app-code changes. App origin is `http://localhost:3000`, never `127.0.0.1`.
- Ownership: build ONLY in new files + our owned surfaces (`/channels`, new routes). Do NOT edit `/feed`, `/ideas`, `/first-run`, `src/server/mcp/*`. `nav-items.ts` is shared — one-line addition only, flagged as a conflict note.
- Gate before every commit: `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Working tree clean.
- Commit footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Sx1bicD14WGgTi8b4h9Joh
  ```

## File map

- Create `src/server/db/schema.ts` addition: `creatorSeeds` table (edit schema.ts, append).
- Create `drizzle/00NN_creator_seeds.sql` via `npm run db:generate`.
- Create `data/seeds/fitness.json`, `finance.json`, `tech.json`, `business.json`.
- Create `data/seeds/README.md` (shape + curation rule).
- Create `scripts/verify-seeds.ts` (sidecar existence check, drop failures).
- Modify `src/server/db/bootstrap.ts` (add `bootstrapCreatorSeeds`, call from CLI entry).
- Create `src/server/queries/discover.ts` (`listCreatorSeeds`).
- Create `src/server/actions/discover-actions.ts` (`followCreatorAction`).
- Create `src/app/(shell)/channels/discover/page.tsx`.
- Create `src/components/discover/discover-board.tsx`, `creator-seed-card.tsx`, `seed-picker.tsx`.
- Modify `src/components/layout/nav-items.ts` (one nav row — shared file).
- Create `documents/architect/core-components/discover/01..05` + modify README, PRODUCT.md, business-requirement, mkdocs.yml.

---

## Task 1: `creator_seeds` schema + migration

**Files:**
- Modify: `src/server/db/schema.ts` (append table)
- Create: `drizzle/00NN_creator_seeds.sql` (generated)
- Test: `src/server/db/schema.test.ts` (extend) or new assertion in `migrations.test.ts`

**Interfaces:**
- Produces: `tables.creatorSeeds` with columns `id` (text pk), `platform` (text notNull default "instagram"), `handle` (text notNull), `niche` (text notNull), `why` (text notNull), `source` (text), `createdAt` (text notNull). Unique index `creator_seeds_platform_handle` on `(platform, handle)`.

- [ ] **Step 1: Write the failing test** — assert the table + unique index exist after migrate.

```ts
// src/server/db/schema.test.ts (add)
import { creatorSeeds } from "./schema";
test("creator_seeds table is defined with platform+handle unique key", () => {
  expect(creatorSeeds).toBeDefined();
  // drizzle table config carries the columns
  const cols = Object.keys(creatorSeeds);
  for (const c of ["id", "platform", "handle", "niche", "why", "source", "createdAt"]) {
    expect(cols).toContain(c);
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/server/db/schema.test.ts` → FAIL (`creatorSeeds` undefined).

- [ ] **Step 3: Add the table** to `schema.ts` (near `savedFilters`), following the file's existing style:

```ts
export const creatorSeeds = sqliteTable("creator_seeds", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull().default("instagram"),
  handle: text("handle").notNull(),
  niche: text("niche").notNull(), // "fitness" | "finance" | "tech" | "business"
  why: text("why").notNull(),     // curation rationale, never a metric
  source: text("source"),          // URL the handle was verified from
  createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("creator_seeds_platform_handle").on(t.platform, t.handle),
]);
```

- [ ] **Step 4: Generate + verify migration** — `npm run db:generate` (creates `drizzle/00NN_creator_seeds.sql`). Inspect it: one `CREATE TABLE creator_seeds` + one `CREATE UNIQUE INDEX`. Then `npx vitest run src/server/db/schema.test.ts src/server/db/migrations.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/server/db/schema.ts drizzle/ src/server/db/schema.test.ts && git commit`.

---

## Task 2: seed data files + curation

**Files:**
- Create: `data/seeds/fitness.json`, `data/seeds/finance.json`, `data/seeds/tech.json`, `data/seeds/business.json`
- Create: `data/seeds/README.md`
- Test: `src/server/db/seeds.test.ts` (shape + count validation over the JSON files)

**Interfaces:**
- Produces: each file is `{ "niche": string, "label": string, "creators": { "handle": string, "why": string, "source": string }[] }`. `niche` matches the filename stem and one of the four allowed values. Loader in Task 3 relies on this exact shape.

- [ ] **Step 1: Write the failing test** — validates every seed file's shape, niche match, and that handles are non-empty and unique within a niche.

```ts
// src/server/db/seeds.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const NICHES = ["fitness", "finance", "tech", "business"] as const;
const DIR = join(process.cwd(), "data/seeds");

test.each(NICHES)("seed file %s is well-formed", (niche) => {
  const raw = JSON.parse(readFileSync(join(DIR, `${niche}.json`), "utf8"));
  expect(raw.niche).toBe(niche);
  expect(typeof raw.label).toBe("string");
  expect(Array.isArray(raw.creators)).toBe(true);
  const handles = new Set<string>();
  for (const c of raw.creators) {
    expect(c.handle).toMatch(/^[A-Za-z0-9._]+$/); // normalized, no @
    expect(typeof c.why).toBe("string");
    expect(c.why.length).toBeGreaterThan(0);
    expect(typeof c.source).toBe("string");
    expect(handles.has(c.handle.toLowerCase())).toBe(false);
    handles.add(c.handle.toLowerCase());
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — files don't exist yet → FAIL.

- [ ] **Step 3: Draft the four files.** Curate ~30 real, well-known public creators per niche (draft over 25 so post-verification drops still leave >= 25). Each entry: normalized handle (no `@`), a one-line `why` (rationale, e.g. "high-retention form-check reels", NOT "1.2M followers"), and a `source` URL (the instagram.com/<handle> or listicle you took it from). Also write `data/seeds/README.md`: the shape, the four niches, the no-metrics rule, and "handles are verified against the sidecar by `scripts/verify-seeds.ts` before commit."

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/server/db/seeds.test.ts` → PASS.

- [ ] **Step 5: Commit** (files land in Task 2b after verification — do NOT commit unverified handles yet; hold this commit until Task 2b passes).

---

## Task 2b: sidecar handle verification (BAN-VECTOR SENSITIVE)

**Files:**
- Create: `scripts/verify-seeds.ts`

**Interfaces:**
- Consumes: `data/seeds/*.json`, `igClient` from `@/server/ig/client`.
- Produces: marks each resolved creator with `"verified": true` in place and drops handles that fail with a not-found error; prints a report (verified / dropped / remaining per niche).

**ORCHESTRATOR CONSTRAINT (a):** The sidecar signs in as the THROWAWAY account. 100+ profile
lookups is a ban vector. This script MUST:
- Space lookups >= 3s apart.
- Be resumable: skip any creator already `"verified": true` in the file, so a re-run continues
  rather than re-hitting every handle. Write the file after each niche so progress persists.
- STOP immediately on a challenge/login error (IgError codes for challenge/login-required) and
  report which handle it stopped on — do NOT keep hammering after a challenge.
- Never run while a sync is in flight against the same sidecar. BEFORE running: check `/runs`
  (or `getSyncProgressAction()` → no `running` job) and abort with a message if one is active.

- [ ] **Step 1: Write the script.** Requires a running sidecar with a logged-in session (`/profile` needs `require_login`). Precheck no running sync; per creator: skip if already verified, else `igClient.profile(handle)`; on success mark `verified: true`; on a not-found error drop it and log; on a challenge/login error stop the whole run and report. >= 3s spacing. Persist after each niche.

```ts
// scripts/verify-seeds.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { igClient } from "@/server/ig/client";
import { IgError } from "@/server/ig/errors";
import { getSyncProgressAction } from "@/server/actions/sync-actions";

const NICHES = ["fitness", "finance", "tech", "business"];
const DIR = join(process.cwd(), "data/seeds");
const SPACING_MS = 3200; // orchestrator: >= 3s to protect the throwaway account
// Codes that mean "the account is being challenged / logged out" — stop, do not continue.
const STOP_CODES = new Set(["IG_CHALLENGE_REQUIRED", "IG_LOGIN_REQUIRED"]);

async function run() {
  const progress = await getSyncProgressAction();
  if (progress.ok && progress.progress?.status === "running") {
    console.error("A sync is running — refusing to verify seeds against a busy sidecar. Check /runs.");
    process.exit(1);
  }
  for (const niche of NICHES) {
    const path = join(DIR, `${niche}.json`);
    const file = JSON.parse(readFileSync(path, "utf8"));
    const kept: Record<string, unknown>[] = [];
    let dropped = 0;
    for (const c of file.creators as Record<string, unknown>[]) {
      if (c.verified === true) { kept.push(c); continue; } // resumable: skip already-verified
      try {
        await igClient.profile(String(c.handle));
        kept.push({ ...c, verified: true });
      } catch (err) {
        if (err instanceof IgError && STOP_CODES.has(err.code)) {
          file.creators = [...kept, ...file.creators.slice(file.creators.indexOf(c))];
          writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
          console.error(`CHALLENGE at ${niche}/${String(c.handle)} (${err.code}) — stopping. Re-run later to resume.`);
          process.exit(2);
        }
        dropped += 1;
        console.warn(`DROP ${niche}/${String(c.handle)}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    file.creators = kept;
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    console.log(`${niche}: verified ${kept.length}, dropped ${dropped}`);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against a live sidecar** — `npx tsx scripts/verify-seeds.ts`. Requires the sidecar up, a valid session, and NO running sync. If it stops on a challenge, wait and re-run (it resumes). Confirm each niche keeps >= 25; top up + re-run only the unverified if a niche falls short.

- [ ] **Step 3: Re-run the shape test** — extend `seeds.test.ts` to also assert every committed creator has `verified: true`; `npx vitest run src/server/db/seeds.test.ts` → PASS.

- [ ] **Step 4: Commit** the four verified seed files + README + `scripts/verify-seeds.ts` together.

---

## Task 3: seed loader in `bootstrap.ts`

**Files:**
- Modify: `src/server/db/bootstrap.ts`
- Test: `src/server/db/bootstrap.test.ts` (extend)

**Interfaces:**
- Consumes: `tables.creatorSeeds` (Task 1), `data/seeds/*.json` (Task 2b).
- Produces: `bootstrapCreatorSeeds(): Promise<{ created: number; existing: number }>` — idempotent, keyed on `(platform, handle)`, mirroring `bootstrapSystemFilters`. Called from the CLI entry alongside the filters.

- [ ] **Step 1: Write the failing test** — running twice creates on first pass, zero-creates on second.

```ts
// src/server/db/bootstrap.test.ts (add)
import { bootstrapCreatorSeeds } from "./bootstrap";
test("creator seeds load idempotently", async () => {
  const first = await bootstrapCreatorSeeds();
  expect(first.created).toBeGreaterThanOrEqual(100);
  const second = await bootstrapCreatorSeeds();
  expect(second.created).toBe(0);
  expect(second.existing).toBe(first.created);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/server/db/bootstrap.test.ts` → FAIL (function undefined).

- [ ] **Step 3: Implement** — read the four files, upsert-by-select like `SYSTEM_FILTERS`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
// ...
const SEED_NICHES = ["fitness", "finance", "tech", "business"] as const;

export async function bootstrapCreatorSeeds(): Promise<{ created: number; existing: number }> {
  let created = 0, existing = 0;
  for (const niche of SEED_NICHES) {
    const file = JSON.parse(readFileSync(join(process.cwd(), "data/seeds", `${niche}.json`), "utf8"));
    for (const c of file.creators as { handle: string; why: string; source?: string }[]) {
      const handle = c.handle.trim().replace(/^@/, "");
      const found = await db
        .select({ id: tables.creatorSeeds.id })
        .from(tables.creatorSeeds)
        .where(and(eq(tables.creatorSeeds.platform, "instagram"), eq(tables.creatorSeeds.handle, handle)))
        .limit(1);
      if (found[0]) { existing += 1; continue; }
      await db.insert(tables.creatorSeeds).values({
        id: newId(), platform: "instagram", handle, niche: file.niche, why: c.why,
        source: c.source ?? null, createdAt: nowIso(),
      });
      created += 1;
    }
  }
  return { created, existing };
}
```

- [ ] **Step 4: Wire the CLI entry** — in the `bootstrap.ts` main block, also run `bootstrapCreatorSeeds()` and log its counts. `npm run db:bootstrap` now loads filters + seeds.

- [ ] **Step 5: Run test + bootstrap** — `npx vitest run src/server/db/bootstrap.test.ts` → PASS. Commit.

---

## Task 4: discover query

**Files:**
- Create: `src/server/queries/discover.ts`
- Test: `src/server/queries/discover.test.ts`

**Interfaces:**
- Consumes: `tables.creatorSeeds`, `tables.channels`.
- Produces: `listCreatorSeeds(opts?: { niche?: string }): Promise<CreatorSeedRow[]>` where `CreatorSeedRow = { handle: string; niche: string; why: string; source: string | null; tracked: boolean }`. `tracked` is true when a non-deleted `channels` row already exists for `(instagram, handle)`. Niche filter optional. Ordered by niche, then handle.

- [ ] **Step 1: Write the failing test** — seed two creators, track one, assert `tracked` flags + niche filter.

```ts
// src/server/queries/discover.test.ts
import { expect, test } from "vitest";
import { db, newId, nowIso, tables } from "@/server/db";
import { listCreatorSeeds } from "./discover";

test("lists seeds with tracked flag and niche filter", async () => {
  await db.insert(tables.creatorSeeds).values([
    { id: newId(), platform: "instagram", handle: "alpha", niche: "tech", why: "w", source: null, createdAt: nowIso() },
    { id: newId(), platform: "instagram", handle: "beta", niche: "fitness", why: "w", source: null, createdAt: nowIso() },
  ]);
  await db.insert(tables.channels).values({
    id: newId(), platform: "instagram", handle: "alpha", trackedSince: nowIso(),
  });
  const tech = await listCreatorSeeds({ niche: "tech" });
  expect(tech).toHaveLength(1);
  expect(tech[0]).toMatchObject({ handle: "alpha", tracked: true });
  const all = await listCreatorSeeds();
  expect(all.find((r) => r.handle === "beta")?.tracked).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with a left join on `channels` (`isNull(deletedAt)`), computing `tracked` from the joined id.
- [ ] **Step 4: Run → PASS. Commit.**

---

## Task 5: follow action (add + queue sync)

**Files:**
- Create: `src/server/actions/discover-actions.ts`
- Test: `src/server/actions/discover-actions.test.ts`

**Interfaces:**
- Consumes: `addChannelAction`, `startSyncAction` from `@/server/actions/sync-actions`; `db`/`tables` for the tracked check; `normalizeHandle` from `@/server/services/sync-engine`.
- Produces: `followCreatorAction(handle: string): Promise<ActionResult<{ channelId: string; syncQueued: boolean; alreadyTracked: boolean }>>`.

**ORCHESTRATOR CONSTRAINT (b):** Must be idempotent — a handle already tracked (non-deleted
`channels` row) is a no-op: return `alreadyTracked: true, syncQueued: false` WITHOUT starting a
fresh sync. Only a genuinely new follow adds + queues a channel-scoped sync. `syncQueued`
reflects whether `startSyncAction([channelId])` returned ok (a sync already running is not a
failure — `syncQueued: false`, still `ok: true`). (The 10-at-a-time batch cap lives in the
seed-picker, Task 8, not here — this action is single-handle.)

- [ ] **Step 1: Write the failing test** — three cases: (i) new handle → add + start, `alreadyTracked:false`; (ii) already-tracked handle → no add, no start, `alreadyTracked:true, syncQueued:false`; (iii) new handle but sync already running → `ok:true, syncQueued:false`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**:

```ts
"use server";
import { and, eq, isNull } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { normalizeHandle } from "@/server/services/sync-engine";
import { addChannelAction, startSyncAction } from "./sync-actions";
import type { ActionResult } from "@/server/lib/action-result";

export async function followCreatorAction(
  handle: string
): Promise<ActionResult<{ channelId: string; syncQueued: boolean; alreadyTracked: boolean }>> {
  let normalized: string;
  try { normalized = normalizeHandle(handle); }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }

  const existing = await db
    .select({ id: tables.channels.id })
    .from(tables.channels)
    .where(and(eq(tables.channels.platform, "instagram"), eq(tables.channels.handle, normalized), isNull(tables.channels.deletedAt)))
    .limit(1);
  if (existing[0]) return { ok: true, channelId: existing[0].id, syncQueued: false, alreadyTracked: true };

  const added = await addChannelAction(normalized);
  if (!added.ok) return added;
  const sync = await startSyncAction([added.channelId]);
  return { ok: true, channelId: added.channelId, syncQueued: sync.ok, alreadyTracked: false };
}
```

- [ ] **Step 4: Run → PASS. Commit.**

---

## Task 6: Discover surface (route + board + card)

**Files:**
- Create: `src/app/(shell)/channels/discover/page.tsx`
- Create: `src/components/discover/discover-board.tsx`
- Create: `src/components/discover/creator-seed-card.tsx`
- Test: `src/components/discover/creator-seed-card.test.tsx` (queued-state transition)

**Interfaces:**
- Consumes: `listCreatorSeeds`, `followCreatorAction`.
- Produces: `/channels/discover` server page loads seeds + passes to `DiscoverBoard` (client). Board renders a neutral niche filter (all / fitness / finance / tech / business) and a grid of `CreatorSeedCard`. Card shows `@handle`, niche badge (neutral), `why`, and a Follow button (the one amber primary action). On click → `followCreatorAction`; button transitions Follow → "Queued…" → "Tracked" (disabled) with a visible queued state; a `tracked` seed renders "Tracked" disabled from the start. All `data-testid`s present (testid-audit).

- [ ] **Step 1: Write the failing component test** — render a card, click Follow (mock action resolving `{ ok: true, syncQueued: true }`), assert it shows a queued then tracked state and disables.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Build** the card (client), board (client, holds niche filter state), and the server page. Design per Instrument Panel: square cards, `why` in body, handle in mono, niche badge on a raised neutral surface (NOT amber), Follow = `bg-primary text-primary-foreground` pill (the single amber action per card is acceptable — it is the primary action of that unit; ensure no other amber on the screen). Empty state ("run `npm run db:bootstrap` to load creators") + a loading state for the follow transition. Add `data-testid` on card, follow button, niche filter.
- [ ] **Step 4: Run → PASS.** Then `npm run build` to confirm the route compiles.
- [ ] **Step 5: Commit.**

---

## Task 7: reachability (nav + channels link)

**Files:**
- Modify: `src/components/layout/nav-items.ts` (shared — one line)
- Modify: `src/app/(shell)/channels/page.tsx` (header link to Discover) — our owned route

- [ ] **Step 1:** Add `{ href: "/channels/discover", label: "Discover", icon: Compass, group: "Sources" }` to `NAV_ITEMS` (import `Compass` from lucide-react), placed right after Channels. CONFLICT NOTE: shared file with Goal 1 — keep the diff to this one row + the icon import to minimize merge conflict.
- [ ] **Step 2:** Add a "Discover creators" link/button in the channels page header pointing at `/channels/discover`.
- [ ] **Step 3:** `npm run build` → route reachable from sidebar + ⌘K palette. Manual: open `http://localhost:3000/channels/discover`.
- [ ] **Step 4: Commit.**

---

## Task 8: drop-in seed-picker for first-run (no first-run edits)

**Files:**
- Create: `src/components/discover/seed-picker.tsx`
- Test: `src/components/discover/seed-picker.test.tsx`

**Interfaces:**
- Produces: `SeedPicker({ seeds, onDone, maxSelect }: { seeds: CreatorSeedRow[]; onDone?: (channelIds: string[]) => void; maxSelect?: number })` — self-contained, no router or first-run imports. Niche filter + multi-select of seeds + a "Follow selected" button that calls `followCreatorAction` per pick and reports the resulting channel ids via `onDone`. Goal 1 mounts this in the sources step.

**ORCHESTRATOR CONSTRAINT (b/c):** Export from `src/components/discover/seed-picker.tsx` with
props `{ onDone, maxSelect }`. Cap batch follows to protect the throwaway account: default
`maxSelect = 10`, and never follow more than that in one "Follow selected" action (disable
further selection past the cap, with a visible "up to N at a time" hint). After the batch lands,
push a RESULT with the exact import path (`@/components/discover/seed-picker`) + the props
signature so the orchestrator can hand it to Goal 1.

- [ ] **Step 1: Write the failing test** — (i) select two seeds, click Follow selected (mock action), assert `onDone` fires with two ids; (ii) with `maxSelect=10`, assert an 11th selection is blocked.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Build** the component. Same Instrument Panel discipline; no dependency on `/channels/discover` internals beyond the shared `CreatorSeedRow` type + `followCreatorAction`. Enforce `maxSelect` (default 10) on selection and on the batch follow.
- [ ] **Step 4: Run → PASS. Commit.** Push a RESULT to the orchestrator with the import path (`@/components/discover/seed-picker`) + props `{ onDone, maxSelect }` for Goal 1.

---

## Task 9: docs + five-doc block

**Files:**
- Create: `documents/architect/core-components/discover/01-overview.md` … `05-backlog-to-enhance.md`
- Modify: `README.md` (sections 4 Features + 5 journey), `PRODUCT.md` (capabilities), `documents/business-requirement/product-document.md`, `mkdocs.yml` (nav)

- [ ] **Step 1:** Run `/crowsnest-document-component` (or scaffold by hand) for the `discover` component, grounded to the code in Tasks 1-8, house-style compliant (no em/en dashes, straight quotes, sentence-case headings, evergreen, no invented metrics).
- [ ] **Step 2:** README: add "Discover creators" to Features (§4) and a "pick a niche → follow creators → first sync" branch to the journey (§5). PRODUCT.md: add the discover capability under Capabilities. business-requirement/product-document.md: add the feature row. mkdocs.yml: add the discover component to nav.
- [ ] **Step 3:** `mkdocs build` (or `mkdocs serve`) clean; `npm run lint`/docs checks pass.
- [ ] **Step 4: Commit.**

---

## Deferred (gated on Goal 1 wave 3 merge — do NOT build until orchestrator notifies)

Feed -> idea -> copy-to-LLM in <= 3 clicks: `/feed` and `/ideas` pages are Goal 1's until wave 3. The brief format is the existing `export.ts` markdown (`buildVideoPrompt`), reused unchanged. After wave 3: add a direct "Copy brief for Claude" affordance on the feed row and/or idea card so the path from a feed row to clipboard is <= 3 clicks, and measure the click count on the built pages. Record as a `05-backlog-to-enhance.md` entry until then.

---

## Self-Review

- Spec coverage vs Goal 5 DoD: seeds >=100 via `db:bootstrap` (T1-T3 ✓); one-click follow → queued for sync (T5-T6 ✓, visible queued state per orchestrator ✓); niche filter + why shown (T6 ✓, per orchestrator); drop-in first-run picker (T8 ✓, no first-run edits per ruling); five-doc block + README 4/5 + PRODUCT + business-req (T9 ✓); evidence/discover screenshots (Round 1). feed->idea->LLM <=3 clicks = deferred, tracked (gated on wave 3, orchestrator-approved).
- Placeholder scan: no TBD/TODO; each code step carries real code or a concrete curation action.
- Type consistency: `CreatorSeedRow` defined in T4, reused in T6/T8; `followCreatorAction` signature stable across T5/T6/T8; `creatorSeeds` columns stable T1→T3.
- Assumptions (ponytail defaults where orchestrator silent): new `creator_seeds` table (option A) over static-file-only; `/channels/discover` as a route + nav row over a tab; verify script uses a fixed 1.5s delay.
