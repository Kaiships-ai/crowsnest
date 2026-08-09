# Ideas loop implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ideas loop from the spec: a video-detail summary, two new feed filters, a Persona surface, an Ideas inbox generated from analyzed outliers, and a keyboard command menu.

**Architecture:** Additive only. One `summary` column on `video_analyses`, a single-row `persona` table, and a new `idea` table. The idea generator is one service function that reads a video analysis plus the persona and calls the existing LLM client. Create-script reuses the existing `remix_sessions` flow. UI follows the shipped component patterns (shadcn Tabs, the `filter-bar` search-params model, the `NAV_ITEMS` array, file-per-settings-section).

**Tech Stack:** Next.js 16 (app router, server actions), drizzle-orm + better-sqlite3, vitest, shadcn/ui, Tailwind. LLM through the existing `@/server/llm` client (local 9router proxy).

Source spec: `docs/superpowers/specs/2026-08-09-ideas-and-persona-spec.md`. This plan covers U1 to U5. U6 (the MCP server) is a separate plan.

## Global constraints

- This is NOT the Next.js you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing route or server-action code. Heed deprecation notices.
- Migrations are generated, never hand-written: `npm run db:generate` writes a numbered file in `drizzle/` plus a snapshot in `drizzle/meta/`; `npm run db:migrate` applies it. Do not edit a shipped migration; write a new forward one.
- npm and node are not on the Bash PATH by default. Run `export PATH="/opt/homebrew/bin:$PATH"` first.
- Every server action returns a discriminated union `{ ok: true, ... } | { ok: false; error: string; code?: string }` and never throws across the boundary. Copy the `errorMessage` helper shape from `src/server/actions/saved-post-actions.ts`.
- Tests use the real `:memory:` db. Set `process.env.CROWSNEST_DB_PATH = ":memory:"` before importing `@/server/db`, then call `migrate()` from `@/server/db/test-migrate` to build the schema from `./drizzle`. `src/test/setup-env.ts` sets `LOG_LEVEL=error`; a test that asserts on an info-level log must set `LOG_LEVEL=info` around the run and restore it.
- This repo does not render-test client components that use hooks. Service, query, and action tasks get vitest tests. Component tasks are gated on `tsc`, `lint`, and a browser check (bring the stack up with `/crowsnest-up`, browse `http://localhost:3000`, never 127.0.0.1).
- Amber law (docs/design/DESIGN-SYSTEM.md): amber only on a score badge or exactly one primary action per screen. Active nav is `--card` + a 2px `--line-strong` left bar, never amber. Sidebar count badges are neutral. Numbers are IBM Plex Mono, tabular. Buttons and copy are sentence case.
- Vocabulary: score (not multiplier), post (not video in copy), Sync, My channel, local service.
- Commit per task with `git commit -m "msg" -- <paths>` (name the paths, do not `git add .`).

## File structure

New files:
- `src/server/services/ideas.ts` — idea generation and the inbox query helpers.
- `src/server/services/ideas.test.ts` — generator + query tests.
- `src/server/services/persona.ts` — `getPersona` / `upsertPersona`, seed-from-niche.
- `src/server/services/persona.test.ts`
- `src/server/actions/idea-actions.ts` — generate, set status, notes, create-script-from-idea.
- `src/server/actions/persona-actions.ts` — save persona.
- `src/server/queries/ideas.ts` — `listIdeas` (inbox / shortlist), `getIdea`.
- `src/app/(shell)/ideas/page.tsx` — the inbox route.
- `src/components/ideas/idea-inbox.tsx` — two-pane inbox (client).
- `src/components/ideas/command-menu.tsx` — the keyboard command menu (client).
- `src/app/(shell)/persona/page.tsx` — the Persona route.
- `src/components/settings/persona-section.tsx` — the Persona form (client), reused on the Persona page.

Modified files:
- `src/server/db/schema.ts` — add `summary` to `videoAnalyses`; add `persona` and `idea` tables.
- `src/components/video/video-detail.tsx` — summary block, transcript word count.
- `src/components/feed/filter-bar.tsx` and `src/lib/feed-filters.ts` — engagement + analyzed filters, Add video URL.
- `src/server/queries/feed.ts` — `buildWhere` handles the two new filters.
- `src/components/layout/nav-items.ts` — add Ideas and Persona, add the `Setup` group.
- `src/server/services/remix.ts` — generation reads the persona; `seedSessionFromIdea`.
- `src/server/actions/remix-actions.ts` — expose the idea seed path if not already reachable.

