import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * End-to-end-ish test of the media endpoint: a REAL file with REAL random bytes on disk,
 * a REAL row in an in-memory SQLite database, the exported handlers called with a REAL
 * `Request`. Bodies are compared byte for byte — a 206 that returns the right length but
 * the wrong offset is exactly the bug that makes <video> seeking silently broken.
 */

let mediaRootDir: string;
let assetId: string;
let assetSha: string;
let assetBytes: Buffer;

const SIZE = 4096;

type Handler = (request: Request, ctx: { params: Promise<{ assetId: string }> }) => Promise<Response>;

const ctx = (id: string) => ({ params: Promise.resolve({ assetId: id }) });

const call = (handler: Handler, id: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost:3000/api/media/${id}`, { headers }), ctx(id));

/** Writes real bytes into the media root and records them, returning the asset row. */
async function storeBytes(bytes: Buffer, contentType: string, kind: "thumbnail" | "video" | "avatar") {
  const { recordAsset, storagePathFor, resolveAssetPath } = await import("@/server/media/store");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rel = storagePathFor(sha256, contentType);
  const abs = resolveAssetPath(rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return recordAsset({ sha256, kind, contentType, byteSize: bytes.byteLength });
}

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  mediaRootDir = mkdtempSync(path.join(tmpdir(), "crowsnest-media-"));
  process.env.MEDIA_ROOT = mediaRootDir;

  const { migrate } = await import("@/server/db/test-migrate");
  migrate();

  assetBytes = randomBytes(SIZE);
  const asset = await storeBytes(assetBytes, "video/mp4", "video");
  assetId = asset.id;
  assetSha = asset.sha256;
});

afterAll(() => {
  rmSync(mediaRootDir, { recursive: true, force: true });
});

describe("GET /api/media/[assetId]", () => {
  test("200 with the full file, correct headers, and byte-identical body", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe(String(SIZE));
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("ETag")).toBe(`"${assetSha}"`);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Content-Range")).toBeNull();

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBe(SIZE);
    expect(body.equals(assetBytes)).toBe(true);
    expect(createHash("sha256").update(body).digest("hex")).toBe(assetSha);
  });

  test("206 for `bytes=0-1023` returns exactly the first 1024 bytes", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId, { Range: "bytes=0-1023" });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-1023/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe("1024");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("ETag")).toBe(`"${assetSha}"`);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBe(1024);
    expect(body.equals(assetBytes.subarray(0, 1024))).toBe(true);
  });

  test("206 for a mid-file range returns that slice, not the head of the file", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId, { Range: "bytes=1500-2499" });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 1500-2499/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe("1000");

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(assetBytes.subarray(1500, 2500))).toBe(true);
    expect(body.equals(assetBytes.subarray(0, 1000))).toBe(false);
  });

  test("206 for a suffix range returns the tail", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId, { Range: "bytes=-500" });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 3596-4095/${SIZE}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(assetBytes.subarray(SIZE - 500))).toBe(true);
  });

  test("206 for an open-ended range clamps to EOF", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId, { Range: "bytes=4000-" });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 4000-4095/${SIZE}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(assetBytes.subarray(4000))).toBe(true);
  });

  test("the concatenation of two adjacent ranges reproduces the whole file", async () => {
    const { GET } = await import("./serve");
    const head = Buffer.from(await (await call(GET, assetId, { Range: "bytes=0-2047" })).arrayBuffer());
    const tail = Buffer.from(await (await call(GET, assetId, { Range: "bytes=2048-" })).arrayBuffer());
    const joined = Buffer.concat([head, tail]);
    expect(joined.byteLength).toBe(SIZE);
    expect(createHash("sha256").update(joined).digest("hex")).toBe(assetSha);
  });

  test("416 with `Content-Range: bytes */size` when the range starts past EOF", async () => {
    const { GET } = await import("./serve");
    const res = await call(GET, assetId, { Range: "bytes=5000-6000" });

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe(`bytes */${SIZE}`);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  test("a malformed or multi-range header is ignored and the full file is served (RFC 9110)", async () => {
    const { GET } = await import("./serve");
    for (const range of ["bytes=abc", "items=0-10", "bytes=0-99,200-299", "bytes=500-100"]) {
      const res = await call(GET, assetId, { Range: range });
      expect(res.status, range).toBe(200);
      expect(res.headers.get("Content-Range"), range).toBeNull();
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.equals(assetBytes), range).toBe(true);
    }
  });

  test("304 when If-None-Match matches, 200 when it does not", async () => {
    const { GET } = await import("./serve");

    const notModified = await call(GET, assetId, { "If-None-Match": `"${assetSha}"` });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("ETag")).toBe(`"${assetSha}"`);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);

    const weak = await call(GET, assetId, { "If-None-Match": `W/"${assetSha}"` });
    expect(weak.status).toBe(304);

    const listed = await call(GET, assetId, { "If-None-Match": `"other", "${assetSha}"` });
    expect(listed.status).toBe(304);

    const wildcard = await call(GET, assetId, { "If-None-Match": "*" });
    expect(wildcard.status).toBe(304);

    const stale = await call(GET, assetId, { "If-None-Match": `"${"f".repeat(64)}"` });
    expect(stale.status).toBe(200);
    expect((await stale.arrayBuffer()).byteLength).toBe(SIZE);
  });

  test("404 for an unknown or malformed asset id", async () => {
    const { GET } = await import("./serve");
    for (const id of ["does-not-exist", "../../etc/passwd", "%2e%2e", " "]) {
      const res = await call(GET, id);
      expect(res.status, id).toBe(404);
    }
  });

  test("404 (never invented bytes) when the row exists but the file is gone", async () => {
    const { GET } = await import("./serve");
    const { resolveAssetPath } = await import("@/server/media/store");
    const ghost = await storeBytes(randomBytes(128), "image/jpeg", "thumbnail");
    rmSync(resolveAssetPath(ghost.storagePath));

    const res = await call(GET, ghost.id);
    expect(res.status).toBe(404);
    expect((await res.arrayBuffer()).byteLength).toBeLessThan(64); // a short plain-text body, not an image
  });

  test("404 when a row's storage_path escapes the media root", async () => {
    const { GET } = await import("./serve");
    const { db, newId, nowIso, tables } = await import("@/server/db");
    // Written straight to the table, bypassing recordAsset's validation, to prove the
    // serving path re-checks containment rather than trusting the row.
    const id = newId();
    await db.insert(tables.mediaAssets).values({
      id,
      sha256: "9".repeat(64),
      kind: "thumbnail",
      contentType: "image/jpeg",
      byteSize: 10,
      storagePath: "../../../../../../etc/passwd",
      downloadedAt: nowIso(),
    });

    const res = await call(GET, id);
    expect(res.status).toBe(404);
  });

  test("serves a second, differently-typed asset with its own content type", async () => {
    const { GET } = await import("./serve");
    const bytes = randomBytes(777);
    const thumb = await storeBytes(bytes, "image/jpeg", "thumbnail");
    const res = await call(GET, thumb.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Length")).toBe("777");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });
});

describe("HEAD /api/media/[assetId]", () => {
  test("200 with the same headers as GET and an empty body", async () => {
    const { GET, HEAD } = await import("./serve");
    const head = await call(HEAD, assetId);
    const get = await call(GET, assetId);

    expect(head.status).toBe(200);
    for (const header of ["Content-Type", "Content-Length", "Accept-Ranges", "ETag", "Cache-Control"]) {
      expect(head.headers.get(header), header).toBe(get.headers.get(header));
    }
    expect(head.headers.get("Content-Length")).toBe(String(SIZE));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    await get.arrayBuffer();
  });

  test("404 for an unknown id", async () => {
    const { HEAD } = await import("./serve");
    expect((await call(HEAD, "nope")).status).toBe(404);
  });

  test("range headers are honoured with no body", async () => {
    const { HEAD } = await import("./serve");
    const res = await call(HEAD, assetId, { Range: "bytes=0-1023" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-1023/${SIZE}`);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});
