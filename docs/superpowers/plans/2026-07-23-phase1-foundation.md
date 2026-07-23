# Crowsnest Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Crowsnest app — Next.js 15 + shadcn dark theme, full Drizzle/SQLite schema, outlier-score engine (TDD), deterministic demo seed, and the app shell with all routes — so phase 2A (data pipeline) and 2B (UI) can build in parallel on top.

**Architecture:** Single Next.js 15 App Router project (`src/` dir, `@/*` alias). All domain logic in `src/server/**` services (framework-free, Vitest-tested); routes/components consume them. SQLite file DB at `data/crowsnest.db` (git-ignored). Spec: `docs/superpowers/specs/2026-07-23-crowsnest-design.md` · visual system: `docs/design/DESIGN.md`.

**Tech Stack:** Next.js 15 (React 19, TS strict) · Tailwind v4 · shadcn/ui · Drizzle ORM + better-sqlite3 · Vitest · lucide-react · Inter via next/font.

## Global Constraints

- Product name **Crowsnest** everywhere user-visible; package name `crowsnest`. The string "Sandcastles" must appear nowhere in app code or UI copy.
- Dark-only: palette values verbatim from `docs/design/DESIGN.md` §4.1/§4.4 (bg `#0B0D12`, card `#12151C`, primary `#6A5AE0`, accent `#F5A524`, etc.). `<html class="dark">`, `color-scheme: dark`.
- TypeScript strict; no `any` in committed code.
- Secrets only in `.env.local` (git-ignored). DB lives at `data/` (git-ignored). Keyless mode must always work.
- Timestamps: ISO-8601 strings (UTC) in DB text columns — matches `DATA.md` §3 interfaces.
- Every task ends in a passing state: `npm run build && npm test` green before commit.
- Commit messages: conventional commits, ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Repo + Next.js scaffold

**Files:**
- Create: Next.js scaffold at repo root (`src/app/**`, config files)
- Modify: `.gitignore` (append `data/`, `.env.local`)

**Interfaces:**
- Produces: running Next dev app; git repo with docs committed.

- [ ] **Step 1:** `create-next-app` refuses non-empty dirs and `docs/` exists. Move it aside, scaffold, restore:

```bash
cd /Users/kienbeovl/Desktop/entrepreneur/sandcastle-clone
mv docs /tmp/crowsnest-docs-tmp
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
mv /tmp/crowsnest-docs-tmp docs
```

- [ ] **Step 2:** Append to `.gitignore`:

```
# local data + secrets
data/
.env.local
```

- [ ] **Step 3:** Set `"name": "crowsnest"` in `package.json`. Run `npm run dev` briefly; expect the default page on http://localhost:3000, no errors. Kill it.

- [ ] **Step 4:** Commit everything (git repo was created by create-next-app; if not: `git init -b main` first):

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 app + phase-0 docs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Dark theme tokens + shadcn/ui + fonts

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `components.json`, `src/components/ui/*` (generated)

**Interfaces:**
- Produces: shadcn primitives importable from `@/components/ui/*`; CSS vars `--background`, `--primary`, etc. per DESIGN.md.

- [ ] **Step 1:** `npx shadcn@latest init` (style: default; base color: neutral; CSS variables: yes).

- [ ] **Step 2:** Install the full primitive set used across all phases (DESIGN.md §3 inventory):

```bash
npx shadcn@latest add button card badge avatar tabs sheet dialog table select command toggle-group skeleton scroll-area separator dropdown-menu tooltip textarea input switch label form progress resizable popover alert sonner
```