---

## Task 1: Add the `summary` column to `video_analyses`

**Files:**
- Modify: `src/server/db/schema.ts:183-216`
- Generate: `drizzle/00NN_*.sql` (via db:generate)

**Interfaces:**
- Produces: `tables.videoAnalyses.summary` (nullable `text`), read by Task 2 and Task 7.

- [ ] **Step 1: Add the column to the schema**

In `src/server/db/schema.ts`, inside `videoAnalyses`, add after `whyItWorked`:

```ts
  whyItWorked: text("why_it_worked"),
  summary: text("summary"),
```

- [ ] **Step 2: Generate the migration**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` adding `summary` to `video_analyses`, plus a `drizzle/meta/` snapshot.

- [ ] **Step 3: Apply it to the dev db**

Run: `npm run db:migrate`
Expected: applies clean, no error.

- [ ] **Step 4: Verify the column exists**

Run: `sqlite3 data/crowsnest.db "PRAGMA table_info(video_analyses);" | grep summary`
Expected: one row naming `summary`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(schema): add summary column to video_analyses" -- src/server/db/schema.ts drizzle/
```

---

## Task 2: Video-detail summary block and transcript word count

**Files:**
- Modify: `src/components/video/video-detail.tsx:459-465` (tabs) and the stat header region
- Modify: `src/server/queries/video.ts` (include `summary` in the analysis select if not already `select()`-all)

**Interfaces:**
- Consumes: `detail.analysis.summary` (string | null) and `detail.transcript` (string | null).

- [ ] **Step 1: Confirm the query returns summary**

Read `src/server/queries/video.ts`. If the analysis is fetched with an explicit column list, add `summary: tables.videoAnalyses.summary`. If it uses `select()` (all columns), no change is needed. Note which case applies.

- [ ] **Step 2: Render the summary block above the tabs**

In `video-detail.tsx`, directly above the `<Tabs defaultValue="transcript">`, add (only when present):

```tsx
{detail.analysis?.summary ? (
  <section className="mb-4 border border-border bg-card p-4">
    <h3 className="mb-1.5 font-mono text-[13px] uppercase tracking-[0.06em] text-faint">Summary</h3>
    <p className="text-[17px] text-foreground">{detail.analysis.summary}</p>
  </section>
) : null}
```

- [ ] **Step 3: Add the transcript word count to the tab label**

Change the transcript trigger:

```tsx
<TabsTrigger value="transcript">
  Transcript
  {detail.transcript ? (
    <span className="ml-1.5 font-mono text-[12px] text-faint tabular-nums">
      {detail.transcript.trim().split(/\s+/).filter(Boolean).length} words
    </span>
  ) : null}
</TabsTrigger>
```

- [ ] **Step 4: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Browser check**

Bring the stack up (`/crowsnest-up`). Open a downloaded, analyzed post (for example `/feed/a0ed7179-1b66-4f2e-90c9-03e81429f9fc`). Confirm: a Summary block shows above the tabs only when the analysis has a summary, and the Transcript tab shows a word count. A post with no analysis shows neither and nothing breaks.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(video): summary block and transcript word count" -- src/components/video/video-detail.tsx src/server/queries/video.ts
```

---

## Task 3: Feed query supports engagement and analyzed-status filters

**Files:**
- Modify: `src/server/queries/feed.ts` (`FeedFilters`, `buildWhere`)
- Test: `src/server/queries/feed.test.ts` (create if absent)

**Interfaces:**
- Consumes: `tables.videoAnalyses.videoId` (for the analyzed check).
- Produces: `FeedFilters.minEngagement?: number` (a rate, e.g. 0.02 for 2%) and `FeedFilters.analyzed?: "yes" | "no"`, read by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/server/queries/feed.test.ts` following the `remix.test.ts` pattern (dynamic imports, `migrate()`, seed helpers). Seed three videos: one with 10% engagement and an analysis, one with 1% engagement and no analysis, one with 6% engagement and an analysis.

