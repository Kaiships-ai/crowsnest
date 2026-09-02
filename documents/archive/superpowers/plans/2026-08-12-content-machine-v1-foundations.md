# Content machine v1, foundations plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the storage and data foundations the content machine loop needs: a video_kind on planned posts, a configured vault + sandbox path with pure path helpers, and an AssetStore seam over the existing content-addressed media store.

**Architecture:** Three independent, unit-testable pieces. video_kind is a nullable column plus a validated allow-list. The path helpers are pure functions over a new config var. The AssetStore is a thin interface over the existing `src/server/media/store.ts` so a Cloudflare R2 backend is a later swap, not a rewrite. No runtime infra (no server, no terminal, no publish) is in this plan.

**Tech stack:** Next.js 16, drizzle + better-sqlite3, vitest, TypeScript.

## Global constraints

- npm and node are not on the Bash PATH. Prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- This is a modified Next.js. Read node_modules/next/dist/docs/ before writing any router or server code.
- Migrations are forward-only (docs/product/db-recovery.md). Never edit or delete an existing migration file. Generate a new forward migration with `npm run db:generate`. `npm run db:migrate` backs up the DB first and refuses to run if the backup fails.
- Storage paths in the DB are relative to MEDIA_ROOT, never absolute. Always go through `resolveAssetPath` (the traversal boundary) to get a real path.
- `src/server/config.ts` is the only place `process.env` is read. Add new env vars there with a zod default, copying the `MEDIA_ROOT` shape. Anything on the boot/migrate path must live in config.ts, not the DB-backed settings.
- Tests use vitest. Leave the whole suite green. Prefix the run with the PATH export.
- video_kind allow-list (from KSA /ksa:cooking, verbatim): `explainer`, `site-tour`, `product-promo`, `music-video`, `pr-announcement`, `talking-head`, `slideshow`, `general`. The picker default is `explainer`. The column is nullable.
- The vault is external (Kai-Official-OS), referenced only in docs today. Its absolute path is `/Users/kienbeovl/Desktop/entrepreneur/Kai-Official-OS`.

---

## Task 1: video_kind on planned posts

**Files:**
- Create: `src/server/services/video-kind.ts`
- Create: `src/server/services/video-kind.test.ts`
- Modify: `src/server/db/schema.ts` (plannedPosts, around :378-407)
- Generate: `drizzle/00NN_*.sql` (via db:generate)
- Modify: `src/server/actions/planned-post-actions.ts` (the create/update action)
- Modify: `src/server/queries/planned-posts.ts` (return videoKind on the read side)

**Interfaces:**
- Produces: `VIDEO_KINDS: readonly string[]`, `type VideoKind`, `DEFAULT_VIDEO_KIND = "explainer"`, `isVideoKind(v: unknown): v is VideoKind`. The planned-post write action accepts an optional `videoKind` and rejects a non-allow-list value. The `planned_posts` row and the calendar query expose `videoKind: string | null`.

- [ ] **Step 1: Write the failing test for the allow-list**

```ts
// src/server/services/video-kind.test.ts
import { describe, expect, it } from "vitest";
import { VIDEO_KINDS, DEFAULT_VIDEO_KIND, isVideoKind } from "./video-kind";

describe("video-kind", () => {
  it("has the eight KSA kinds and explainer as default", () => {
    expect(VIDEO_KINDS).toEqual([
      "explainer", "site-tour", "product-promo", "music-video",
      "pr-announcement", "talking-head", "slideshow", "general",
    ]);
    expect(DEFAULT_VIDEO_KIND).toBe("explainer");
  });
  it("accepts a valid kind and rejects anything else", () => {
    expect(isVideoKind("talking-head")).toBe(true);
    expect(isVideoKind("reel")).toBe(false);
    expect(isVideoKind(null)).toBe(false);
    expect(isVideoKind(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/services/video-kind.test.ts`
Expected: FAIL, cannot find module ./video-kind.

- [ ] **Step 3: Implement the allow-list**

```ts
// src/server/services/video-kind.ts
export const VIDEO_KINDS = [
  "explainer", "site-tour", "product-promo", "music-video",
  "pr-announcement", "talking-head", "slideshow", "general",
] as const;

export type VideoKind = (typeof VIDEO_KINDS)[number];

export const DEFAULT_VIDEO_KIND: VideoKind = "explainer";

export function isVideoKind(v: unknown): v is VideoKind {
  return typeof v === "string" && (VIDEO_KINDS as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/services/video-kind.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the column to the schema**

In `src/server/db/schema.ts`, inside the `plannedPosts` table (near `targetLengthSec`, :386), add a nullable text column following the existing `note`/`plannedTime` pattern:

```ts
  videoKind: text("video_kind"),