- [ ] **Step 3:** In `globals.css`, replace the generated color variable values (keep the file's structure/format shadcn generated — hex is fine) with DESIGN.md §4.4 values: background `#0B0D12`, foreground `#E7E9EE`, card `#12151C`, card-foreground `#E7E9EE`, popover `#171B24`, primary `#6A5AE0`, primary-foreground `#FFFFFF`, secondary `#171B24`, muted `#171B24`, muted-foreground `#767D93`, accent `#F5A524`, accent-foreground `#14100A`, destructive `#F1585C`, border `#242938`, input `#565E78`, ring `#7C6CFF`, radius `0.625rem`. Delete any `.dark {}` duplicate block — dark values go on `:root` (dark-only app). Add `:root { color-scheme: dark; }`.

- [ ] **Step 4:** `src/app/layout.tsx`: load Inter via `next/font/google` (`variable: "--font-sans"`, subsets latin), set `<html lang="en" className="dark">`, body `className={inter.variable + " font-sans antialiased"}`. Metadata title `Crowsnest`. Wire the font into Tailwind v4 in `globals.css`: `@theme inline { --font-sans: var(--font-sans), ui-sans-serif, system-ui, sans-serif; }`.

- [ ] **Step 5:** Replace default `src/app/page.tsx` content with a minimal `<main className="p-8"><h1 className="text-2xl font-semibold">Crowsnest</h1></main>`. `npm run build` — expect success. Visual smoke: dev server shows near-black bg, light text.

- [ ] **Step 6:** Commit: `feat: dark theme tokens + shadcn primitives`.

### Task 3: Drizzle schema + DB client

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/index.ts`, `src/server/db/schema.test.ts`
- Modify: `package.json` (scripts), `vitest.config.ts` (create)

**Interfaces:**
- Produces (all later phases depend on these exact names): tables `channels, fleets, fleetChannels, videos, channelSnapshots, videoSnapshots, transcripts, videoAnalyses, vaultItems, scripts, savedFilters, remixSessions, syncJobs, appSettings`; `db` client from `@/server/db`; `newId()` helper.

- [ ] **Step 1:** Install:

```bash
npm i drizzle-orm better-sqlite3
npm i -D drizzle-kit @types/better-sqlite3 vitest
```

- [ ] **Step 2:** Create `src/server/db/schema.ts` — complete schema, spec §5 verbatim:

```ts
import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(), // "instagram" | "tiktok" | "youtube_shorts"
  handle: text("handle").notNull(),
  externalId: text("external_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  mediaCount: integer("media_count"),
  bio: text("bio"),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  syncError: text("sync_error"),
  trackedSince: text("tracked_since").notNull(),
  lastSyncedAt: text("last_synced_at"),
}, (t) => [uniqueIndex("channels_platform_handle").on(t.platform, t.handle)]);

export const fleets = sqliteTable("fleets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nicheLabel: text("niche_label"),
  createdAt: text("created_at").notNull(),
});

export const fleetChannels = sqliteTable("fleet_channels", {
  fleetId: text("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.fleetId, t.channelId] })]);

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  caption: text("caption"),
  postedAt: text("posted_at").notNull(),
  durationSec: integer("duration_sec"),
  thumbnailUrl: text("thumbnail_url"),
  videoUrl: text("video_url"),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  outlierScore: real("outlier_score"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastRefreshedAt: text("last_refreshed_at"),
}, (t) => [uniqueIndex("videos_platform_external").on(t.platform, t.externalId)]);

export const channelSnapshots = sqliteTable("channel_snapshots", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  capturedAt: text("captured_at").notNull(),
  followerCount: integer("follower_count"),
  medianViews: real("median_views"),
});

export const videoSnapshots = sqliteTable("video_snapshots", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  capturedAt: text("captured_at").notNull(),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
});

