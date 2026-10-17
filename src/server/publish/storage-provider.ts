import { createHash, createHmac, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname } from "node:path";

/**
 * Pluggable public-URL storage for the Reels publish path (see
 * documents/architecture/publish.md).
 *
 * The Instagram Graph API publishes a Reel by fetching the video from a PUBLIC https
 * URL — it does not accept a binary upload. This module uploads a local mp4 to an
 * S3-compatible bucket (Cloudflare R2 or AWS S3) and hands back that public URL, and
 * deletes the object again once the publish (or dry-run) is done with it.
 *
 * Round 0 has exactly one implementation, `S3StorageProvider`. `getStorageProvider()`
 * is the seam: it returns `null` when the five `S3_*` env vars are not all set, so a
 * caller renders an honest "not configured" state instead of a fabricated one (see the
 * plan's locked decision 6).
 */

export interface StorageProvider {
  /** Uploads the local file at `localPath` and returns its public URL plus the object
   *  key it was stored under (needed later to delete it). */
  upload(localPath: string, contentType: string): Promise<{ publicUrl: string; objectKey: string }>;
  /** Removes the object. Called after a Reel container has consumed the public URL, so
   *  the bucket never accumulates published videos. */
  delete(objectKey: string): Promise<void>;
}

export interface S3StorageConfig {
  /** S3-compatible endpoint, e.g. `https://<accountid>.r2.cloudflarestorage.com` for
   *  R2, or `https://s3.<region>.amazonaws.com` for AWS. No trailing slash. */
  endpoint: string;
  bucket: string;
  accessKey: string;
  secret: string;
  /** Base URL the bucket is reachable at publicly, e.g. `https://media.example.com`.
   *  The public URL handed to the Graph API is `${publicBase}/${objectKey}`. */
  publicBase: string;
  /** SigV4 region. R2 has no real regions and signs everything as "auto"; a real AWS
   *  bucket needs its actual region here. Defaults to "auto" because R2 is this plan's
   *  primary target (see the plan's locked decision 2). */
  region?: string;
}

// ---------------------------------------------------------------- SigV4 (hand-rolled)
//
// ponytail: this repo has no AWS SDK installed (checked package.json / node_modules —
// neither @aws-sdk/client-s3 nor @aws-sdk/s3-request-presigner is a dependency), and a
// single presigned-PUT-and-DELETE-object client is a few dozen lines of SigV4, not a
// reason to add a ~200-file dependency. This is the one corner in this file that is NOT
// cut lazily: a wrong signature is a silent 403, not a compile error. Upgrade to
// @aws-sdk/client-s3 if multipart upload ever becomes a requirement (S3 caps a single
// PUT at 5 GB).

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/** AWS's URI-encoding rule for a canonical request: percent-encode everything except
 *  unreserved characters. `encodeURIComponent` alone under-encodes `! * ' ( )`, so those
 *  five are escaped by hand afterward. */
function awsUriEncode(value: string): string {
  return Array.from(value)
    .map((ch) => (UNRESERVED.test(ch) ? ch : `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`))
    .join("");
}

/** Path-style canonical URI for `/<bucket>/<objectKey>`. Each segment is encoded on its
 *  own so a `/` inside `objectKey` stays a path separator, not `%2F` — S3's canonical
 *  URI must NOT double-encode the path (a well-known SigV4-for-S3 exception to the
 *  general "encode twice" rule). */