```

- [ ] **Step 6: Generate the forward migration**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm run db:generate`
Expected: a new file `drizzle/00NN_*.sql` containing `ALTER TABLE \`planned_posts\` ADD \`video_kind\` text;` and an updated `drizzle/meta/_journal.json`. Do not hand-edit either. Do not run db:migrate here; the controller applies it at runtime.

- [ ] **Step 7: Wire videoKind into the planned-post write action**

Read `src/server/actions/planned-post-actions.ts`. In the create/update action, accept an optional `videoKind` field on the input. Before the DB write, validate it: if `videoKind` is present and `!isVideoKind(videoKind)`, return the action-result error shape (`{ ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" }`) using the module's existing result pattern. Persist `videoKind` on the upsert. Import `isVideoKind` from `@/server/services/video-kind`.

- [ ] **Step 8: Return videoKind on the read side**

In `src/server/queries/planned-posts.ts`, add `videoKind` to the selected columns of the calendar/plan query so the UI can read it. Match the existing select style in that file.

- [ ] **Step 9: Write a db test that the column round-trips and validation holds**

Add a vitest that uses the repo's existing db test harness (find how other `src/server/actions/*.test.ts` or `src/server/queries/*.test.ts` seed an in-memory or temp db and mirror it). Assert: creating/updating a planned post with `videoKind: "talking-head"` persists and the calendar query returns it; an update with `videoKind: "reel"` returns the `BAD_VIDEO_KIND` error and does not write.

- [ ] **Step 10: Run the focused tests, then the full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/services/video-kind.test.ts <the new db test path>` then `npm test -- --run`
Expected: all pass, output pristine.

- [ ] **Step 11: Commit**

```bash
git add src/server/services/video-kind.ts src/server/services/video-kind.test.ts src/server/db/schema.ts drizzle/ src/server/actions/planned-post-actions.ts src/server/queries/planned-posts.ts
git commit -m "feat(planner): add validated video_kind to planned posts"
```

---

## Task 2: vault config and sandbox path helpers

**Files:**
- Modify: `src/server/config.ts` (add VAULT_PATH near MEDIA_ROOT, :58)
- Modify: `.env.example` (document VAULT_PATH)
- Create: `src/server/studio/paths.ts`
- Create: `src/server/studio/paths.test.ts`

**Interfaces:**
- Produces: `config.VAULT_PATH: string`. `slugify(title: string): string`, `sandboxDir(slug: string): string` (the per-post Claude Code cwd, `<vault>/Studio/workspace/videos/<slug>`), `rendersDir(dateISO: string, slug: string): string` (`<vault>/Studio/workspace/renders/<dateISO>-<slug>`). All pure, no filesystem side effects.

- [ ] **Step 1: Write the failing test for the path helpers**

```ts
// src/server/studio/paths.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/config", () => ({ config: { VAULT_PATH: "/vault" } }));
import { slugify, sandboxDir, rendersDir } from "./paths";

