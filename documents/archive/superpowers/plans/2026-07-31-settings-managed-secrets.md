# Settings-managed secrets implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage all eight secrets from the settings page with runtime effect (no restart), auto-generate the sidecar token, add a Start/stop button that spawns the sidecar, and add session-token Instagram login.

**Architecture:** A db-backed secrets store (`getSecret` reads db first, `.env.local` fallback) that the secret consumers read at call time. `IG_SERVICE_TOKEN` becomes optional and auto-generates. Settings gains a secrets panel, a sidecar control that spawns the Python process with injected env, and a session-token login path wired to the sidecar's existing `/login-by-session`.

**Tech Stack:** Next.js (App Router, server actions, nodejs runtime), drizzle-orm + better-sqlite3, zod, vitest, React, node:crypto, node:child_process, Python FastAPI sidecar.

## Global constraints

- This is NOT the Next.js in training data. Read the relevant guide under `node_modules/next/dist/docs/` before writing server-action or route code.
- Prose in `.md`/`.txt` files has no em dashes, en dashes, or curly quotes (hook-enforced). Code is exempt.
- A stored secret value is never returned to the browser or logged. Actions return status, not values.
- The eight managed secrets, exact names: `IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD`, `IG_SESSIONID`, `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`.
- Secrets are plaintext in the local sqlite (same trust level as `.env.local`). No encryption.
- Run one test file: `npx vitest run <path>`. Whole suite: `npx vitest run`. Every db-touching test relies on the global `src/test/setup-env.ts` that sets `CROWSNEST_DB_PATH=":memory:"`; a new db test that imports the db statically must still follow the dynamic-import beforeAll pattern (see `src/server/settings/index.test.ts`).

---

### Task 1: secrets store and config change

**Files:**
- Modify: `src/server/db/schema.ts` (add the `secrets` table)
- Create: `src/server/secrets/store.ts`
- Create: `src/server/secrets/store.test.ts`
- Modify: `src/server/config.ts` (make `IG_SERVICE_TOKEN` optional)
- Generate: a drizzle migration under `drizzle/`

**Interfaces:**
- Produces:
  - `const MANAGED_SECRETS: readonly ManagedSecret[]` and `type ManagedSecret`
  - `interface SecretStatus { name: ManagedSecret; configured: boolean; source: "db" | "env" | "none" }`
  - `getSecret(name: string): string | undefined`
  - `setSecret(name: string, value: string): void` (throws on empty)
  - `clearSecret(name: string): void`
  - `secretStatus(): SecretStatus[]`
  - `getOrCreateServiceToken(): string`

- [ ] **Step 1: Add the table to schema.ts**

Append to `src/server/db/schema.ts`:

```ts
export const secrets = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` creating `secrets`. Commit it with the task.

- [ ] **Step 3: Write the failing store test**

Create `src/server/secrets/store.test.ts` using the dynamic-import pattern so it hits `:memory:`:

```ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let store: typeof import("./store");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  store = await import("./store");
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("secrets store", () => {
  test("db value wins over env", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("db-value");
    delete process.env.GROQ_API_KEY;
  });

  test("env fallback when no db row", () => {
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
    delete process.env.GROQ_API_KEY;
  });

  test("undefined when neither set", () => {
    delete process.env.GROQ_API_KEY;
    expect(store.getSecret("GROQ_API_KEY")).toBeUndefined();
  });

  test("setSecret rejects empty", () => {
    expect(() => store.setSecret("GROQ_API_KEY", "   ")).toThrow();
  });

  test("clearSecret removes the db row (env still shows)", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    store.clearSecret("GROQ_API_KEY");
    process.env.GROQ_API_KEY = "env-value";
    expect(store.getSecret("GROQ_API_KEY")).toBe("env-value");
    delete process.env.GROQ_API_KEY;
  });

  test("status never returns values", () => {
    store.setSecret("GROQ_API_KEY", "db-value");
    const s = store.secretStatus().find((x) => x.name === "GROQ_API_KEY");
    expect(s).toEqual({ name: "GROQ_API_KEY", configured: true, source: "db" });
    expect(JSON.stringify(store.secretStatus())).not.toContain("db-value");
  });

  test("getOrCreateServiceToken generates once and is stable", () => {
    delete process.env.IG_SERVICE_TOKEN;
    const a = store.getOrCreateServiceToken();
    const b = store.getOrCreateServiceToken();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run src/server/secrets/store.test.ts`