```ts
test("minEngagement filters by engagement rate", async () => {
  await seed();
  const { items } = await getOutlierFeed({ ...baseFilters, minEngagement: 0.05 });
  expect(items.map((i) => i.handle).sort()).toEqual(["@eng10", "@eng6"]);
});

test("analyzed=yes returns only videos with an analysis row", async () => {
  await seed();
  const { items } = await getOutlierFeed({ ...baseFilters, analyzed: "yes" });
  expect(items.every((i) => i.handle !== "@eng1none")).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/queries/feed.test.ts`
Expected: FAIL (unknown properties `minEngagement` / `analyzed`).

- [ ] **Step 3: Extend `FeedFilters` and `buildWhere`**

In `feed.ts`, add to `FeedFilters`:

```ts
  minEngagement?: number;   // rate, e.g. 0.02
  analyzed?: "yes" | "no";
```

Engagement rate is `(likeCount + commentCount) / viewCount` in this codebase (mirror the exact formula already in `toFeedItem`). In `buildWhere`, add:

```ts
if (typeof f.minEngagement === "number") {
  conds.push(sql`(coalesce(${tables.videos.likeCount},0) + coalesce(${tables.videos.commentCount},0)) * 1.0 / nullif(${tables.videos.viewCount},0) >= ${f.minEngagement}`);
}
if (f.analyzed === "yes" || f.analyzed === "no") {
  const exists = sql`exists (select 1 from ${tables.videoAnalyses} where ${tables.videoAnalyses.videoId} = ${tables.videos.id})`;
  conds.push(f.analyzed === "yes" ? exists : sql`not ${exists}`);
}
```

Match the real engagement formula to `toFeedItem`; if it divides differently, copy that exactly so the filter and the displayed number agree.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/server/queries/feed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(feed): engagement and analyzed-status filters in the query" -- src/server/queries/feed.ts src/server/queries/feed.test.ts
```

---

## Task 4: Feed filter-bar UI for the two filters and Add video URL

**Files:**
- Modify: `src/components/feed/filter-bar.tsx`
- Modify: `src/lib/feed-filters.ts` (parse the two new params into `FeedFilters`)

**Interfaces:**
- Consumes: `FeedFilters.minEngagement`, `FeedFilters.analyzed` (Task 3).

- [ ] **Step 1: Parse the params**

In `src/lib/feed-filters.ts`, where the search params map to `FeedFilters`, read `minEng` (a percent string like `2`, converted to `0.02`) and `analyzed` (`yes` / `no`). Follow the existing `resolveChipValue` / `bandOrAny` conventions used for `minScore`.

- [ ] **Step 2: Add an engagement Select**

In `filter-bar.tsx`, add an options constant beside `VIEWS_OPTIONS`:

```ts
const ENGAGEMENT_OPTIONS = [
  { value: "any", label: "Any engagement" },
  { value: "2", label: "2%+" },
  { value: "5", label: "5%+" },
  { value: "8", label: "8%+" },
];
```

Render a `<Select items={ENGAGEMENT_OPTIONS} value={...} onValueChange={(v) => set("minEng", v)} />` next to the views Select, reading the current value with `resolveChipValue(searchParams.get("minEng"), ...)`.

- [ ] **Step 3: Add an analyzed-status control**

Add a two-state segmented control (Analyzed / Unanalyzed), styled per the amber law (selected is `--card` + `--foreground`, never amber). Writing sets `analyzed=yes` / `analyzed=no`; clicking the active one again clears it via `set("analyzed", "all")`.

- [ ] **Step 4: Add the Add video URL action**

Surface the existing single-reel import on the toolbar. Find the current entry point (search `importSingleReel` and the add-channel dialog's "Paste reel URL" tab). Add a toolbar button that opens that same dialog/action. Do not write a second import path.

- [ ] **Step 5: Typecheck, lint, browser check**

Run: `npm run typecheck && npm run lint`. Then browse `/feed`: the two new filters narrow the grid, the counts respect them, and Add video URL imports one reel the same way the dialog does. Confirm no filter chip renders with a count of 0 that should be hidden.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(feed): engagement and analyzed filters, Add video URL on the toolbar" -- src/components/feed/filter-bar.tsx src/lib/feed-filters.ts
```

