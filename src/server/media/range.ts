/**
 * HTTP `Range` header parsing for the media endpoint (RFC 9110 §14).
 *
 * Pure and dependency-free so the byte arithmetic — the part that silently corrupts a
 * <video> seek when it is off by one — is unit-testable without a filesystem or a DB.
 *
 * Two failure modes are deliberately kept apart, because the RFC treats them oppositely:
 *
 *   - `malformed`      — the header is syntactically invalid, uses a unit other than
 *                        `bytes`, or asks for multiple ranges (we only ever serve one).
 *                        RFC 9110 §14.2: "A server MUST ignore a Range header field
 *                        received with a request method that is unrecognized or when
 *                        the Range is invalid" — so the caller serves a normal **200**
 *                        with the whole representation. Answering 416 here would break
 *                        clients that send an odd header but can handle a full body.
 *   - `unsatisfiable`  — the syntax is fine but no byte in it exists (`start >= size`,
 *                        or a suffix of length 0). The caller MUST answer **416** with
 *                        a `Content-Range` of `bytes <asterisk>/<size>` so the client
 *                        learns the resource's real size.
 */

export type RangeResult =
  | { kind: "none" }
  /** Inclusive byte offsets, already clamped to the file. `length = end - start + 1`. */
  | { kind: "satisfiable"; start: number; end: number; length: number }
  | { kind: "unsatisfiable" }
  | { kind: "malformed" };

/** `bytes=` prefix, case-insensitive per RFC 9110 (range units are case-insensitive). */
const BYTES_UNIT = /^bytes\s*=/i;
/** `first-last`, `first-` or `-suffix`; digits only, no signs, no whitespace inside. */
const RANGE_SPEC = /^(\d*)-(\d*)$/;

/**
 * @param header raw `Range` request header (`null` when absent)
 * @param size   the resource's real size in bytes (0 is legal: an empty file)
 */
export function parseRangeHeader(header: string | null | undefined, size: number): RangeResult {
  if (!Number.isFinite(size) || size < 0) throw new RangeError(`parseRangeHeader: invalid size ${size}`);
  if (header === null || header === undefined) return { kind: "none" };

  const raw = header.trim();
  if (raw === "") return { kind: "none" };
  if (!BYTES_UNIT.test(raw)) return { kind: "malformed" };

  const specs = raw.slice(raw.indexOf("=") + 1).split(",");
  // Multi-range would require a multipart/byteranges body. We serve single ranges only,
  // so the honest move is to ignore the header and send the whole file rather than
  // silently answering with just the first range as if it were the whole request.
  if (specs.length !== 1) return { kind: "malformed" };

  const match = RANGE_SPEC.exec(specs[0].trim());
  if (!match) return { kind: "malformed" };

  const [, firstRaw, lastRaw] = match;
  if (firstRaw === "" && lastRaw === "") return { kind: "malformed" };

  // Suffix form: `bytes=-500` means "the last 500 bytes".
  if (firstRaw === "") {
    const suffixLength = Number(lastRaw);
    // A zero-length suffix identifies no bytes at all, and neither does any suffix of an
    // empty file — both are unsatisfiable, not malformed.
    if (suffixLength === 0 || size === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffixLength);
    const end = size - 1;
    return { kind: "satisfiable", start, end, length: end - start + 1 };
  }

  const start = Number(firstRaw);
  if (lastRaw === "") {
    // Open-ended: `bytes=0-` → to EOF.
    if (start >= size) return { kind: "unsatisfiable" };
    const end = size - 1;
    return { kind: "satisfiable", start, end, length: end - start + 1 };
  }

  const last = Number(lastRaw);
  // last < first is an invalid byte-range-spec → ignore the header (200), not 416.
  if (last < start) return { kind: "malformed" };
  if (start >= size) return { kind: "unsatisfiable" };
  const end = Math.min(last, size - 1); // asking past EOF is legal: clamp.
  return { kind: "satisfiable", start, end, length: end - start + 1 };
}