Expected: FAIL, no `./store`.

- [ ] **Step 5: Write store.ts**

Create `src/server/secrets/store.ts`:

```ts
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { secrets } from "@/server/db/schema";

export const MANAGED_SECRETS = [
  "IG_SERVICE_TOKEN",
  "IG_USERNAME",
  "IG_PASSWORD",
  "IG_SESSIONID",
  "IG_GRAPH_TOKEN",
  "IG_GRAPH_USER_ID",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
] as const;
export type ManagedSecret = (typeof MANAGED_SECRETS)[number];

export interface SecretStatus {
  name: ManagedSecret;
  configured: boolean;
  source: "db" | "env" | "none";
}

function dbValue(name: string): string | undefined {
  const row = db.select().from(secrets).where(eq(secrets.name, name)).get();
  return row && row.value ? row.value : undefined;
}

export function getSecret(name: string): string | undefined {
  const fromDb = dbValue(name);
  if (fromDb) return fromDb;
  const env = process.env[name];
  return env && env.length > 0 ? env : undefined;
}

export function setSecret(name: string, value: string): void {
  const v = value.trim();
  if (!v) throw new Error("secret value is empty");
  const now = new Date().toISOString();
  db.insert(secrets)
    .values({ name, value: v, updatedAt: now })
    .onConflictDoUpdate({ target: secrets.name, set: { value: v, updatedAt: now } })
    .run();
}

export function clearSecret(name: string): void {
  db.delete(secrets).where(eq(secrets.name, name)).run();
}

export function secretStatus(): SecretStatus[] {
  return MANAGED_SECRETS.map((name) => {
    if (dbValue(name)) return { name, configured: true, source: "db" as const };
    const env = process.env[name];
    if (env && env.length > 0) return { name, configured: true, source: "env" as const };
    return { name, configured: false, source: "none" as const };
  });
}

export function getOrCreateServiceToken(): string {
  const existing = getSecret("IG_SERVICE_TOKEN");
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  setSecret("IG_SERVICE_TOKEN", token);
  return token;
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run src/server/secrets/store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Make IG_SERVICE_TOKEN optional in config.ts**

In `src/server/config.ts`, change the `IG_SERVICE_TOKEN` line from the required string to:

```ts
  IG_SERVICE_TOKEN: z.string().optional(),
```

Remove the `.min(1, "...")` message. This stops the app from throwing at boot when the token is unset (the store now guarantees one via `getOrCreateServiceToken`). Leave every other field unchanged.

- [ ] **Step 8: Add a config test that a missing token no longer throws**

In the existing config test (find it with `ls src/server/config.test.ts`; if none exists, create it), add:

```ts
test("a missing IG_SERVICE_TOKEN does not throw", () => {
  const env = { ...process.env };
  delete env.IG_SERVICE_TOKEN;
  expect(() => loadConfig(env)).not.toThrow();
});
```

Import `loadConfig` from `./config`. If a config test already asserts the old throw behavior, update that assertion.

- [ ] **Step 9: Run suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: green (existing config tests may need the assertion update from Step 8).

- [ ] **Step 10: Commit**

```bash
git add src/server/db/schema.ts src/server/secrets/ src/server/config.ts drizzle/ src/server/config.test.ts
git commit -m "feat(secrets): db-backed secrets store, optional IG_SERVICE_TOKEN"
```

---

### Task 2: route secret consumers through the store

**Files:**
- Modify: `src/server/llm/client.ts`
- Modify: `src/server/graph/client.ts`
- Modify: `src/server/transcribe/groq.ts`
- Modify: `src/server/ig/client.ts`
- Modify: `src/app/api/logs/ingest/route.ts`
- Modify or extend the tests colocated with each

**Interfaces:**
- Consumes: `getSecret`, `getOrCreateServiceToken` from `@/server/secrets/store` (Task 1).

- [ ] **Step 1: llm/client.ts**

Replace the two `process.env.ANTHROPIC_API_KEY` reads. `hasLlmKey` becomes:

```ts
import { getSecret } from "@/server/secrets/store";