---

## Task 5: Persona table and service

**Files:**
- Modify: `src/server/db/schema.ts` (add `persona`)
- Generate: `drizzle/00NN_*.sql`
- Create: `src/server/services/persona.ts`
- Create: `src/server/services/persona.test.ts`

**Interfaces:**
- Produces: `getPersona(): Promise<Persona>` and `upsertPersona(p: Partial<Persona>): Promise<Persona>` where `Persona = { audience: string; voice: string; do: string; dont: string }`. Read by Task 6 and Task 7.

- [ ] **Step 1: Add the table**

In `schema.ts`, a single-row table keyed on a fixed id:

```ts
export const persona = sqliteTable("persona", {
  id: text("id").primaryKey(),          // always the constant "default"
  audience: text("audience").notNull().default(""),
  voice: text("voice").notNull().default(""),
  doList: text("do_list").notNull().default(""),
  dontList: text("dont_list").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate && npm run db:migrate`
Expected: a new migration adding `persona`, applied clean.

- [ ] **Step 3: Write the failing test**

`src/server/services/persona.test.ts`:

```ts
test("getPersona seeds audience from the niche profile on first read", async () => {
  migrate();
  await setNicheProfile("AI tools and building-in-public for solo founders");
  const p = await getPersona();
  expect(p.audience).toContain("building-in-public");
  expect(p.voice).toBe("");
});

test("upsertPersona persists and getPersona returns it", async () => {
  migrate();
  await upsertPersona({ voice: "short, dry, specific" });
  expect((await getPersona()).voice).toBe("short, dry, specific");
});
```

Use whatever the real niche-profile setter is (find it in `niche-profile-section.tsx` and its action). If the niche profile is an `app_settings` key, read it in `getPersona` via the existing `getSetting`.

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/server/services/persona.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `persona.ts`**

```ts
import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { getSetting } from "../settings";

const PERSONA_ID = "default";
export interface Persona { audience: string; voice: string; do: string; dont: string; }

export async function getPersona(): Promise<Persona> {
  const [row] = await db.select().from(tables.persona).where(eq(tables.persona.id, PERSONA_ID)).limit(1);
  if (row) return { audience: row.audience, voice: row.voice, do: row.doList, dont: row.dontList };
  const seededAudience = (await getSetting("nicheProfile")) ?? "";  // use the real setting key
  return { audience: seededAudience, voice: "", do: "", dont: "" };
}

export async function upsertPersona(p: Partial<Persona>): Promise<Persona> {
  const current = await getPersona();
  const next = { ...current, ...p };
  await db.insert(tables.persona)
    .values({ id: PERSONA_ID, audience: next.audience, voice: next.voice, doList: next.do, dontList: next.dont, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: tables.persona.id, set: { audience: next.audience, voice: next.voice, doList: next.do, dontList: next.dont, updatedAt: nowIso() } });
  return next;
}
```

