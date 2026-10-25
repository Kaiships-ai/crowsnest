import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { log } from "@/server/lib/logger";
import { parseRangeHeader } from "@/server/media/range";
import { getAsset, resolveAssetPath, type MediaAsset } from "@/server/media/store";

/**
 * Design notes worth keeping:
 *  - Every failure is a bare **404** with no detail. Whether an id is malformed, absent
 *    from the DB, points outside the media root, or points at a file that is not on disk
 *    is our problem to see in the logs, not the client's to probe.
 *  - Nothing is ever synthesised. A row whose file is missing logs `media.file_missing`
 *    and 404s; it never returns zero bytes or a placeholder image, because a silently
 *    empty image is a bug that hides for weeks.
 *  - Bodies are streamed with `createReadStream`, never `readFile`: a 15MB reel must not
 *    be buffered into memory to be sent, and a 206 must read only the requested slice.
 *  - `Cache-Control: immutable` is safe because the URL is content-addressed — an asset
 *    id maps to one sha256 forever.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

type Ctx = { params: Promise<{ assetId: string }> };

/** Wraps a Node read stream in a web `ReadableStream`, preserving backpressure and
 *  destroying the fd if the client disconnects mid-download. */
function fileStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const source = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk) => {
        controller.enqueue(chunk as Uint8Array);
        // Stop reading once the consumer is saturated; `pull` resumes us.
        if (controller.desiredSize !== null && controller.desiredSize <= 0) source.pause();
      });
      source.on("end", () => controller.close());
      source.on("error", (err: Error) => {
        log.error("media.stream_failed", { path: filePath, error: err.message });
        controller.error(err);
      });
    },
    pull() {
      source.resume();
    },
    cancel() {
      source.destroy();
    },
  });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function baseHeaders(asset: MediaAsset, etag: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", asset.contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", etag);
  headers.set("Cache-Control", CACHE_CONTROL);
  return headers;
}

/** RFC 9110 §13.1.2: `If-None-Match` is a list, may use `W/` weak prefix, and `*`
 *  matches any existing representation. Comparison for a GET is weak. */
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === etag);
}

async function serve(request: Request, ctx: Ctx, method: "GET" | "HEAD"): Promise<Response> {
  const { assetId } = await ctx.params;

  const asset = await getAsset(assetId);
  if (!asset) return notFound();

  let filePath: string;
  try {
    filePath = resolveAssetPath(asset.storagePath);
  } catch (err) {
    log.error("media.path_rejected", { assetId: asset.id, error: err instanceof Error ? err.message : String(err) });
    return notFound();
  }

  let size: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      log.error("media.not_a_file", { assetId: asset.id, storagePath: asset.storagePath });
      return notFound();
    }
    size = stats.size;
  } catch (err) {
    log.error("media.file_missing", {
      assetId: asset.id,
      storagePath: asset.storagePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return notFound();
  }

  // The row is metadata; the file is the truth. Serve the real length, but say loudly
  // that they disagree — that means a partial download was recorded as complete.
  if (size !== asset.byteSize) {
    log.warn("media.size_mismatch", { assetId: asset.id, rowBytes: asset.byteSize, diskBytes: size });
  }

  const etag = `"${asset.sha256}"`;
  const headers = baseHeaders(asset, etag);

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }

  const range = parseRangeHeader(request.headers.get("range"), size);

  if (range.kind === "unsatisfiable") {
    const failed = baseHeaders(asset, etag);
    failed.set("Content-Range", `bytes */${size}`);
    failed.delete("Content-Type");
    return new Response(method === "HEAD" ? null : "Range Not Satisfiable", { status: 416, headers: failed });
  }

  if (range.kind === "satisfiable") {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.length));
    const body = method === "HEAD" ? null : fileStream(filePath, { start: range.start, end: range.end });
    return new Response(body, { status: 206, headers });
  }

  // `none` and `malformed` both serve the whole representation (RFC 9110 §14.2: an
  // invalid Range MUST be ignored, not rejected).
  headers.set("Content-Length", String(size));
  const body = method === "HEAD" ? null : fileStream(filePath);
  return new Response(body, { status: 200, headers });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return serve(request, ctx, "GET");
}

export async function HEAD(request: Request, ctx: Ctx): Promise<Response> {
  return serve(request, ctx, "HEAD");
}