export function hasLlmKey(): boolean {
  return Boolean(getSecret("ANTHROPIC_API_KEY"));
}
```

In `getLlm()`, `new Anthropic()` reads the key from the env itself, which no longer sees a db-only key. Pass it explicitly:

```ts
const apiKey = getSecret("ANTHROPIC_API_KEY");
const baseURL = process.env.ANTHROPIC_BASE_URL;
const anthropic = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });
cachedClient = isCompatMode() ? new CompatLlmClient(anthropic) : new AnthropicLlmClient(anthropic);
```

Note: `resolveModel` (`CLAUDE_MODEL`) and `isCompatMode` (`ANTHROPIC_BASE_URL`) are not secrets, leave them reading `process.env`. Because `getLlm` caches `cachedClient`, add a `resetLlmClient()` export that nulls the cache, so a key change via the UI takes effect; call sites already lazy-init.

- [ ] **Step 2: graph/client.ts**

Replace `config.IG_GRAPH_TOKEN` and `config.IG_GRAPH_USER_ID` (the `isConfigured` check near line 337, the credential read near 341 to 344, and the read near line 435) with `getSecret("IG_GRAPH_TOKEN")` and `getSecret("IG_GRAPH_USER_ID")`. `config.IG_GRAPH_API_VERSION` is not a secret, leave it.

- [ ] **Step 3: transcribe/groq.ts**

`groqAvailability` and the key read use `env.GROQ_API_KEY` / `process.env.GROQ_API_KEY`. Change both to `getSecret("GROQ_API_KEY")`:

```ts
import { getSecret } from "@/server/secrets/store";

