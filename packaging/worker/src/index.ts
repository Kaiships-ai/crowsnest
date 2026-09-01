// crowsnest download gate (Cloudflare Worker).
//
// Three routes:
//   GET  /install.sh          public. Serves the installer from R2. No secrets in it.
//   POST /download            {key, platform, version} -> validate the key against Polar,
//                             then return {url} pointing at a short-lived /dl token.
//   GET  /dl?token=...        verifies the token, streams the tarball from the R2 binding.
//
// The tarball object in R2 is never public. Only a POST with a valid, current license key
// mints a token, and the token expires. No S3 access keys are needed: the token is an HMAC
// the worker signs and verifies itself, and the bytes stream through the R2 binding.

export interface Env {
  RELEASES: R2Bucket;            // bound to the crowsnest-releases bucket
  POLAR_ORG_ID: string;         // same org id license.ts uses
  POLAR_API: string;            // https://api.polar.sh (or sandbox)
  TOKEN_SECRET: string;         // random secret, `wrangler secret put TOKEN_SECRET`
  RATE_LIMIT?: KVNamespace;     // optional: per-key-hash throttle
}

const TOKEN_TTL_SECONDS = 900; // 15 minutes

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------- HMAC token

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(sig);
}

/** token = <objectKey>.<exp>.<sig>, sig over "<objectKey>.<exp>". */
async function mintToken(env: Env, objectKey: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${objectKey}.${exp}`;
  const sig = await hmac(env.TOKEN_SECRET, payload);
  return `${btoa(objectKey).replace(/=+$/, "")}.${exp}.${sig}`;
}

async function verifyToken(env: Env, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encKey, expStr, sig] = parts;
  let objectKey: string;
  try {
    objectKey = atob(encKey.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const want = await hmac(env.TOKEN_SECRET, `${objectKey}.${exp}`);
  // constant-time-ish compare
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? objectKey : null;
}

// ---------------------------------------------------------------- Polar validate

async function keyIsValid(env: Env, key: string): Promise<boolean> {
  // Validate only, never activate: a download check must not burn one of the buyer's two
  // activation slots. A 200 with a granted status means the license is live.
  const res = await fetch(`${env.POLAR_API}/v1/customer-portal/license-keys/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, organization_id: env.POLAR_ORG_ID }),
  });
  if (!res.ok) return false;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const lk = (body.license_key ?? {}) as Record<string, unknown>;
  const status = (lk.status ?? body.status) as string | undefined;
  // Polar returns the key object; absent status on a 200 still means it resolved.
  return status === undefined || status === "granted";
}

// ---------------------------------------------------------------- routes

function objectKeyFor(version: string, platform: string): string {
  // releases/v0.2.0/crowsnest-v0.2.0-darwin-arm64.tar.gz
  return `releases/v${version}/crowsnest-v${version}-${platform}.tar.gz`;
}

async function rateLimited(env: Env, key: string): Promise<boolean> {
  if (!env.RATE_LIMIT) return false;
  const hash = await hmac(env.TOKEN_SECRET, `rl:${key}`);
  const slot = `rl:${hash}`;
  const n = Number((await env.RATE_LIMIT.get(slot)) ?? "0");
  if (n >= 20) return true; // 20 download mints per key per hour
  await env.RATE_LIMIT.put(slot, String(n + 1), { expirationTtl: 3600 });
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/install.sh") {
      const obj = await env.RELEASES.get("install.sh");
      if (!obj) return new Response("install.sh not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "content-type": "text/x-shellscript; charset=utf-8" },
      });
    }

    if (req.method === "GET" && url.pathname === "/latest.json") {
      const obj = await env.RELEASES.get("latest.json");
      if (!obj) return new Response("{}", { headers: { "content-type": "application/json" } });
      return new Response(obj.body, { headers: { "content-type": "application/json" } });
    }

    if (req.method === "POST" && url.pathname === "/download") {
      const body = (await req.json().catch(() => ({}))) as Record<string, string>;
      const key = (body.key ?? "").trim();
      const platform = body.platform ?? "darwin-arm64";
      const version = body.version ?? "";
      if (!key || !version) return json({ error: "key and version required" }, 400);

      if (await rateLimited(env, key)) return json({ error: "too many download requests, wait an hour" }, 429);
      if (!(await keyIsValid(env, key))) return json({ error: "license not recognized" }, 401);

      const objectKey = objectKeyFor(version, platform);
      const head = await env.RELEASES.head(objectKey);
      if (!head) return json({ error: `no release for ${version} ${platform}` }, 404);

      const token = await mintToken(env, objectKey);
      return json({ url: `${url.origin}/dl?token=${encodeURIComponent(token)}` });
    }

    if (req.method === "GET" && url.pathname === "/dl") {
      const token = url.searchParams.get("token") ?? "";
      const objectKey = await verifyToken(env, token);
      if (!objectKey) return new Response("link expired or invalid", { status: 403 });
      const obj = await env.RELEASES.get(objectKey);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": "application/gzip",
          "content-length": String(obj.size),
          "content-disposition": `attachment; filename="${objectKey.split("/").pop()}"`,
        },
      });
    }

    return new Response("crowsnest gate", { status: 200 });
  },
};