Confirm the real niche-profile setting key name and swap `"nicheProfile"` for it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/server/services/persona.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(persona): single-row persona table and service, seeded from niche profile" -- src/server/db/schema.ts drizzle/ src/server/services/persona.ts src/server/services/persona.test.ts
```

---

## Task 6: Persona surface, nav entry, and generation wiring

**Files:**
- Create: `src/server/actions/persona-actions.ts`
- Create: `src/components/settings/persona-section.tsx`
- Create: `src/app/(shell)/persona/page.tsx`
- Modify: `src/components/layout/nav-items.ts`
- Modify: `src/server/services/remix.ts` (generation reads the persona)

**Interfaces:**
- Consumes: `getPersona`, `upsertPersona` (Task 5).
- Produces: `savePersonaAction(p: Partial<Persona>)` returning the action union.

- [ ] **Step 1: The save action**

`persona-actions.ts`, `"use server"`, wraps `upsertPersona` in the standard try/catch union with code `PERSONA_SAVE_FAILED`.

- [ ] **Step 2: The Persona section component**

`persona-section.tsx`, `"use client"`, follows the `secrets-section.tsx` shape: four fields (Audience, Voice, Do, Do not) using the shared `setting-field.tsx` primitive, a single amber "Save persona" primary button (the one primary per screen), `useTransition` around `savePersonaAction`. The short helper line above the fields is allowed (it is the generation-reads-this note; keep it to one sentence per the design system's explanation budget).

- [ ] **Step 3: The route**

`src/app/(shell)/persona/page.tsx` server component: `const persona = await getPersona();` then render `<PersonaSection initial={persona} />`.

- [ ] **Step 4: Nav entry, add the Setup group**

In `nav-items.ts`, extend the `NavGroup` union with `"Setup"`, add Ideas under Research and Persona under Setup, and move Settings into Setup so the group reads Persona then Settings (matches the mockup):

```ts
export type NavGroup = "Research" | "Create" | "Sources" | "System" | "Setup";
// ... in NAV_ITEMS, order matters (groups render on change):
{ href: "/feed", label: "Feed", icon: Flame, group: "Research" },
{ href: "/ideas", label: "Ideas", icon: Lightbulb, group: "Research" },   // pending count added in Task 9
// ... unchanged Create / Sources ...
{ href: "/", label: "Dashboard", icon: LayoutDashboard, group: "System" },
{ href: "/logs", label: "Logs", icon: ScrollText, group: "System" },
{ href: "/runs", label: "Runs", icon: Activity, group: "System" },
{ href: "/persona", label: "Persona", icon: Drama, group: "Setup" },
{ href: "/settings", label: "Settings", icon: Settings, group: "Setup" },
```

Pick real `lucide-react` icons that exist (verify the import names). The `/ideas` route is created in Task 9; adding the nav item now is fine because Next resolves it at request time, but do not ship the Ideas nav item to `main` before Task 9 lands.

- [ ] **Step 5: Wire the persona into generation**

In `remix.ts`, wherever the prompt currently reads the niche profile, read `getPersona()` and include audience, voice, do, and do-not in the prompt context. Keep the change to the prompt-assembly function; do not alter the stage machine.

- [ ] **Step 6: Replace the Settings niche textarea with a link**

In `niche-profile-section.tsx`, replace the textarea with a one-line pointer to `/persona` (the niche value now lives behind the persona's audience). Do not delete the setting key yet; `getPersona` still seeds from it.

- [ ] **Step 7: Typecheck, lint, browser check**

Run: `npm run typecheck && npm run lint`. Browse `/persona`: audience is pre-filled from the niche profile, saving persists, and the sidebar shows Persona under Setup. Open Remix on a post and confirm generation still runs (the prompt now carries the persona).

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(persona): surface, nav entry, and generation wiring" -- src/server/actions/persona-actions.ts src/components/settings/persona-section.tsx "src/app/(shell)/persona/page.tsx" src/components/layout/nav-items.ts src/server/services/remix.ts src/components/settings/niche-profile-section.tsx
```

---

## Task 7: The `idea` table and the generator

**Files:**
- Modify: `src/server/db/schema.ts` (add `idea`)
- Generate: `drizzle/00NN_*.sql`
- Create: `src/server/services/ideas.ts`
- Create: `src/server/services/ideas.test.ts`

**Interfaces:**
- Consumes: `getPersona` (Task 5), `tables.videoAnalyses`, the LLM client.
- Produces: `generateIdea(videoId: string): Promise<{ id: string; created: boolean }>`, upsert-keyed on source video; the `idea` row shape.

- [ ] **Step 1: Add the table**

```ts
export const idea = sqliteTable("idea", {
  id: text("id").primaryKey(),
  sourceVideoId: text("source_video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  concept: text("concept").notNull(),
  angle: text("angle").notNull(),
  status: text("status").notNull().default("inbox"), // inbox | shortlisted | scripted | discarded
  notes: text("notes"),
  scoreAtCreation: real("score_at_creation"),
  remixSessionId: text("remix_session_id").references(() => remixSessions.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idea_status").on(t.status),
  uniqueIndex("idea_source_active").on(t.sourceVideoId).where(sql`status != 'discarded'`),
]);
```

The partial unique index enforces "at most one non-discarded idea per source video". Confirm drizzle-kit emits the `WHERE` clause; if the installed version cannot, drop the DB constraint and enforce the invariant in `generateIdea` (select-then-update) with a comment saying why.

- [ ] **Step 2: Generate and apply the migration**