describe("studio paths", () => {
  it("slugifies a title to a safe slug", () => {
    expect(slugify("7 Free AI Tools nobody uses!")).toBe("7-free-ai-tools-nobody-uses");
    expect(slugify("  spaced  --  out  ")).toBe("spaced-out");
  });
  it("builds the per-post sandbox and renders dirs under the vault", () => {
    expect(sandboxDir("7-free-ai-tools")).toBe("/vault/Studio/workspace/videos/7-free-ai-tools");
    expect(rendersDir("2026-08-12", "7-free-ai-tools")).toBe("/vault/Studio/workspace/renders/2026-08-12-7-free-ai-tools");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/studio/paths.test.ts`
Expected: FAIL, cannot find module ./paths.

- [ ] **Step 3: Add VAULT_PATH to config**

In `src/server/config.ts`, next to `MEDIA_ROOT` (:58), add, copying the `z.string().min(1).default(...)` shape:

```ts
    VAULT_PATH: z.string().min(1).default("/Users/kienbeovl/Desktop/entrepreneur/Kai-Official-OS"),
```

- [ ] **Step 4: Implement the path helpers**

```ts
// src/server/studio/paths.ts
import path from "node:path";
import { config } from "@/server/config";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const workspace = () => path.join(config.VAULT_PATH, "Studio", "workspace");

export function sandboxDir(slug: string): string {
  return path.join(workspace(), "videos", slug);
}

export function rendersDir(dateISO: string, slug: string): string {
  return path.join(workspace(), "renders", `${dateISO}-${slug}`);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/studio/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Document the env var**

In `.env.example`, add near the MEDIA_ROOT line:

```
# Absolute path to the Kai-Official-OS Obsidian vault. The create studio runs
# Claude Code with a per-post subdir of this as its cwd, and reads the craft
# playbooks here read-only.
VAULT_PATH=/Users/kienbeovl/Desktop/entrepreneur/Kai-Official-OS
```

- [ ] **Step 7: Run the full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/config.ts .env.example src/server/studio/paths.ts src/server/studio/paths.test.ts
git commit -m "feat(studio): add vault config and per-post sandbox path helpers"
```

---

## Task 3: AssetStore seam over the media store

**Files:**
- Create: `src/server/media/asset-store.ts`
- Create: `src/server/media/asset-store.test.ts`
- Read (do not modify): `src/server/media/store.ts` (reuse `storagePathFor`, `resolveAssetPath`, `recordAsset`, `getAsset`, `assetUrl`)

**Interfaces:**
- Produces: `interface AssetStore { put(file: { path: string }, kind: "video" | "thumbnail", contentType: string): Promise<string>; get(id: string): Promise<{ path: string } | null>; publicUrl(id: string): string; }` and `getAssetStore(): AssetStore` returning a `LocalAssetStore` singleton. `put` ingests a local file into the content-addressed store and returns the media_assets id. Same bytes ingested twice return the same id (dedup by sha256). `publicUrl(id)` returns `/api/media/<id>`.

**Context:** The rendered MP4 lands as a local file in the vault renders dir (Task 2). `put` copies it into MEDIA_ROOT under `<sha>[0:2]/<sha>.<ext>` and records the row, reusing the existing store. Later, a `R2AssetStore` implements the same interface and `publicUrl` returns the bucket URL, replacing the Vercel hosting step. This task ships only `LocalAssetStore`.

- [ ] **Step 1: Read the store helpers you will reuse**

Read `src/server/media/store.ts` and note the exact signatures of `storagePathFor`, `resolveAssetPath`, `recordAsset`, `getAsset`, `assetUrl`, and how `recordAsset` dedups by sha256 and catches the unique-index violation (:177-217). Your `put` computes the sha256, writes the file to the resolved storage path if absent, then calls `recordAsset` with the metadata it expects. Do not duplicate the dedup logic; call `recordAsset`.

- [ ] **Step 2: Write the failing test**

```ts
// src/server/media/asset-store.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point MEDIA_ROOT at a temp dir for the test (mirror how other media tests isolate the root).
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "assetstore-")); process.env.MEDIA_ROOT = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("LocalAssetStore", () => {
  it("puts a local file, reads it back, dedups by bytes, and builds a public url", async () => {
    const { getAssetStore } = await import("./asset-store");
    const store = getAssetStore();
    const src = path.join(root, "video.mp4");
    writeFileSync(src, Buffer.from("fake mp4 bytes"));

    const id1 = await store.put({ path: src }, "video", "video/mp4");
    const id2 = await store.put({ path: src }, "video", "video/mp4");
    expect(id2).toBe(id1); // dedup by sha256

    const got = await store.get(id1);
    expect(got).not.toBeNull();
    expect(readFileSync(got!.path).toString()).toBe("fake mp4 bytes");

    expect(store.publicUrl(id1)).toBe(`/api/media/${id1}`);
    expect(await store.get("does-not-exist")).toBeNull();
  });
});
```

Note: match however the existing media-store tests isolate MEDIA_ROOT (the recon shows `config.MEDIA_ROOT` is read via `path.resolve` in `store.ts:36-38`; if config is read once at import, mirror that test's setup, e.g. resetting modules, rather than setting the env var late). Read one existing store test before finalizing this harness.

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/media/asset-store.test.ts`
Expected: FAIL, cannot find module ./asset-store.

- [ ] **Step 4: Implement LocalAssetStore**

Write `src/server/media/asset-store.ts`: the `AssetStore` interface, a `LocalAssetStore` whose `put` reads the file bytes, computes `sha256` (node:crypto), derives ext from the contentType, writes to `resolveAssetPath(storagePathFor(sha256, ext))` when the file is not already there, calls `recordAsset(...)` with the metadata (id via the store's own id, byteSize, contentType, kind, storagePath), and returns the id; `get` calls `getAsset(id)` then returns `{ path: resolveAssetPath(row.storagePath) }` or null; `publicUrl` returns `assetUrl(id)`. Export `getAssetStore()` returning a module-level singleton. Reuse the store helpers, do not reimplement path resolution or dedup.

- [ ] **Step 5: Run the test and watch it pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/media/asset-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/media/asset-store.ts src/server/media/asset-store.test.ts
git commit -m "feat(media): add AssetStore seam with a local content-addressed backend"
```

---

## Self-review notes

- Spec coverage: this plan covers the spec's video_kind picker data, the vault/sandbox path, and the AssetStore seam (local). It does NOT cover the web terminal, the studio screen, or publish, which are separate plans by design.
- The migration is generated in Task 1 but applied by the controller at runtime (subagents do not run the dev server or mutate the shared DB). Applying it may hit the documented dev-db migration desync; the controller resolves that outside this plan.
- Task 3's test harness for isolating MEDIA_ROOT is the one soft spot: the implementer must read an existing media-store test and mirror its isolation, because config reads env at import time.