export const transcripts = sqliteTable("transcripts", {
  videoId: text("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  language: text("language"),
  durationSec: real("duration_sec"),
  source: text("source").notNull(), // "whisper-local" | "groq" | "caption"
  createdAt: text("created_at").notNull(),
});

export const videoAnalyses = sqliteTable("video_analyses", {
  videoId: text("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  hookType: text("hook_type"),
  structureSegments: text("structure_segments", { mode: "json" }).$type<{ label: string; startSec: number; endSec: number; note: string }[]>(),
  formatTags: text("format_tags", { mode: "json" }).$type<string[]>(),
  styleTags: text("style_tags", { mode: "json" }).$type<string[]>(),
  whyItWorked: text("why_it_worked"),
  model: text("model"),
  createdAt: text("created_at").notNull(),
});

export const vaultItems = sqliteTable("vault_items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "hook" | "style"
  sourceVideoId: text("source_video_id").references(() => videos.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  templateText: text("template_text").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
});

export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceVideoId: text("source_video_id").references(() => videos.id, { onDelete: "set null" }),
  hookVaultItemId: text("hook_vault_item_id").references(() => vaultItems.id, { onDelete: "set null" }),
  styleVaultItemId: text("style_vault_item_id").references(() => vaultItems.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // "draft" | "final"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const savedFilters = sqliteTable("saved_filters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
});

export const remixSessions = sqliteTable("remix_sessions", {
  id: text("id").primaryKey(),
  sourceVideoId: text("source_video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  stage: text("stage").notNull().default("prompt"), // "prompt"|"research"|"hook"|"style"|"script"
  topic: text("topic"),
  niche: text("niche"),
  targetLengthSec: integer("target_length_sec"),
  researchNotes: text("research_notes", { mode: "json" }).$type<Record<string, unknown>>(),
  hookOptions: text("hook_options", { mode: "json" }).$type<string[]>(),
  chosenHook: text("chosen_hook"),
  styleVaultItemId: text("style_vault_item_id"),
  outline: text("outline"),
  variants: text("variants", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncJobs = sqliteTable("sync_jobs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(), // "running" | "success" | "partial" | "failed"
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>(),
  gaps: text("gaps", { mode: "json" }).$type<{ channelId: string; provider: string; error: string }[]>(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
```

- [ ] **Step 3:** Create `src/server/db/index.ts`:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as schema from "./schema";

const dbPath = process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db";
if (dbPath !== ":memory:") mkdirSync(dbPath.substring(0, dbPath.lastIndexOf("/")) || ".", { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export * as tables from "./schema";
```

- [ ] **Step 4:** Create `drizzle.config.ts` (dialect `sqlite`, schema `./src/server/db/schema.ts`, dbCredentials url `data/crowsnest.db`, out `./drizzle`). Add scripts to `package.json`: `"db:push": "drizzle-kit push"`, `"test": "vitest run"`, `"test:watch": "vitest"`. Create `vitest.config.ts` with alias `@` → `./src`. Run `npm run db:push` — expect all tables created.

- [ ] **Step 5:** Write `src/server/db/schema.test.ts` — smoke test with `CROWSNEST_DB_PATH=:memory:`:

```ts
import { beforeAll, expect, test } from "vitest";

beforeAll(() => { process.env.CROWSNEST_DB_PATH = ":memory:"; });

test("schema: insert + read a channel and video", async () => {
  const { db, newId, nowIso, tables } = await import("./index");
  const { migrate } = await import("./test-migrate");
  migrate(); // applies CREATE TABLE statements to the in-memory db
  const chId = newId();
  await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@demo", trackedSince: nowIso() });
  await db.insert(tables.videos).values({ id: newId(), channelId: chId, platform: "instagram", externalId: "x1", url: "https://example.com/1", postedAt: nowIso(), firstSeenAt: nowIso(), viewCount: 1000 });
  const rows = await db.select().from(tables.videos);
  expect(rows).toHaveLength(1);
  expect(rows[0].viewCount).toBe(1000);
});
```

Create `src/server/db/test-migrate.ts` exporting `migrate()` that runs `CREATE TABLE IF NOT EXISTS` DDL generated via `drizzle-kit push`-equivalent — simplest robust approach: use `drizzle-orm/better-sqlite3`'s `migrate` against a generated migrations folder (`npx drizzle-kit generate` once, commit `./drizzle`), and in `test-migrate.ts` call `migrate(db, { migrationsFolder: "./drizzle" })`. Adjust `db:push` workflow to `db:generate` + `db:migrate` scripts if that's cleaner — pick ONE mechanism (generated migrations folder) and use it for dev DB and tests alike.

- [ ] **Step 6:** `npm test` — expect PASS. Run once with fail-first discipline: temporarily assert `rows.toHaveLength(2)` to see it fail, revert to `1`, re-run, PASS.

- [ ] **Step 7:** Commit: `feat: drizzle schema, sqlite client, migrations`.

### Task 4: Outlier-calc service (TDD)

**Files:**
- Create: `src/server/services/outlier-calc.ts`, `src/server/services/outlier-calc.test.ts`

**Interfaces:**
- Produces (phase 2A sync-engine + seed depend on these):

```ts
export interface VideoForCalc { id: string; viewCount: number | null; postedAt: string }
export function median(values: number[]): number
export function computeChannelMedian(videos: VideoForCalc[], window?: number): number | null
export function scoreVideos(videos: VideoForCalc[], window?: number): Map<string, number | null>
```

Rules (spec §4): channel median = median of `viewCount` over the `window` (default 20) most-recent videos by `postedAt` having non-null views. Median is `null` if usable videos < 5 or median === 0. Score = `viewCount / channelMedian` rounded to 1 decimal; `null` score for null-view videos or null median.

- [ ] **Step 1:** Write `outlier-calc.test.ts` first:

```ts
import { describe, expect, test } from "vitest";
import { median, computeChannelMedian, scoreVideos, type VideoForCalc } from "./outlier-calc";

const vid = (id: string, views: number | null, daysAgo: number): VideoForCalc => ({
  id, viewCount: views, postedAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
});

describe("median", () => {
  test("odd count", () => expect(median([1, 9, 5])).toBe(5));
  test("even count averages middle pair", () => expect(median([1, 2, 3, 10])).toBe(2.5));
});

describe("computeChannelMedian", () => {
  test("null when fewer than 5 usable videos", () => {
    expect(computeChannelMedian([vid("a", 100, 1), vid("b", 200, 2), vid("c", 300, 3), vid("d", null, 4)])).toBeNull();
  });
  test("ignores null-view videos, uses most recent window", () => {
    const vids = [vid("n", null, 0), ...Array.from({ length: 25 }, (_, i) => vid(`v${i}`, 100 + i, i + 1))];
    // window 20 → most recent 20 usable: views 101..120 → median 110.5
    expect(computeChannelMedian(vids)).toBe(110.5);
  });
  test("null when median is 0", () => {
    expect(computeChannelMedian(Array.from({ length: 6 }, (_, i) => vid(`z${i}`, 0, i)))).toBeNull();
  });
});

describe("scoreVideos", () => {
  const base = Array.from({ length: 19 }, (_, i) => vid(`b${i}`, 100_000, i + 2));
  test("scores against channel median, 1-decimal", () => {
    const spike = vid("spike", 1_240_000, 1);
    const scores = scoreVideos([spike, ...base]);
    expect(scores.get("spike")).toBe(12.4);
    expect(scores.get("b0")).toBe(1.0);
  });
  test("null score for null views; all null when median null", () => {
    const scores = scoreVideos([vid("n", null, 1), ...base]);
    expect(scores.get("n")).toBeNull();
    const tooFew = scoreVideos([vid("a", 100, 1), vid("b", 50, 2)]);
    expect(tooFew.get("a")).toBeNull();
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL ("outlier-calc" module not found).

- [ ] **Step 3:** Implement `outlier-calc.ts`:

```ts
export interface VideoForCalc { id: string; viewCount: number | null; postedAt: string }

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MIN_USABLE = 5;

export function computeChannelMedian(videos: VideoForCalc[], window = 20): number | null {
  const usable = videos
    .filter((v) => v.viewCount !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, window);
  if (usable.length < MIN_USABLE) return null;
  const m = median(usable.map((v) => v.viewCount as number));
  return m === 0 ? null : m;
}

export function scoreVideos(videos: VideoForCalc[], window = 20): Map<string, number | null> {
  const channelMedian = computeChannelMedian(videos, window);
  const out = new Map<string, number | null>();
  for (const v of videos) {
    out.set(v.id, channelMedian === null || v.viewCount === null
      ? null
      : Math.round((v.viewCount / channelMedian) * 10) / 10);
  }
  return out;
}
```

- [ ] **Step 4:** `npm test` → PASS (all suites).

- [ ] **Step 5:** Commit: `feat: outlier score engine (median-based, null-safe)`.

### Task 5: Deterministic demo seed

**Files:**
- Create: `src/server/db/seed.ts`, `src/server/db/seed-data.ts`, `src/server/db/seed.test.ts`
- Modify: `package.json` (script `"db:seed": "tsx src/server/db/seed.ts"`; `npm i -D tsx`)

**Interfaces:**
- Consumes: `db/newId/nowIso/tables` from Task 3, `scoreVideos` from Task 4.
- Produces: `npm run db:seed` → populated demo DB; exported `seedDatabase(dbInstance)` for tests.

- [ ] **Step 1:** `seed-data.ts`: deterministic PRNG + fixtures. Code:

```ts
// mulberry32 — deterministic across runs so tests can assert exact counts
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_CHANNELS = [
  { handle: "@buildinpublic.daily", displayName: "Build In Public Daily", followerCount: 342_000, baseViews: 180_000, niche: "ai-startups" },
  { handle: "@aitoolsforcreators", displayName: "AI Tools For Creators", followerCount: 1_150_000, baseViews: 640_000, niche: "ai-tools" },
  { handle: "@solofounderdiary", displayName: "Solo Founder Diary", followerCount: 88_000, baseViews: 45_000, niche: "founder-story" },
  { handle: "@shortformlab", displayName: "Short Form Lab", followerCount: 415_000, baseViews: 210_000, niche: "content-strategy" },
] as const;

export const CAPTION_POOL = [
  "3 mistakes killing your first 1,000 followers",
  "I automated my whole content pipeline with one prompt",
  "the AI tool nobody is talking about (yet)",
  "how this reel got 2M views in 48 hours",
  "stop editing videos manually. do this instead",
  "my exact system for daily posts as a solo founder",
  "this took 11 minutes and outperformed everything",
  "the hook formula behind every viral reel",
  "why your reels die at 200 views",
  "I studied 100 viral reels. here's the pattern",
];
// planted outliers: [channelIndex, multiplier]
export const PLANTED_OUTLIERS: [number, number][] = [[0, 12.4], [0, 3.2], [1, 38.0], [1, 6.8], [2, 22.4], [2, 2.6], [3, 9.1], [3, 4.4]];
```

- [ ] **Step 2:** `seed.ts`: exported `seedDatabase(db)` — wipes tables, inserts 4 channels, 20 videos each (80 total): `views = round(baseViews * lognormal)` where `lognormal = exp(0.6 * gauss(rng))` (Box–Muller with mulberry32, seed `1337`), `postedAt` spread every ~4–5 days over 90 days, duration 15–90s, captions cycled from pool, url/externalId `demo-<ch>-<i>`, thumbnailUrl null. Then overwrite the planted outlier videos' views to `multiplier × channel median` (compute via `scoreVideos` after first pass, adjust, recompute and persist `outlierScore` for every video). Insert: 2 fleets ("AI Niche" → channels 0,1,2; "Craft References" → 3) via `fleetChannels`; 2 system saved filters "Balanced" `{minScore:5,timeframeDays:30}` and "High Conviction" `{minScore:10,timeframeDays:14,minViews:500000}` with `isSystem: true`; 6 vault items (3 hooks e.g. "Negative warning: 'X mistakes killing your Y'", 3 styles e.g. "Fast-cut listicle, 5 beats, CTA at end"); 2 demo scripts; transcripts for the 8 planted outliers (3–4 sentence fake transcripts referencing their caption); `app_settings` row `niche_profile` = "AI tools and building-in-public for solo founders (kaiships.ai)". `main()` guard: `if (process.argv[1]?.endsWith("seed.ts")) { seedDatabase(db); console.log(summary); }`.

- [ ] **Step 3:** `seed.test.ts` (in-memory DB + migrate like Task 3): assert exactly 4 channels, 80 videos, ≥8 videos with `outlierScore >= 2.5`, top score `38 ± 0.5` , every video's `outlierScore !== undefined`, 2 fleets, 2 system filters, 6 vault items, determinism (run twice → same top-5 video view counts).

- [ ] **Step 4:** `npm test` → PASS. Then `npm run db:seed` against the file DB; expect console summary `4 channels · 80 videos · 8 planted outliers`.

- [ ] **Step 5:** Commit: `feat: deterministic demo seed (4 channels, 80 videos, planted outliers)`.

### Task 6: App shell + routes

**Files:**
- Create: `src/components/layout/sidebar.tsx`, `src/components/layout/topbar.tsx`, `src/components/layout/command-menu.tsx`, `src/app/(shell)/layout.tsx`, and stub pages: `src/app/(shell)/page.tsx` (Dashboard), `.../feed/page.tsx`, `.../feed/[videoId]/page.tsx`, `.../feed/[videoId]/remix/page.tsx`, `.../channels/page.tsx`, `.../channels/[channelId]/page.tsx`, `.../vault/page.tsx`, `.../settings/page.tsx`
- Delete: old `src/app/page.tsx` (moves under `(shell)`)

**Interfaces:**
- Consumes: shadcn `Command`, `Dialog`, `Button`, `Separator`.
- Produces: `(shell)` route group all later UI work lands in; nav contract: Dashboard `/`, Feed `/feed`, Channels `/channels`, Vault `/vault`, Settings `/settings`.

- [ ] **Step 1:** Build shell per DESIGN.md §2.0: `(shell)/layout.tsx` = CSS grid `grid-cols-[240px_1fr]` h-screen; left `<Sidebar/>`; right column = `<Topbar/>` (h-14, border-b) + scrollable `<main>`. Sidebar: wordmark "Crowsnest" (font-semibold, tracking-tight), nav items with lucide icons (`LayoutDashboard, Flame, Users, Archive, Settings`), active = left 2px `bg-primary` bar + `bg-secondary` rounded item (use `usePathname()`; client component); footer sync-status stub: muted dot + "Never synced" + disabled refresh icon button. Collapse-to-rail: skip (phase 4 polish — noted, not lost). Topbar: page title from a small route→title map, right side: ⌘K trigger button (styled as faux input, w-64, muted "Search… ⌘K") + context action slot (empty now).

- [ ] **Step 2:** `command-menu.tsx`: shadcn `CommandDialog` bound to ⌘K/ctrl+K (`useEffect` keydown), items = the 5 nav routes with icons, `router.push` on select. Mount it in `(shell)/layout.tsx`.

- [ ] **Step 3:** Each stub page: real `<h1>` (page name) + one-line muted description + `Card` placeholder ("Phase 2/3 builds this — see docs/PLAN.md"). Dynamic segments read their param and print it (proves routing).

- [ ] **Step 4:** `npm run build` → all routes compile. Dev-server click-through: all 5 nav items + ⌘K palette navigate; active state tracks.

- [ ] **Step 5:** Commit: `feat: app shell — sidebar, topbar, command palette, route stubs`.

### Task 7: Wrap-up + verification

**Files:**
- Create: `README.md` (overwrite scaffold default)
- Modify: none

- [ ] **Step 1:** README: what Crowsnest is (1 paragraph, own words, no Sandcastles mention), quickstart (`npm i`, `npm run db:push` — or `db:migrate` per Task 3's chosen mechanism, `npm run db:seed`, `npm run dev`), scripts table, env var table (`ANTHROPIC_API_KEY`, `APIFY_TOKEN`, `GROQ_API_KEY`, `HIKERAPI_KEY`, `CLAUDE_MODEL`, `CROWSNEST_DB_PATH` — all optional, keyless demo works), pointer to `docs/`.

- [ ] **Step 2:** Full gate: `npm run build && npm test` → both green. `git status` → clean tree except intended files.

- [ ] **Step 3:** Commit: `docs: README quickstart`. Report back: commits list, test count, any deviations from this plan.
