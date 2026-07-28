import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * In-memory DB + migrate, same pattern as db/schema.test.ts. `MEDIA_ROOT` and
 * `IG_SERVICE_TOKEN` must be set before `@/server/config` is first imported (it
 * validates and freezes the environment at module load), hence the dynamic imports.
 */
let sandbox: string;
let mediaRootDir: string;

beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  sandbox = mkdtempSync(path.join(tmpdir(), "crowsnest-store-"));
  mediaRootDir = path.join(sandbox, "media", "root");
  mkdirSync(mediaRootDir, { recursive: true });
  // The sibling whose name has the media root as a string prefix. A naive
  // `startsWith(root)` containment check would happily serve files out of here.
  mkdirSync(path.join(sandbox, "media", "rootEVIL"), { recursive: true });
  process.env.MEDIA_ROOT = mediaRootDir;
});

const importStore = () => import("./store");

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("resolveAssetPath", () => {
  test("resolves a normal content-addressed path inside the media root", async () => {
    const { resolveAssetPath, mediaRoot } = await importStore();
    const rel = `ab/${"ab".repeat(32)}.jpg`;
    expect(resolveAssetPath(rel)).toBe(path.join(mediaRootDir, rel));
    expect(resolveAssetPath(rel).startsWith(mediaRoot() + path.sep)).toBe(true);
  });

  test("rejects `..` traversal", async () => {
    const { resolveAssetPath, MediaPathError } = await importStore();
    for (const evil of ["../secret.jpg", "../../etc/passwd", "ab/../../../etc/passwd", "ab/../../rootEVIL/x.jpg", "..", "../"]) {
      expect(() => resolveAssetPath(evil), evil).toThrow(MediaPathError);
    }
  });

  test("rejects the sibling directory whose name merely starts with the root", async () => {
    const { resolveAssetPath, MediaPathError } = await importStore();
    // Resolves to <sandbox>/media/rootEVIL/x.jpg — a string prefix of the root, but
    // NOT inside it. This is the case a `startsWith(root)` check gets wrong.
    expect(() => resolveAssetPath("../rootEVIL/x.jpg")).toThrow(MediaPathError);
    expect(() => resolveAssetPath(path.join("..", "rootEVIL", "deep", "x.jpg"))).toThrow(MediaPathError);
  });

  test("rejects absolute paths", async () => {
    const { resolveAssetPath, MediaPathError } = await importStore();
    for (const evil of ["/etc/passwd", "/", path.join(mediaRootDir, "ab", "x.jpg")]) {
      expect(() => resolveAssetPath(evil), evil).toThrow(MediaPathError);
    }
  });

  test("rejects percent-encoded traversal", async () => {
    const { resolveAssetPath, MediaPathError } = await importStore();
    for (const evil of ["%2e%2e/%2e%2e/etc/passwd", "%2e%2e%2frootEVIL/x.jpg", "%2Fetc%2Fpasswd"]) {
      expect(() => resolveAssetPath(evil), evil).toThrow(MediaPathError);
    }
  });

  test("rejects empty, blank, NUL-bearing paths and the root itself", async () => {
    const { resolveAssetPath, MediaPathError } = await importStore();
    for (const evil of ["", "   ", "ab/x\0.jpg", ".", "./"]) {
      expect(() => resolveAssetPath(evil), JSON.stringify(evil)).toThrow(MediaPathError);
    }
  });

  test("a malformed percent sequence is not fatal when the raw path is contained", async () => {
    const { resolveAssetPath } = await importStore();
    // decodeURIComponent throws on `%zz`; the raw form is still safely inside the root.
    expect(resolveAssetPath("ab/100%zz.jpg")).toBe(path.join(mediaRootDir, "ab", "100%zz.jpg"));
  });
});

describe("storagePathFor", () => {
  test("fans out on the first two hex characters", async () => {
    const { storagePathFor } = await importStore();
    expect(storagePathFor(SHA_B, "image/jpeg")).toBe(`01/${SHA_B}.jpg`);
    expect(storagePathFor(SHA_A, "video/mp4")).toBe(`aa/${SHA_A}.mp4`);
  });

  test("maps the content types we actually store, and falls back to bin", async () => {
    const { storagePathFor, extensionForContentType } = await importStore();
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/webp")).toBe("webp");
    expect(extensionForContentType("video/mp4")).toBe("mp4");
    expect(extensionForContentType("IMAGE/JPEG; charset=binary")).toBe("jpg");
    expect(extensionForContentType("application/octet-stream")).toBe("bin");
    expect(extensionForContentType("")).toBe("bin");
    expect(storagePathFor(SHA_A, "application/octet-stream")).toBe(`aa/${SHA_A}.bin`);
  });

  test("rejects anything that is not a 64-char hex digest (it becomes a path segment)", async () => {
    const { storagePathFor, MediaPathError } = await importStore();
    for (const bad of ["", "abc", "../../etc/passwd", "g".repeat(64), `${SHA_A}extra`, "a".repeat(63)]) {
      expect(() => storagePathFor(bad, "image/jpeg"), JSON.stringify(bad)).toThrow(MediaPathError);
    }
  });

  test("normalises an uppercase digest rather than creating a second file for it", async () => {
    const { storagePathFor } = await importStore();
    expect(storagePathFor(SHA_B.toUpperCase(), "image/jpeg")).toBe(`01/${SHA_B}.jpg`);
  });
});