export function groqAvailability(): { available: boolean; reason?: string } {
  return getSecret("GROQ_API_KEY") ? { available: true } : { available: false, reason: "GROQ_API_KEY not set" };
}
```

Update the later `const apiKey = process.env.GROQ_API_KEY;` to `const apiKey = getSecret("GROQ_API_KEY");`. Drop the `env` parameter if it is no longer used, and update its callers/tests accordingly.

- [ ] **Step 4: ig/client.ts**

At the header build (line 341), replace `config.IG_SERVICE_TOKEN` with `getOrCreateServiceToken()`:

```ts
import { getOrCreateServiceToken } from "@/server/secrets/store";
// ...
"X-IG-Token": getOrCreateServiceToken(),
```

- [ ] **Step 5: ingest route.ts**

The token compare currently reads the token from config. Change it to `getOrCreateServiceToken()` so it matches whatever the sidecar was given:

```ts
import { getOrCreateServiceToken } from "@/server/secrets/store";
// inside tokenOk:
const expected = getOrCreateServiceToken();
```

- [ ] **Step 6: Add/adjust a test proving db value is used**

In `src/server/llm/client.test.ts` (or a new colocated test), add a test that with no `process.env.ANTHROPIC_API_KEY` but a db-set one, `hasLlmKey()` is true. Use the dynamic-import `:memory:` pattern, `setSecret("ANTHROPIC_API_KEY", "sk-test")`, then assert. Do the same shape for groq availability.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: green. Existing tests that set these via `process.env` still pass because the env fallback is intact.

- [ ] **Step 8: Commit**

```bash
git add src/server/llm/client.ts src/server/graph/client.ts src/server/transcribe/groq.ts src/server/ig/client.ts src/app/api/logs/ingest/route.ts src/server/llm/client.test.ts
git commit -m "feat(secrets): read LLM, Graph, Groq, and sidecar token from the store"
```

---

### Task 3: secrets settings panel and actions

**Files:**
- Create: `src/server/actions/secrets-actions.ts`
- Create: `src/server/actions/secrets-actions.test.ts`
- Modify: `src/components/settings/api-key-section.tsx` (the API keys panel; confirm the exact filename with `ls src/components/settings/`), or create `src/components/settings/secrets-section.tsx` and swap it into `src/app/(shell)/settings/page.tsx`
- Modify: `src/app/(shell)/settings/page.tsx` (feed it the initial status)

**Interfaces:**
- Consumes: `MANAGED_SECRETS`, `SecretStatus`, `setSecret`, `clearSecret`, `secretStatus` from `@/server/secrets/store`; the existing `testAnthropicKeyAction` from `@/server/actions/settings-actions`.
- Produces: `setSecretAction`, `clearSecretAction`, `getSecretStatusAction`.

- [ ] **Step 1: Write the failing actions test**

Create `src/server/actions/secrets-actions.test.ts` (dynamic-import `:memory:` pattern):

```ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let actions: typeof import("./secrets-actions");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  actions = await import("./secrets-actions");
});
beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("secrets actions", () => {
  test("set rejects an unknown name", async () => {
    const r = await actions.setSecretAction("NOT_A_SECRET", "x");
    expect(r.ok).toBe(false);
  });

  test("set then status shows configured from db", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s).toMatchObject({ configured: true, source: "db" });
  });

  test("no value leaks in a response", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "super-secret");
    const json = JSON.stringify(await actions.getSecretStatusAction());
    expect(json).not.toContain("super-secret");
  });

  test("clear removes the db row", async () => {
    await actions.setSecretAction("GROQ_API_KEY", "sk-1");
    await actions.clearSecretAction("GROQ_API_KEY");
    const s = (await actions.getSecretStatusAction()).find((x) => x.name === "GROQ_API_KEY");
    expect(s?.source).not.toBe("db");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/server/actions/secrets-actions.test.ts`
Expected: FAIL, no `./secrets-actions`.

- [ ] **Step 3: Write secrets-actions.ts**

Create `src/server/actions/secrets-actions.ts`. Match the `SimpleResult` shape the other actions in `src/server/actions/settings-actions.ts` return (read that file for the exact type and the `"use server"` header convention):

```ts
"use server";

import { clearSecret, MANAGED_SECRETS, secretStatus, setSecret, type ManagedSecret, type SecretStatus } from "@/server/secrets/store";

type SimpleResult = { ok: true } | { ok: false; error: string };

function isManaged(name: string): name is ManagedSecret {
  return (MANAGED_SECRETS as readonly string[]).includes(name);
}

export async function setSecretAction(name: string, value: string): Promise<SimpleResult> {
  if (!isManaged(name)) return { ok: false, error: "unknown secret" };
  try {
    setSecret(name, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to set secret" };
  }
}

export async function clearSecretAction(name: string): Promise<SimpleResult> {
  if (!isManaged(name)) return { ok: false, error: "unknown secret" };
  clearSecret(name);
  return { ok: true };
}

export async function getSecretStatusAction(): Promise<SecretStatus[]> {
  return secretStatus();
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/server/actions/secrets-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the panel UI**

Rebuild the API keys settings section into a panel over all eight secrets. Read the current section and card first: `src/components/settings/api-key-status-card.tsx` and the API keys block in `src/app/(shell)/settings/page.tsx` (around lines 95 to 112). Keep the visual language of the existing cards. For each secret in `MANAGED_SECRETS`, render a row with:

- a Configured or Not set pill, and the source (from `.env.local` or set here) when configured;
- a Set or Replace button that reveals one masked `<input type="password">` and calls `setSecretAction(name, value)` then refreshes status;
- a Clear button shown only when `source === "db"`, calling `clearSecretAction(name)`;
- for `ANTHROPIC_API_KEY`, the existing Test button calling `testAnthropicKeyAction`;
- for `IG_SERVICE_TOKEN`, no blank Set (there is always a value): show Configured and a Regenerate button that calls `setSecretAction("IG_SERVICE_TOKEN", <new random>)`. Generate the random client-side is wrong (it must be strong and server-owned); instead add a tiny `regenerateServiceTokenAction()` to secrets-actions that calls `setSecret("IG_SERVICE_TOKEN", randomBytes(32).toString("hex"))` and returns ok. Add that action and a test for it alongside Step 3.

Group the rows: LLM (Anthropic, Groq), Instagram sidecar (service token, username, password, sessionid), Graph (token, user id). Never render a secret value; the input is write-only.

Feed the initial `secretStatus()` from the server component `page.tsx` as a prop, same as the page already does for other sections.

- [ ] **Step 6: Add the regenerate action and test**

Add to `secrets-actions.ts`:

```ts
import { randomBytes } from "node:crypto";
export async function regenerateServiceTokenAction(): Promise<SimpleResult> {
  setSecret("IG_SERVICE_TOKEN", randomBytes(32).toString("hex"));
  return { ok: true };
}
```

Add a test asserting it changes the stored token and returns ok.

- [ ] **Step 7: Typecheck, lint, and load the page**

Run: `npx vitest run src/server/actions/secrets-actions.test.ts` and `npx tsc --noEmit`.
Then load the page in the browser (dev server on port 3001, localhost not 127.0.0.1): open `/settings`, set a Groq key, confirm the pill flips to Configured, reload and confirm it persists, Clear it, confirm it reverts. Controller may do this browser step after merge if the worker cannot run the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/server/actions/secrets-actions.ts src/server/actions/secrets-actions.test.ts src/components/settings/ src/app/\(shell\)/settings/page.tsx
git commit -m "feat(secrets): settings panel to set, clear, and test all secrets"
```

---

### Task 4: sidecar Start and stop control

**Files:**
- Create: `src/server/sidecar/control.ts` (spawn, stop, pid tracking)
- Create: `src/server/sidecar/control.test.ts`
- Create: `src/server/actions/sidecar-actions.ts`
- Create: `src/components/settings/sidecar-control.tsx`
- Modify: `src/components/settings/instagram-section.tsx` (mount `SidecarControl`)

**Interfaces:**
- Consumes: `getOrCreateServiceToken`, `getSecret` from `@/server/secrets/store`; the existing `getIgStatusAction` from `@/server/actions/ig-actions`.
- Produces: `startSidecar()`, `stopSidecar()`, `sidecarPidAlive()` in control.ts; `startSidecarAction`, `stopSidecarAction` server actions.

- [ ] **Step 1: Write the failing control test**

Create `src/server/sidecar/control.test.ts`. Mock `node:child_process` `spawn` and `node:fs`. Assert that `startSidecar` spawns with the expected env keys injected and writes a pid file, and `stopSidecar` reads the pid and kills it. Example shape:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn() })) }));
vi.mock("node:fs", () => ({ writeFileSync: vi.fn(), readFileSync: vi.fn(() => "4242"), existsSync: vi.fn(() => true), rmSync: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("sidecar control", () => {
  test("startSidecar spawns with injected env and writes the pid", async () => {
    process.env.CROWSNEST_DB_PATH = ":memory:";
    process.env.IG_SERVICE_TOKEN ??= "test-token-0000000000000000";
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const { startSidecar } = await import("./control");
    startSidecar();
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = call[2] as { env: Record<string, string> };
    expect(opts.env.IG_SERVICE_TOKEN).toBeTruthy();
    expect(opts.env).toHaveProperty("CROWSNEST_INGEST_URL");
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test("stopSidecar kills the tracked pid and removes the file", async () => {
    const fs = await import("node:fs");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as unknown as boolean);
    const { stopSidecar } = await import("./control");
    stopSidecar();
    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(fs.rmSync).toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/server/sidecar/control.test.ts`
Expected: FAIL, no `./control`.

- [ ] **Step 3: Write control.ts**

Create `src/server/sidecar/control.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getOrCreateServiceToken, getSecret } from "@/server/secrets/store";

const PID_FILE = "data/sidecar.pid";
const SIDECAR_CWD = path.resolve(process.cwd(), "services/ig");

function ingestUrl(): string {
  const port = process.env.PORT ?? "3000";
  return process.env.CROWSNEST_INGEST_URL ?? `http://127.0.0.1:${port}/api/logs/ingest`;
}

/** Env injected into the sidecar child. A value the store returns wins over .env.local
 *  because the child receives it directly (config.py: an already-present var beats the
 *  file). Only defined values are passed. */
function childEnv(): NodeJS.ProcessEnv {
  const inject: Record<string, string | undefined> = {
    IG_SERVICE_TOKEN: getOrCreateServiceToken(),
    IG_USERNAME: getSecret("IG_USERNAME"),
    IG_PASSWORD: getSecret("IG_PASSWORD"),
    IG_PROXY: getSecret("IG_PROXY"),
    IG_DEVICE_SEED: getSecret("IG_DEVICE_SEED"),
    CROWSNEST_INGEST_URL: ingestUrl(),
  };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(inject)) if (v) env[k] = v;
  return env;
}

export function startSidecar(): void {
  const child = spawn("uv", ["run", "python", "-m", "crowsnest_ig"], {
    cwd: SIDECAR_CWD,
    env: childEnv(),
    detached: true,
    stdio: "ignore",
  });
  if (child.pid) writeFileSync(PID_FILE, String(child.pid));
  child.unref();
}

export function sidecarPidAlive(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopSidecar(): void {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  rmSync(PID_FILE, { force: true });
}
```

Note: `IG_PROXY` and `IG_DEVICE_SEED` are not in `MANAGED_SECRETS`, so `getSecret` returns them only from env. That is fine, they are optional. Do not add them to the managed list.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/server/sidecar/control.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the server actions**

Create `src/server/actions/sidecar-actions.ts`:

```ts
"use server";

import { getIgStatusAction } from "@/server/actions/ig-actions";
import { sidecarPidAlive, startSidecar, stopSidecar } from "@/server/sidecar/control";

type SimpleResult = { ok: true } | { ok: false; error: string };

export async function startSidecarAction(): Promise<SimpleResult> {
  // No-op success if the sidecar already answers its health check.
  const status = await getIgStatusAction();
  if (status.ok) return { ok: true };
  try {
    startSidecar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to start sidecar" };
  }
}

export async function stopSidecarAction(): Promise<SimpleResult> {
  stopSidecar();
  return { ok: true };
}

export async function sidecarProcessAliveAction(): Promise<boolean> {
  return sidecarPidAlive();
}
```

Confirm `getIgStatusAction`'s result shape (an `ok` discriminated union) by reading `src/server/actions/ig-actions.ts`; adjust the `status.ok` check to its real shape.

- [ ] **Step 6: Write the SidecarControl component**

Create `src/components/settings/sidecar-control.tsx`, a client component with a Start and a Stop button (Start disabled when the health status is connected, Stop shown when the pid is alive or health answers), calling `startSidecarAction` and `stopSidecarAction`, then refreshing the section. Show a one-line status ("running", "not running") from `getIgStatusAction` plus `sidecarProcessAliveAction`. Match the button styling used elsewhere in the Instagram section.

- [ ] **Step 7: Mount it in the Instagram section**

In `src/components/settings/instagram-section.tsx`, render `<SidecarControl />` near the top of the section, above the existing "Instagram service isn't running" panel, so the button sits where the manual `npm run ig:service` instruction is today. Do not remove the existing status states; the button augments them.

- [ ] **Step 8: Typecheck and manual check**

Run: `npx tsc --noEmit`. Then in the browser, open `/settings`, Instagram section, click Start, and confirm the status flips to running (the controller runs this after merge if the worker cannot spawn processes).

- [ ] **Step 9: Commit**

```bash
git add src/server/sidecar/ src/server/actions/sidecar-actions.ts src/components/settings/sidecar-control.tsx src/components/settings/instagram-section.tsx
git commit -m "feat(sidecar): start and stop the sidecar from settings with injected env"
```

---

### Task 5: session-token Instagram login

**Files:**
- Modify: `src/server/actions/ig-actions.ts` (add `igLoginBySessionAction`)
- Modify: `src/server/actions/ig-actions.test.ts`
- Modify: `src/server/ig/client.ts` (add a `loginBySession` client call if one does not exist)
- Modify: `src/components/settings/instagram-section.tsx` (add the session panel)

**Interfaces:**
- Consumes: `setSecret` from `@/server/secrets/store`; the ig client; the sidecar endpoint `POST /login-by-session` with body `{ sessionid }`.
- Produces: `igLoginBySessionAction(sessionid: string): LoginResult` (same `LoginResult` type the other ig actions return).

- [ ] **Step 1: Confirm the ig client can call login-by-session**

Read `src/server/ig/client.ts`. It already posts to sidecar paths (see the `login`, `health` methods). Add a method that POSTs `/login-by-session` with `{ sessionid }` and returns the same health-shaped result the other login calls return, if one is not already present. Match the existing method style exactly.

- [ ] **Step 2: Write the failing action test**

In `src/server/actions/ig-actions.test.ts`, following the existing mock of the ig client (the file already mocks `login`, per its top), add:

```ts
test("igLoginBySessionAction stores the sessionid and calls the sidecar", async () => {
  sidecar.loginBySession.mockResolvedValue({ ...HEALTH, loggedIn: true, username: "kai" });
  const r = await igLoginBySessionAction("SESSIONID_VALUE");
  expect(r.ok).toBe(true);
  expect(sidecar.loginBySession).toHaveBeenCalledWith("SESSIONID_VALUE");
});

test("igLoginBySessionAction maps a sidecar error to a failure", async () => {
  sidecar.loginBySession.mockRejectedValue(new IgError("IG_AUTH_REQUIRED", "bad session"));
  const r = await igLoginBySessionAction("bad");
  expect(r.ok).toBe(false);
});
```

Add `loginBySession: vi.fn()` to the existing sidecar mock object at the top of the test, and import whatever `IgError`/`HEALTH` fixtures the file already uses. Match the file's real mock names.

- [ ] **Step 3: Run it, verify it fails**

Run: `npx vitest run src/server/actions/ig-actions.test.ts`
Expected: FAIL, no `igLoginBySessionAction`.

- [ ] **Step 4: Write the action**

Add to `src/server/actions/ig-actions.ts`, next to `igLoginAction`, matching its structure (the same `try/catch`, the same `toFailure` mapper, the same `LoginResult` return):

```ts
import { setSecret } from "@/server/secrets/store";

export async function igLoginBySessionAction(sessionid: string): Promise<LoginResult> {
  try {
    setSecret("IG_SESSIONID", sessionid);
    log.info("ig.login_by_session.requested", {});
    const { status } = await igClient.loginBySession(sessionid);
    log.info("ig.login_by_session.result", { status });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
```

Match the real names for `igClient`, `LoginResult`, `toFailure`, and `log` used in the file. The sidecar's `login_by_sessionid` returns a health-shaped object, the same as `login`, so `{ status }` destructuring mirrors `igLoginAction`.

- [ ] **Step 5: Run the action test, verify it passes**

Run: `npx vitest run src/server/actions/ig-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the session panel to the Instagram section**

In `src/components/settings/instagram-section.tsx`, add a "Sign in with a session token" panel above the username/password flow, labeled as recommended. One masked input for the `sessionid`, a short inline how-to ("open instagram.com logged in, open DevTools, Application, Cookies, copy the sessionid value"), and a Connect button calling `igLoginBySessionAction(sessionid)`, then refreshing status. Keep the existing password, 2FA, and challenge flow below it as the fallback.

- [ ] **Step 7: Typecheck and manual check**

Run: `npx tsc --noEmit`. Then in the browser (with the sidecar running via Task 4's button), paste a real `sessionid` and confirm the connection flips to connected. Controller may do this after merge.

- [ ] **Step 8: Commit**

```bash
git add src/server/actions/ig-actions.ts src/server/actions/ig-actions.test.ts src/server/ig/client.ts src/components/settings/instagram-section.tsx
git commit -m "feat(ig): session-token login wired to the sidecar login-by-session"
```

---

### Task 6: full gate

- [ ] **Step 1: Whole suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore(secrets): typecheck and build green"
```

## Self-review notes

- Spec coverage: secrets store + auto-gen + optional token (Task 1), consumers routed (Task 2), panel + actions (Task 3), sidecar spawn/stop with injected env (Task 4), session login (Task 5). All spec sections map to a task.
- Type consistency: `getSecret`, `setSecret`, `clearSecret`, `secretStatus`, `getOrCreateServiceToken`, `MANAGED_SECRETS`, `SecretStatus`, `ManagedSecret` are defined in Task 1 and used unchanged in Tasks 2 to 5. `LoginResult` and `SimpleResult` reuse the existing action types (implementer confirms the exact shapes from the files named).
- Coordination note: Tasks 4 and 5 both edit `instagram-section.tsx`. Task 4 mounts `SidecarControl` near the top; Task 5 adds the session panel. They touch different regions; if run in parallel worktrees, merge them in order (Task 4 then Task 5) and re-run the suite. Tasks 2, 3, 4, 5 all depend on Task 1 and are otherwise independent.
- Verification points left to the implementer, flagged inline: the exact `SimpleResult`/`LoginResult` shapes, the `getIgStatusAction` result shape, the current API keys component filename, and the ig client method style. Each step says which file to read first.
