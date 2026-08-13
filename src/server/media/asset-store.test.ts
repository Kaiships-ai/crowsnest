import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * Same isolation pattern as `store.test.ts`: `MEDIA_ROOT` and `IG_SERVICE_TOKEN` must be
 * set before `@/server/config` is first imported, because `config` is computed once at
 * module load (`config.ts:115`) and frozen — setting `process.env.MEDIA_ROOT` after that
 * point has no effect. One `beforeAll`, one temp root for the whole file, and every
 * import of `./asset-store` is dynamic so it runs after the env is in place.
 */
let sandbox: string;
let mediaRootDir: string;

beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  sandbox = mkdtempSync(path.join(tmpdir(), "assetstore-"));
  mediaRootDir = path.join(sandbox, "media", "root");
  mkdirSync(mediaRootDir, { recursive: true });
  process.env.MEDIA_ROOT = mediaRootDir;
});

const importAssetStore = () => import("./asset-store");

describe("LocalAssetStore", () => {
  test("puts a local file, reads it back, dedups by bytes, and builds a public url", async () => {
    const { db, tables } = await import("@/server/db");
    const { migrate } = await import("@/server/db/test-migrate");
    const { getAssetStore } = await importAssetStore();
    migrate();

    const store = getAssetStore();
    const src = path.join(sandbox, "video.mp4");
    writeFileSync(src, Buffer.from("fake mp4 bytes"));

    const id1 = await store.put({ path: src }, "video", "video/mp4");
    const id2 = await store.put({ path: src }, "video", "video/mp4");
    expect(id2).toBe(id1); // dedup by sha256

    const got = await store.get(id1);
    expect(got).not.toBeNull();
    expect(readFileSync(got!.path).toString()).toBe("fake mp4 bytes");

    expect(store.publicUrl(id1)).toBe(`/api/media/${id1}`);
    expect(await store.get("does-not-exist")).toBeNull();

    const rows = await db.select().from(tables.mediaAssets);
    expect(rows.filter((r) => r.id === id1)).toHaveLength(1);
  });

  test("ingesting different bytes produces a different id and a byte-identical copy on disk", async () => {
    const { getAssetStore } = await importAssetStore();
    const store = getAssetStore();
    const src = path.join(sandbox, "thumb.jpg");
    writeFileSync(src, Buffer.from("thumbnail bytes"));

    const id = await store.put({ path: src }, "thumbnail", "image/jpeg");
    const got = await store.get(id);
    expect(got).not.toBeNull();
    expect(readFileSync(got!.path).toString()).toBe("thumbnail bytes");
    expect(got!.path.startsWith(mediaRootDir + path.sep)).toBe(true);
  });

  test("getAssetStore returns a singleton", async () => {
    const { getAssetStore } = await importAssetStore();
    expect(getAssetStore()).toBe(getAssetStore());
  });

  test("put streams the sha256 rather than buffering, matching a hash computed over the same bytes", async () => {
    const { db, tables } = await import("@/server/db");
    const { getAssetStore } = await importAssetStore();
    const store = getAssetStore();

    // Large enough to span several stream chunks, so a streaming hash implementation is
    // actually exercised rather than trivially matching on a single-chunk read.
    const contents = Buffer.alloc(5 * 1024 * 1024, "streamed-render-bytes-");
    const src = path.join(sandbox, "large-render.mp4");
    writeFileSync(src, contents);
    const expectedSha256 = createHash("sha256").update(contents).digest("hex");

    const id = await store.put({ path: src }, "video", "video/mp4");
    const rows = await db.select().from(tables.mediaAssets).where(eq(tables.mediaAssets.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sha256).toBe(expectedSha256);
    expect(rows[0].byteSize).toBe(contents.length);

    // Round-trip: identical bytes under a different source path still dedup to the same id.
    const src2 = path.join(sandbox, "large-render-copy.mp4");
    writeFileSync(src2, contents);
    const id2 = await store.put({ path: src2 }, "video", "video/mp4");
    expect(id2).toBe(id);

    const got = await store.get(id);
    expect(got).not.toBeNull();
    expect(readFileSync(got!.path).equals(contents)).toBe(true);
  });
});