describe("assetUrl", () => {
  test("builds the one canonical media URL", async () => {
    const { assetUrl } = await importStore();
    expect(assetUrl("7f3a")).toBe("/api/media/7f3a");
  });

  test("null-ish ids produce null, never a broken href", async () => {
    const { assetUrl } = await importStore();
    expect(assetUrl(null)).toBeNull();
    expect(assetUrl(undefined)).toBeNull();
    expect(assetUrl("")).toBeNull();
  });

  test("escapes ids so a value can never break out of the path segment", async () => {
    const { assetUrl } = await importStore();
    expect(assetUrl("../../etc/passwd")).toBe("/api/media/..%2F..%2Fetc%2Fpasswd");
  });
});

describe("recordAsset", () => {
  test("dedupes by sha256: the same bytes recorded twice yield one row", async () => {
    const { db, tables } = await import("@/server/db");
    const { migrate } = await import("@/server/db/test-migrate");
    const { recordAsset, storagePathFor } = await importStore();
    migrate();

    const first = await recordAsset({
      sha256: SHA_A,
      kind: "thumbnail",
      contentType: "image/jpeg",
      byteSize: 1234,
      width: 640,
      height: 640,
    });
    const second = await recordAsset({
      sha256: SHA_A,
      kind: "thumbnail",
      contentType: "image/jpeg",
      byteSize: 1234,
    });

    expect(second.id).toBe(first.id);
    expect(first.storagePath).toBe(storagePathFor(SHA_A, "image/jpeg"));
    expect(first.byteSize).toBe(1234);
    expect(first.width).toBe(640);
    expect(first.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const rows = await db.select().from(tables.mediaAssets);
    expect(rows.filter((r) => r.sha256 === SHA_A)).toHaveLength(1);
  });

  test("two interleaved recordAsset calls for the same digest converge on one row", async () => {
    const { db, tables } = await import("@/server/db");
    const { recordAsset } = await importStore();
    // Both calls run their existence check before either insert lands, so the second
    // insert really does hit the UNIQUE index — this exercises the recovery path, not
    // the pre-check.
    const [a, b] = await Promise.all([
      recordAsset({ sha256: SHA_B, kind: "video", contentType: "video/mp4", byteSize: 999, durationSec: 12.5 }),
      recordAsset({ sha256: SHA_B, kind: "video", contentType: "video/mp4", byteSize: 999, durationSec: 12.5 }),
    ]);
    expect(a.id).toBe(b.id);
    const rows = await db.select().from(tables.mediaAssets);
    expect(rows.filter((r) => r.sha256 === SHA_B)).toHaveLength(1);
  });

  test("different bytes get different rows and different paths", async () => {
    const { recordAsset } = await importStore();
    const sha = "b".repeat(64);
    const row = await recordAsset({ sha256: sha, kind: "avatar", contentType: "image/png", byteSize: 42 });
    expect(row.storagePath).toBe(`bb/${sha}.png`);
    expect(row.kind).toBe("avatar");
  });

  test("refuses a bogus digest or byte size instead of writing an unservable row", async () => {
    const { recordAsset, MediaPathError } = await importStore();
    await expect(recordAsset({ sha256: "nope", kind: "thumbnail", contentType: "image/jpeg", byteSize: 1 })).rejects.toThrow(MediaPathError);
    await expect(recordAsset({ sha256: "c".repeat(64), kind: "thumbnail", contentType: "image/jpeg", byteSize: -1 })).rejects.toThrow(/byteSize/);
  });

  test("refuses an explicit storage path that escapes the media root", async () => {
    const { recordAsset, MediaPathError } = await importStore();
    await expect(
      recordAsset({ sha256: "d".repeat(64), kind: "video", contentType: "video/mp4", byteSize: 1, storagePath: "../rootEVIL/x.mp4" })
    ).rejects.toThrow(MediaPathError);
  });
});

describe("getAsset", () => {
  test("returns the row by id, and null for anything unknown", async () => {
    const { recordAsset, getAsset, getAssetBySha256 } = await importStore();
    const sha = "e".repeat(64);
    const created = await recordAsset({ sha256: sha, kind: "thumbnail", contentType: "image/webp", byteSize: 7 });
    const found = await getAsset(created.id);
    expect(found?.sha256).toBe(sha);
    expect(await getAssetBySha256(sha.toUpperCase())).not.toBeNull();
    expect(await getAsset("no-such-id")).toBeNull();
    expect(await getAsset("")).toBeNull();
    expect(await getAsset(null)).toBeNull();
  });
});
