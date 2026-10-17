import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getStorageProvider, S3StorageProvider } from "./storage-provider";

const ALL_ENV = ["S3_ENDPOINT", "S3_BUCKET", "S3_KEY", "S3_SECRET", "S3_PUBLIC_BASE", "S3_REGION"] as const;

function clearEnv() {
  for (const key of ALL_ENV) delete process.env[key];
}

const FULL_ENV = {
  S3_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  S3_BUCKET: "crowsnest-media",
  S3_KEY: "AKIAFAKEKEY",
  S3_SECRET: "supersecretvalue",
  S3_PUBLIC_BASE: "https://media.example.com",
};

beforeEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe("getStorageProvider", () => {
  test("null when nothing is configured", () => {
    expect(getStorageProvider()).toBeNull();
  });

  test.each(Object.keys(FULL_ENV) as (keyof typeof FULL_ENV)[])("null when %s is missing", (missing) => {
    for (const [k, v] of Object.entries(FULL_ENV)) {
      if (k !== missing) process.env[k] = v;
    }
    expect(getStorageProvider()).toBeNull();
  });

  test("returns a provider once all five vars are set", () => {
    Object.assign(process.env, FULL_ENV);
    const provider = getStorageProvider();
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });
});

describe("S3StorageProvider.upload / delete", () => {
  let dir: string;
  let localPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "storage-provider-test-"));
    localPath = join(dir, "clip.mp4");
    await writeFile(localPath, Buffer.from("fake mp4 bytes"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // A real local endpoint, not a fetch mock: the upload must not go through
  // globalThis.fetch, which Next patches in dev to hex-encode a whole request body into
  // a cache key (a 76 MB reel ran the server out of heap). Stubbing fetch to throw makes
  // any regression back onto fetch fail here.
  async function withS3Server(status: number, run: (endpoint: string, seen: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined>; body?: Buffer }) => Promise<void>) {
    const seen: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined>; body?: Buffer } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        Object.assign(seen, { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  test("upload PUTs the file bytes and returns publicBase/objectKey, signed with a valid SigV4 shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upload must not use globalThis.fetch")));
    await withS3Server(200, async (endpoint, seen) => {
      const provider = new S3StorageProvider(toConfig({ ...FULL_ENV, S3_ENDPOINT: endpoint }));
      const result = await provider.upload(localPath, "video/mp4");

      expect(result.objectKey).toMatch(/^crowsnest\/[0-9a-f-]{36}\.mp4$/);
      expect(result.publicUrl).toBe(`${FULL_ENV.S3_PUBLIC_BASE}/${result.objectKey}`);

      expect(seen.method).toBe("PUT");
      expect(seen.url).toBe(`/${FULL_ENV.S3_BUCKET}/${result.objectKey}`);
      const sent = await readFile(localPath);
      expect(seen.body?.equals(sent)).toBe(true);

      const headers = seen.headers ?? {};
      expect(headers["content-type"]).toBe("video/mp4");
      expect(headers["content-length"]).toBe(String(sent.length));
      expect(headers["x-amz-content-sha256"]).toBe(createHash("sha256").update(sent).digest("hex"));
      expect(headers.authorization).toMatch(
        new RegExp(`^AWS4-HMAC-SHA256 Credential=${FULL_ENV.S3_KEY}/\\d{8}/auto/s3/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`)
      );
      // The secret itself must never appear in any header value sent over the wire.
      expect(JSON.stringify(headers)).not.toContain(FULL_ENV.S3_SECRET);
    });
  });

  test("upload throws (and never returns a url) on a non-ok response", async () => {
    await withS3Server(403, async (endpoint) => {
      const provider = new S3StorageProvider(toConfig({ ...FULL_ENV, S3_ENDPOINT: endpoint }));
      await expect(provider.upload(localPath, "video/mp4")).rejects.toThrow(/403/);
    });
  });

  test("delete targets the same object key with a DELETE request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, statusText: "No Content" });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new S3StorageProvider(toConfig(FULL_ENV));
    await provider.delete("crowsnest/abc-123.mp4");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${FULL_ENV.S3_ENDPOINT}/${FULL_ENV.S3_BUCKET}/crowsnest/abc-123.mp4`);
    expect(init.method).toBe("DELETE");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(
      new RegExp(`^AWS4-HMAC-SHA256 Credential=${FULL_ENV.S3_KEY}/\\d{8}/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`)
    );
  });

  test("delete treats a 404 (already gone) as success, not a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));
    const provider = new S3StorageProvider(toConfig(FULL_ENV));
    await expect(provider.delete("crowsnest/gone.mp4")).resolves.toBeUndefined();
  });
});

function toConfig(env: typeof FULL_ENV) {
  return {
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_KEY,
    secret: env.S3_SECRET,
    publicBase: env.S3_PUBLIC_BASE,
  };
}