Run: `npm run db:generate && npm run db:migrate`

- [ ] **Step 3: Write the failing test**

`ideas.test.ts`, LLM mocked with `vi.fn()` returning a fixed `{ concept, angle }`:

```ts
test("generateIdea writes one idea from the analysis and persona", async () => {
  await seedAnalyzedVideo({ handle: "@oren", score: 16.2 });
  const { created } = await generateIdea(videoId);
  expect(created).toBe(true);
  const [row] = await db.select().from(tables.idea).where(eq(tables.idea.sourceVideoId, videoId));
  expect(row.status).toBe("inbox");
  expect(row.scoreAtCreation).toBeCloseTo(16.2);
});

test("a second generate on the same video updates, not duplicates", async () => {
  await seedAnalyzedVideo({ handle: "@oren", score: 16.2 });
  await generateIdea(videoId);
  const second = await generateIdea(videoId);
  expect(second.created).toBe(false);
  const rows = await db.select().from(tables.idea).where(eq(tables.idea.sourceVideoId, videoId));
  expect(rows.length).toBe(1);
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/server/services/ideas.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `generateIdea`**

Read the video's `video_analyses` row and `getPersona()`, build a prompt that asks for a one-line `concept` and a short `angle`, call the LLM client (the same client `remix.ts` uses), parse the JSON, and upsert the idea keyed on `sourceVideoId` with `status: "inbox"` and `scoreAtCreation` from the video's `outlierScore`. Return `{ id, created }`. Never throw on a malformed LLM reply: log at error level and return `{ id: "", created: false }` so the caller (the sync pass) is never broken by one bad idea.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/server/services/ideas.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ideas): idea table and generator from analysis plus persona" -- src/server/db/schema.ts drizzle/ src/server/services/ideas.ts src/server/services/ideas.test.ts
```

---

## Task 8: Auto-generate pass in the sync, and the manual generate action

**Files:**
- Modify: `src/server/services/sync-engine.ts` (an ideas pass after scoring, mirroring the enrichment pass)
- Create/Modify: `src/server/actions/idea-actions.ts` (`generateIdeaAction`)
- Modify: `src/server/services/ideas.test.ts` (add the auto-pass test)

**Interfaces:**
- Consumes: `generateIdea` (Task 7).
- Produces: `generateIdeasForNewOutliers(channelId, opts)` and `generateIdeaAction(videoId)`.

- [ ] **Step 1: Write the failing test**

Add to `ideas.test.ts`: seed one channel with three analyzed videos scoring 5x, 2x, 4x; run `generateIdeasForNewOutliers` with `threshold: 3, cap: 20`; expect ideas for the 5x and 4x videos only.

```ts
test("the auto pass covers analyzed outliers at or above the threshold", async () => {
  await seedChannelWithAnalyzed([5, 2, 4]);
  await generateIdeasForNewOutliers(channelId, { threshold: 3, cap: 20 });
  const rows = await db.select().from(tables.idea);
  expect(rows.length).toBe(2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/server/services/ideas.test.ts -t "auto pass"`
Expected: FAIL.

- [ ] **Step 3: Implement `generateIdeasForNewOutliers`**