function canonicalPath(bucket: string, objectKey: string): string {
  const segments = [bucket, ...objectKey.split("/")].map(awsUriEncode);
  return `/${segments.join("/")}`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/** Builds the `Authorization` header (AWS4-HMAC-SHA256) plus the exact header set it
 *  covers, for one S3 REST request. `payloadHash` is the hex sha256 of the body. */
function signRequest(opts: {
  method: "PUT" | "DELETE";
  cfg: S3StorageConfig;
  objectKey: string;
  host: string;
  payloadHash: string;
  contentType?: string;
}): { authorization: string; amzDate: string } {
  const { method, cfg, objectKey, host, payloadHash, contentType } = opts;
  const region = cfg.region ?? "auto";
  const { amzDate, dateStamp } = amzTimestamps(new Date());

  const headerEntries: [string, string][] = contentType
    ? [
        ["content-type", contentType],
        ["host", host],
        ["x-amz-content-sha256", payloadHash],
        ["x-amz-date", amzDate],
      ]
    : [
        ["host", host],
        ["x-amz-content-sha256", payloadHash],
        ["x-amz-date", amzDate],
      ];
  // Already listed alphabetically above; SigV4 requires canonical-header order to match
  // signed-header order exactly.
  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [method, canonicalPath(cfg.bucket, objectKey), "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${cfg.secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate };
}

function objectUrl(cfg: S3StorageConfig, objectKey: string): { url: string; host: string } {
  const base = new URL(cfg.endpoint);
  const host = base.host;
  const url = `${base.origin}${canonicalPath(cfg.bucket, objectKey)}`;
  return { url, host };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Streams the file as the PUT body over node:http(s), not `fetch`: Next patches the
 *  global fetch in dev and hex-encodes a whole request body into a cache key, which ran
 *  the server out of heap on a 76 MB reel. Streaming also keeps the file out of memory. */
function putFile(url: string, path: string, headers: Record<string, string>): Promise<number> {
  const send = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(url, { method: "PUT", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
      res.on("error", reject);
    });
    req.on("error", reject);
    createReadStream(path).on("error", reject).pipe(req);
  });
}

export class S3StorageProvider implements StorageProvider {
  constructor(private readonly cfg: S3StorageConfig) {}

  async upload(localPath: string, contentType: string): Promise<{ publicUrl: string; objectKey: string }> {
    const ext = extname(localPath) || ".mp4";
    const objectKey = `crowsnest/${randomUUID()}${ext}`;
    const { url, host } = objectUrl(this.cfg, objectKey);
    const payloadHash = await sha256File(localPath);
    const { size } = await stat(localPath);
    const { authorization, amzDate } = signRequest({ method: "PUT", cfg: this.cfg, objectKey, host, payloadHash, contentType });

    const status = await putFile(url, localPath, {
      Authorization: authorization,
      Host: host,
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    });
    if (status < 200 || status >= 300) {
      // Status only: the response body could echo request headers back.
      throw new Error(`S3 upload failed: ${status}`);
    }

    return { publicUrl: `${this.cfg.publicBase.replace(/\/$/, "")}/${objectKey}`, objectKey };
  }

  async delete(objectKey: string): Promise<void> {
    const { url, host } = objectUrl(this.cfg, objectKey);
    const payloadHash = sha256Hex("");
    const { authorization, amzDate } = signRequest({ method: "DELETE", cfg: this.cfg, objectKey, host, payloadHash });

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: authorization,
        Host: host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      },
    });
    // S3-compatible DELETE returns 204 (and often 404 if already gone) — either is a
    // successful end state for "this object should not exist anymore".
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 delete failed: ${res.status} ${res.statusText}`);
    }
  }
}

// ---------------------------------------------------------------- config seam

/** Reads `S3_ENDPOINT` / `S3_BUCKET` / `S3_KEY` / `S3_SECRET` / `S3_PUBLIC_BASE` (plus
 *  optional `S3_REGION`) straight from `process.env`, matching the "else process.env"
 *  fallback this module's task calls out — these five are new, publish-only config with
 *  no existing entry in `src/server/config.ts`'s validated schema, and no reason to grow
 *  that schema for a single-caller seam. Returns `null` when any of the five required
 *  vars is missing or empty, which callers use to render a "not configured" state
 *  instead of a broken one (plan locked decision 6). */
export function getStorageProvider(): StorageProvider | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_KEY;
  const secret = process.env.S3_SECRET;
  const publicBase = process.env.S3_PUBLIC_BASE;
  if (!endpoint || !bucket || !accessKey || !secret || !publicBase) return null;

  const region = process.env.S3_REGION;
  return new S3StorageProvider({ endpoint, bucket, accessKey, secret, publicBase, ...(region ? { region } : {}) });
}