Select analyzed videos for the channel with `outlierScore >= threshold` and an existing `video_analyses` row, newest first, limited to `cap`, and call `generateIdea` for each. It only touches already-analyzed videos (the spec's v1 boundary). Never throw.

- [ ] **Step 4: Call it from the sync**

In `sync-engine.ts`, after `recomputeChannelScores` for a channel, call `generateIdeasForNewOutliers`. Follow the enrichment pass's shape exactly: it must yield to a cancel, keep the heartbeat alive (`tracker.flushIfDue`), and never fail the channel over an idea. Read the `enrichViewCounts` pass in the same file as the template. Log an `sync.ideas.*` event at info level.

- [ ] **Step 5: The manual action**

`idea-actions.ts`, `generateIdeaAction(videoId)` wraps `generateIdea` in the union.

- [ ] **Step 6: Run the tests and the full suite**

Run: `npx vitest run src/server/services/ideas.test.ts && npx vitest run`
Expected: PASS, and the existing suite stays green.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ideas): auto-generate pass in sync and a manual generate action" -- src/server/services/sync-engine.ts src/server/actions/idea-actions.ts src/server/services/ideas.test.ts
```

---

## Task 9: The Ideas inbox (query, route, two-pane UI, nav count)

**Files:**
- Create: `src/server/queries/ideas.ts`
- Create: `src/server/queries/ideas.test.ts`
- Create: `src/app/(shell)/ideas/page.tsx`
- Create: `src/components/ideas/idea-inbox.tsx`
- Modify: `src/server/actions/idea-actions.ts` (setStatus, setNotes)
- Modify: `src/components/layout/sidebar.tsx` or `nav-items.ts` (Ideas pending count)

**Interfaces:**
- Consumes: `tables.idea`, `feedItemColumns` for the source post.
- Produces: `listIdeas({ tab })`, `getIdea(id)`, `setIdeaStatusAction(id, status)`, `setIdeaNotesAction(id, notes)`, `countInboxIdeas()`.

- [ ] **Step 1: Write the failing query test**

`ideas.test.ts` under queries: seed ideas in inbox and shortlisted states; `listIdeas({ tab: "inbox" })` returns only inbox, ordered by `scoreAtCreation` desc; each item carries the source post's concept, handle, score, views, engagement.

- [ ] **Step 2: Run it to see it fail, then implement `listIdeas` / `getIdea` / `countInboxIdeas`**

Join `idea` to `videos`/`channels` reusing `feedItemColumns`. `listIdeas` filters by status (`inbox` for the Inbox tab, `shortlisted` for Shortlist). Run: `npx vitest run src/server/queries/ideas.test.ts` to green.

- [ ] **Step 3: The status and notes actions**

In `idea-actions.ts`: `setIdeaStatusAction(id, status)` validates status against the four values and updates; discard sets `status: "discarded"` (soft, reversible). `setIdeaNotesAction(id, notes)` updates notes.

- [ ] **Step 4: The route**

`src/app/(shell)/ideas/page.tsx` server component reads the `tab` search param, calls `listIdeas`, and renders `<IdeaInbox items={...} tab={...} />`.

- [ ] **Step 5: The two-pane inbox component**

`idea-inbox.tsx`, `"use client"`: Inbox / Shortlist tabs (selected is `--card`, not amber), a left list of concept-first cards (score badge amber, views and engagement neutral with text labels), a right detail (concept, angle, source post, a Your notes textarea wired to `setIdeaNotesAction` on blur), and an action row with one amber primary "Create script" plus neutral Shortlist and Discard. Follow the design system: radius 0 cards, pill buttons, mono tabular numbers.

- [ ] **Step 6: Ideas pending count in the nav**

Render the inbox count on the Ideas nav item as a neutral count badge (count only, never amber). Compute it via `countInboxIdeas()` where the sidebar gets its data. If the sidebar is a server component, fetch there; if not, pass it down from a server parent.

- [ ] **Step 7: Typecheck, lint, browser check**

Run: `npm run typecheck && npm run lint`. Seed a few ideas (run a sync, or call `generateIdeaAction` on a few analyzed posts). Browse `/ideas`: the queue shows, Shortlist and Discard move an idea between tabs, discard is reversible, notes persist, and the nav count matches the inbox size.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(ideas): inbox query, route, two-pane UI, and nav count" -- src/server/queries/ideas.ts src/server/queries/ideas.test.ts "src/app/(shell)/ideas/page.tsx" src/components/ideas/idea-inbox.tsx src/server/actions/idea-actions.ts src/components/layout/sidebar.tsx src/components/layout/nav-items.ts
```

---

## Task 10: Create script from an idea seeds a remix session

**Files:**
- Modify: `src/server/services/remix.ts` (`seedSessionFromIdea`)
- Modify: `src/server/actions/idea-actions.ts` (`createScriptFromIdeaAction`)
- Modify: `src/components/ideas/idea-inbox.tsx` (wire the Create script button)
- Modify: `src/server/services/ideas.test.ts` or a new `remix.test.ts` case

**Interfaces:**
- Consumes: `getOrCreateSession` (remix.ts:181), `updateStage`.
- Produces: `createScriptFromIdeaAction(ideaId): Promise<ActionResult<{ sessionId: string }>>`.

- [ ] **Step 1: Write the failing test**

```ts
test("createScriptFromIdea seeds a remix session and marks the idea scripted", async () => {
  const { ideaId, videoId } = await seedIdea({ concept: "Expose the synthetic swap" });
  const sessionId = await seedSessionFromIdea(ideaId);
  const [session] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, sessionId));
  expect(session.sourceVideoId).toBe(videoId);
  expect(session.topic).toContain("synthetic swap");
  const [idea] = await db.select().from(tables.idea).where(eq(tables.idea.id, ideaId));
  expect(idea.status).toBe("scripted");
  expect(idea.remixSessionId).toBe(sessionId);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run -t "createScriptFromIdea"`
Expected: FAIL.

- [ ] **Step 3: Implement `seedSessionFromIdea`**

Read the idea, call `getOrCreateSession(idea.sourceVideoId)`, then `updateStage(sessionId, { topic: idea.concept })`, then set the idea to `status: "scripted"` with `remixSessionId: sessionId`. Return the session id.

- [ ] **Step 4: The action and the button**

`createScriptFromIdeaAction(ideaId)` wraps it in the union and returns `{ sessionId }`. In `idea-inbox.tsx`, Create script (and the `C` key later) calls it and routes to the remix flow for that session (match how the video detail's Remix entry navigates).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run -t "createScriptFromIdea"`
Expected: PASS.

- [ ] **Step 6: Browser check**

On `/ideas`, Create script on an idea lands in Remix carrying the concept and the source post, and the idea leaves the inbox (now scripted).

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ideas): create script from an idea seeds a remix session" -- src/server/services/remix.ts src/server/actions/idea-actions.ts src/components/ideas/idea-inbox.tsx src/server/services/ideas.test.ts
```

---

## Task 11: Keyboard command menu on the inbox

**Files:**
- Create: `src/components/ideas/command-menu.tsx`
- Modify: `src/components/ideas/idea-inbox.tsx` (mount the menu, key handler)

**Interfaces:**
- Consumes: `createScriptFromIdeaAction`, `setIdeaStatusAction` (Tasks 9, 10), and the existing export/copy-as-prompt path.

- [ ] **Step 1: The menu component**

`command-menu.tsx`, `"use client"`: a popover listing the idea actions with a key per row, context-aware. On an idea: Create script C, Shortlist S, Export for LLM E, Open in new tab O, Discard D. Rows whose backing feature does not exist yet (Add to project, Save hook template) are hidden, not shown-and-broken. Style neutral (`--popover`, `--card` on the active row), never amber.

- [ ] **Step 2: The key handler**

In `idea-inbox.tsx`, add a `keydown` handler on the inbox: arrow up/down move the selection, Esc closes the menu, `K` opens it, and C/S/E/O/D fire the matching action on the selected idea. Guard against firing while a text input (the notes field) has focus.

- [ ] **Step 3: Export for LLM**

Wire E to the existing export path (search `export.ts` / Copy as prompt) so the idea produces the same paste-ready block the video detail does. Reuse, do not rebuild.

- [ ] **Step 4: Typecheck, lint, browser check**

Run: `npm run typecheck && npm run lint`. On `/ideas`: arrow keys move through the queue, C creates a script, S shortlists, D discards, E copies the export block, and typing in the notes field does not trigger shortcuts.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ideas): keyboard command menu on the inbox" -- src/components/ideas/command-menu.tsx src/components/ideas/idea-inbox.tsx
```

---

## Self-review notes

- Spec coverage: U1 (Tasks 1 to 2), U2 (Tasks 3 to 4), U3 (Tasks 5 to 6), U4 (Tasks 7 to 10), U5 (Task 11). The deferred analyze-first pass and the parked features (Projects, discovery, automations) are out of scope by design.
- The one place to verify against the installed toolchain before building: the partial unique index in Task 7 (drizzle-kit `WHERE` support). The task carries the fallback.
- The niche-profile setting key in Tasks 5 and 6 is named `"nicheProfile"` as a placeholder; the implementer must read the real key from `niche-profile-section.tsx` and its action before writing `getPersona`.
- U6 (the MCP server) is a separate plan and shares no code path with these tasks except the read queries (`getOutlierFeed`, `listIdeas`, `getPersona`), which it consumes read-only.
