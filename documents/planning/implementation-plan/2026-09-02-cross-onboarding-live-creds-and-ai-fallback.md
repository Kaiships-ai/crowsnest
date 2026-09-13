---
status: active
components: [onboarding, kit, llm]
backlog: onboarding#ENH-1
owner: session onboarding-and-studio-enhancement
shipped: null
---

# Onboarding Live Credentials and AI Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended), or execute the plan directly in this session — phase by phase, verifying each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two seams `documents/architect/core-components/onboarding/01-concept-brief.md` names as blocking a clean buyer install: dashboard-saved Instagram credentials never reach the packaged (launchd) sidecar, and a valid Anthropic key still fails when `LLM_BASE_URL` points at a 9router that isn't running.

**Architecture:** Feature A ports the existing `childEnv()` env-injection shape (`src/server/sidecar/control.ts`) into the launchd path (`src/cli/service-darwin.ts`), and adds one new server action, `igLoginWithCredentialsAction`, that validates a typed username/password against a real sidecar login *before* ever persisting it — the sidecar's own `/login` endpoint already accepts `{username, password}` directly (`services/ig/crowsnest_ig/app.py`), so this is a TypeScript/React-only change, no sidecar code touched. Feature B makes `getLlm()` reachability-aware (calls the existing `routerReachable()`) with a direct-Anthropic fallback, and makes `routerBin()` resolve `9router` from PATH so `npm install -g 9router` becomes a working guided install. Four stale-doc/comment defects are fixed as part of the nearest task that already touches each file.

**Tech Stack:** Next.js server actions, Drizzle/better-sqlite3, React client components, vitest (unit + drizzle-backed action tests), the `browse` skill for e2e-by-testid verification. No new npm dependencies.

**Spec:** `documents/architect/core-components/onboarding/03-feature-description.md` (sections 5 and 6), grounded by `01-concept-brief.md`, `02-architecture.md`, and `04-test-cases.md`.

## Global Constraints

- Zero new npm dependencies — every fix reuses code that already exists (`childEnv()`'s pattern, `igClient.login({username, password})`, `routerReachable()`, `setSecretAction`).
- No sidecar (Python) changes. `services/ig/crowsnest_ig/app.py`'s `/login` route and `session.py`'s `_credentials()` already accept a username/password in the request body independent of `.env.local` — verified by reading both files for this plan.
- `getLlm()` becomes `async`. Every existing call site must `await` it; do not add a parallel synchronous wrapper.
- The new username/password Instagram path is validate-then-save: a credential is written to the secrets store (`setSecret`/`setSecretAction`) only after a real sidecar login step reports `"ok"`, never before. Contrast with `igLoginBySessionAction`, which is documented, not changed, as write-before-validate.
- `data-testid` values must match exactly what `04-test-cases.md`'s "Not checkable by hand" footer under `## 3. browse-e2e` calls the must-add set: `secrets-anthropic-api-key-*`, `ig-session-*`, `ig-credentials-username-*` / `ig-credentials-password-*`, `router-*`. Do not invent additional testid families beyond what each task below specifies.
- Every managed secret continues to go through `src/server/secrets/store.ts`'s existing `MANAGED_SECRETS`/`getSecret`/`setSecret` — no new table, no new storage mechanism.
- Config keys already exist and are not renamed: `IG_USERNAME`, `IG_PASSWORD`, `IG_SERVICE_TOKEN`, `IG_PROXY`, `IG_DEVICE_SEED`, `LLM_BASE_URL`, `ROUTER_BIN`, `CROWSNEST_DB_PATH`.
- Global vitest setup (`src/test/setup-env.ts`) already defaults `CROWSNEST_DB_PATH=":memory:"` and `IG_SERVICE_TOKEN=test-token` before any test file's imports run — new tests that touch the db still explicitly set `CROWSNEST_DB_PATH=":memory:"` in a `beforeAll` and dynamically import, matching the established pattern in `src/server/queries/feed.test.ts` and `src/server/llm/client.test.ts`, for the same "must be set before the db singleton opens" reason those files document.

---

### Task 1: launchd env injection for the packaged Instagram sidecar

**Files:**
- Modify: `src/cli/service-darwin.ts`
- Test: `src/cli/service-darwin.test.ts` (new)

**Interfaces:**
- Consumes: `getOrCreateServiceToken(): string`, `getSecret(name: string): string | undefined` from `src/server/secrets/store.ts` (both already exist, both synchronous).
- Produces: `services(): Service[]` keeps its existing exported signature; `com.crowsnest.ig`'s `env` field is now populated instead of always `{}`.

Today `services()`'s `com.crowsnest.ig` entry hardcodes `env: {}`, so a buyer's launchd-run sidecar never receives `IG_USERNAME`/`IG_PASSWORD`/`IG_SERVICE_TOKEN` even after they're saved through the dashboard. `src/server/sidecar/control.ts`'s `childEnv()` (the dev/`uv run` launcher) already injects exactly these values from the secrets store — this task ports that shape into the launchd path, which is the process a real Kit install actually runs. Reading `src/server/db/index.ts` confirms the db singleton resolves `CROWSNEST_DB_PATH` (default `data/crowsnest.db`) relative to `process.cwd()` at import time; the `kai` CLI binary can be invoked from any directory (unlike the spawned server, which always gets `cwd: appRoot`), so this task must pin the path to an absolute one under `appRoot` before the secrets store's first import, or `getSecret` would silently read (or create) the wrong database and this whole fix would be a no-op that looks like it works.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/service-darwin.test.ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

// Same reasoning as src/server/queries/feed.test.ts: the db singleton binds
// CROWSNEST_DB_PATH at import, so it must be set before any dynamic import of
// "@/server/db" (or anything that imports it, including service-darwin.ts once this
// task lands).
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setSecret: typeof import("@/server/secrets/store")["setSecret"];
let services: typeof import("./service-darwin")["services"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({ services } = await import("./service-darwin"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.secrets);
});

describe("services", () => {
  test("com.crowsnest.ig receives IG_USERNAME/IG_PASSWORD/IG_SERVICE_TOKEN from the secrets store", () => {
    setSecret("IG_USERNAME", "burner.acct");
    setSecret("IG_PASSWORD", "hunter2");

    const ig = services().find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBe("burner.acct");
    expect(ig?.env.IG_PASSWORD).toBe("hunter2");
    expect(ig?.env.IG_SERVICE_TOKEN).toBeTruthy();
  });

  test("a credential never saved through the dashboard is simply absent, never an empty string", () => {
    const ig = services().find((s) => s.label === "com.crowsnest.ig");

    expect(ig?.env.IG_USERNAME).toBeUndefined();
    expect(ig?.env.IG_PASSWORD).toBeUndefined();
  });

  test("com.crowsnest.server keeps its existing fixed env, untouched by this change", () => {
    const server = services().find((s) => s.label === "com.crowsnest.server");

    expect(server?.env).toEqual({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3000" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/service-darwin.test.ts`
Expected: FAIL — `ig?.env.IG_USERNAME` is `undefined` in the first test (today's code always returns `env: {}`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/service-darwin.ts — imports
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { appRoot, igDir, igVenvPython, logDir, nodeBin, tsxBin } from "./runtime";
import { getOrCreateServiceToken, getSecret } from "../server/secrets/store";

// The only macOS-coded file. Windows/Linux later is one sibling (a Windows service, a
// systemd unit) behind this same small shape: define(), load(), unload(), running().

export type Service = {
  label: string;
  program: string[];
  cwd: string;
  env: Record<string, string>;
};

const AGENTS = join(homedir(), "Library", "LaunchAgents");

/**
 * Pins CROWSNEST_DB_PATH to an absolute path under `appRoot` before this module's first
 * import of `../server/secrets/store` (which opens the sqlite db at import time).
 * `@/server/db`'s own resolution is `process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db"`
 * relative to `process.cwd()` — fine for the spawned server (always `cwd: appRoot`, see
 * `services()` below) but not for the `kai` CLI binary itself, which a buyer can invoke
 * from any directory. Without this, `getSecret` below would silently open (or create) the
 * wrong database and this file's whole fix would look like it works while doing nothing.
 * Skips pinning when CROWSNEST_DB_PATH is already ":memory:" or already absolute, so
 * tests (which set ":memory:" before importing this module) are unaffected.
 */
function pinDbPathEnv(): void {
  const current = process.env.CROWSNEST_DB_PATH;
  if (current === ":memory:" || (current && isAbsolute(current))) return;
  const envPath = join(appRoot, ".env.local");
  const fromFile = existsSync(envPath) ? readFileSync(envPath, "utf8").match(/^CROWSNEST_DB_PATH=(.*)$/m)?.[1]?.trim() : undefined;
  const rel = current || fromFile || "data/crowsnest.db";
  process.env.CROWSNEST_DB_PATH = isAbsolute(rel) ? rel : join(appRoot, rel);
}
pinDbPathEnv();

/**
 * Env injected into the packaged sidecar's launchd job — the same shape as
 * `src/server/sidecar/control.ts`'s `childEnv()` (the dev/`uv run` launcher), ported to
 * the path a buyer's Kit install actually runs. `IG_PROXY`/`IG_DEVICE_SEED` are not in
 * `MANAGED_SECRETS`, so `getSecret` reads them from env only, same as `childEnv()` — they
 * stay dev-machine-only settings, not something the Settings UI manages. Only defined
 * values are added: a credential never saved through the dashboard is simply absent from
 * this dict, leaving `crowsnest_ig/config.py`'s own `load_env_file()` free to fill it from
 * `.env.local` exactly as it does today for a `kai kit init`-only buyer who never touched
 * the dashboard.
 */
function igEnv(): Record<string, string> {
  const inject: Record<string, string | undefined> = {
    IG_SERVICE_TOKEN: getOrCreateServiceToken(),
    IG_USERNAME: getSecret("IG_USERNAME"),
    IG_PASSWORD: getSecret("IG_PASSWORD"),
    IG_PROXY: getSecret("IG_PROXY"),
    IG_DEVICE_SEED: getSecret("IG_DEVICE_SEED"),
  };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(inject)) if (v) env[k] = v;
  return env;
}

/** The two long-lived processes: the Next server and the Instagram sidecar. */
export function services(): Service[] {
  return [
    {
      label: "com.crowsnest.server",
      // NODE_ENV=production + tsx server.ts, all absolute so a buyer's node is never used.
      program: [nodeBin, tsxBin, join(appRoot, "server.ts")],
      cwd: appRoot,
      // HOST binds the server to loopback so macOS never shows the "accept incoming
      // connections" firewall prompt. PORT stays the app default.
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "3000" },
    },
    {
      label: "com.crowsnest.ig",
      program: [igVenvPython, "-m", "crowsnest_ig"],
      cwd: igDir,
      env: igEnv(),
    },
  ];
}
```

(The rest of `service-darwin.ts` — `plistPath`, `plist`, `start`, `stop`, `running`, `installed` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/service-darwin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/service-darwin.ts src/cli/service-darwin.test.ts
git commit -m "fix(kit): inject IG credentials from the secrets store into the launchd sidecar job

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 2: secrets-section.tsx — accurate copy + `secrets-anthropic-api-key-*` testids

**Files:**
- Modify: `src/components/settings/secrets-section.tsx`

**Interfaces:**
- Consumes: nothing new — `SecretStatus`, `setSecretAction`, `getSecretStatusAction`, `testAnthropicKeyAction` are all pre-existing.
- Produces: `data-testid`s consumed by `browse-e2e` case E2E-02 and, once Task 1 lands, an accurate claim about when a saved secret takes effect.

Cleanup (c): the panel's header copy claims "Values set here... take effect immediately, with no app restart," which is true for `ANTHROPIC_API_KEY` (client cache reset) but was false for `IG_USERNAME`/`IG_PASSWORD` before Task 1 (the sidecar only read `.env.local` at boot) and is still only true "on the sidecar's next restart" after Task 1 (launchd env is read once, at process start, not live). This step corrects that claim.

This is a copy-and-testid-only change; no test file changes (the panel has no existing unit test, and its behavior is unchanged — only markup and prose).

- [ ] **Step 1: Add `data-testid`s to the generic `SecretRow`, keyed off each secret's name**

```tsx
// src/components/settings/secrets-section.tsx
// Add near the top, after SECRET_META:
function testIdSlug(name: ManagedSecret): string {
  return name.toLowerCase().replace(/_/g, "-");
}
```

Then, inside `SecretRow`, add `data-testid={`secrets-${testIdSlug(status.name)}-badge`}` to the `<Badge>`:

```tsx
<Badge data-testid={`secrets-${testIdSlug(status.name)}-badge`} variant={status.configured ? "secondary" : "outline"}>
  {status.configured ? "Configured" : "Not set"}
</Badge>
```

Add `data-testid={`secrets-${testIdSlug(status.name)}-test`}` to the Test button:

```tsx
<Button
  size="sm"
  variant="outline"
  data-testid={`secrets-${testIdSlug(status.name)}-test`}
  onClick={() => void runTest()}
  disabled={!status.configured || testing}
>
  {testing ? "Testing…" : "Test"}
</Button>
```

Add `data-testid={`secrets-${testIdSlug(status.name)}-edit`}` to the Set/Replace button:

```tsx
{!editing && (
  <Button size="sm" variant="outline" data-testid={`secrets-${testIdSlug(status.name)}-edit`} onClick={() => setEditing(true)}>
    {status.configured ? "Replace" : "Set"}
  </Button>
)}
```

Add `data-testid={`secrets-${testIdSlug(status.name)}-input`}` to the masked `<Input>`, and `data-testid={`secrets-${testIdSlug(status.name)}-save`}` to the Save button:

```tsx
<Input
  type={revealed ? "text" : "password"}
  autoComplete="off"
  placeholder={`New ${meta.label} value`}
  value={value}
  onChange={(e) => setValue(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !pending) save();
  }}
  className="pr-8"
  aria-label={`${meta.label} value`}
  data-testid={`secrets-${testIdSlug(status.name)}-input`}
/>
```

```tsx
<Button size="sm" variant="secondary" data-testid={`secrets-${testIdSlug(status.name)}-save`} onClick={save} disabled={pending}>
  {pending ? "Saving…" : "Save"}
</Button>
```

For `ANTHROPIC_API_KEY` this produces exactly `secrets-anthropic-api-key-edit`, `-input`, `-save`, `-test`, `-badge` — the five testids `04-test-cases.md`'s E2E-02 names — and every other row gets the same family for free, with no per-row special-casing.

- [ ] **Step 2: Fix the stale "takes effect immediately" claim**

```tsx
// Before:
<p className="text-sm text-muted-foreground">
  Values set here are stored in the local database and take effect immediately, with no app restart. A value from{" "}
  <code>.env.local</code> is used until something is set here. No value is ever shown once saved. The Instagram sidecar is the one
  exception: it reads its token once at startup.
</p>

// After:
<p className="text-sm text-muted-foreground">
  Values set here are stored in the local database. For the Anthropic and Groq keys this takes effect on the very next call, no app
  restart needed. A value from <code>.env.local</code> is used until something is set here. No value is ever shown once saved. The
  Instagram sidecar is the one exception: it reads its username, password, and service token once at startup, so a change here takes
  effect the next time the sidecar restarts, not immediately.
</p>
```

- [ ] **Step 3: Manually verify with the `browse` skill**

Start the dev server, open `/settings`, and drive E2E-02 from `04-test-cases.md` by testid: `secrets-anthropic-api-key-edit` → type into `secrets-anthropic-api-key-input` → `secrets-anthropic-api-key-save` → `secrets-anthropic-api-key-test` → confirm `secrets-anthropic-api-key-badge` reads "Configured" and the Test click reports success.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/secrets-section.tsx
git commit -m "fix(settings): accurate secret-effect copy + secrets-* testids for browse-e2e

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 3: `igLoginWithCredentialsAction` — validate-then-save username/password login

**Files:**
- Modify: `src/server/actions/ig-actions.ts`
- Test: `src/server/actions/ig-actions.test.ts` (append)

**Interfaces:**
- Consumes: `igClient.login(input: { username?: string; password?: string; verificationCode?: string }): Promise<{ status: IgLoginStatus }>` (already exists, already accepts credentials directly — confirmed in `src/server/ig/client.ts:413` and the sidecar's `LoginRequest` model), `setSecret(name: string, value: string): void` (already exists).
- Produces: `igLoginWithCredentialsAction(username: string, password: string): Promise<LoginResult>` — same `LoginResult` union every other login action in this file already returns (`{ ok: true; status: IgLoginStatus } | Failure`). Consumed by Task 4 (Settings) and Task 5 (first-run connect step).

The sidecar's own `/login` route already accepts a username/password in the request body, bypassing `.env.local` entirely (`services/ig/crowsnest_ig/session.py`'s `_credentials()`: an explicit `username`/`password` argument wins over `self.config.username`/`password`). So this task is pure TypeScript: a new action that calls `igClient.login({ username, password })` for a real, immediate login attempt, and persists to the secrets store only when that attempt's status is `"ok"`. A `two_factor_required`/`challenge_required` status is returned as-is, unsaved — Tasks 4 and 5 finish that case through the *existing*, unmodified `igChallengeChooseAction`/`igChallengeCodeAction`/`igTwoFactorAction` (the sidecar already remembers the pending username/password from this call's own `/login` request, in `session.py`'s `_pending_credentials`), then persist once one of those reports `"ok"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/actions/ig-actions.test.ts — append inside the existing file, reusing its
// top-level `sidecar` and `secretsStore` vi.hoisted mocks.

describe("igLoginWithCredentialsAction", () => {
  test("validates first: a wrong password is rejected and nothing is saved", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_BAD_CREDENTIALS", "rejected"));

    const result = await igLoginWithCredentialsAction("burner.acct", "wrong-password");

    expect(result).toMatchObject({ ok: false, code: "IG_BAD_CREDENTIALS" });
    expect(sidecar.login).toHaveBeenCalledWith({ username: "burner.acct", password: "wrong-password" });
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("an immediate ok persists IG_USERNAME and IG_PASSWORD", async () => {
    sidecar.login.mockResolvedValue({ status: "ok" });

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toEqual({ ok: true, status: "ok" });
    expect(secretsStore.setSecret).toHaveBeenCalledWith("IG_USERNAME", "burner.acct");
    expect(secretsStore.setSecret).toHaveBeenCalledWith("IG_PASSWORD", "correct-password");
  });

  test("two_factor_required is returned unsaved — the login isn't finished yet", async () => {
    sidecar.login.mockResolvedValue({ status: "two_factor_required" });

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toEqual({ ok: true, status: "two_factor_required" });
    expect(secretsStore.setSecret).not.toHaveBeenCalled();
  });

  test("rejects a blank username or password locally, without calling the sidecar", async () => {
    const result = await igLoginWithCredentialsAction("", "something");

    expect(result).toMatchObject({ ok: false, code: "IG_INVALID_INPUT" });
    expect(sidecar.login).not.toHaveBeenCalled();
  });

  test("a rate limit from the sidecar's own cooldown is reported as retryable, not swallowed", async () => {
    sidecar.login.mockRejectedValue(new IgError("IG_RATE_LIMITED", "429"));

    const result = await igLoginWithCredentialsAction("burner.acct", "correct-password");

    expect(result).toMatchObject({ ok: false, code: "IG_RATE_LIMITED", retryable: true });
  });
});
```

Also add the new import at the top of the test file:

```ts
import {
  getIgStatusAction,
  igChallengeChooseAction,
  igChallengeCodeAction,
  igLoginAction,
  igLoginBySessionAction,
  igLoginWithCredentialsAction,
  igLogoutAction,
  igTwoFactorAction,
} from "./ig-actions";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/actions/ig-actions.test.ts`
Expected: FAIL — `igLoginWithCredentialsAction is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

First, update the module doc's rule 2 (cleanup d also lands here — the `igLoginBySessionAction` ordering annotation):

```ts
// src/server/actions/ig-actions.ts — replace rule 2's paragraph:
 *  2. **No action accepts a password blind.** `igLoginAction()` takes *no arguments at
 *     all* — the sidecar logs in with `IG_USERNAME`/`IG_PASSWORD` from its own
 *     environment, and those values never enter this process, this response, or a log
 *     line. `igLoginWithCredentialsAction` below is the one deliberate exception: it
 *     exists specifically to validate a typed password against a real sidecar login
 *     before ever persisting it — the opposite of a blind write — see its own doc for
 *     why that's a different risk than an action that just accepted and stored
 *     `(username, password)`.
```

Then add the annotation to `igLoginBySessionAction`'s doc, right before its closing `*/`:

```ts
 * Note the write order here: `IG_SESSIONID` is persisted *before* the sidecar call
 * resolves, so a rejected sessionid is still saved as if it worked. That's a deliberate,
 * narrower risk for a value that expires and gets replaced routinely, not a pattern to
 * copy — `igLoginWithCredentialsAction` below validates first and saves only on success,
 * for exactly that reason.
 */
export async function igLoginBySessionAction(sessionid: string): Promise<LoginResult> {
```

Then add the new action, after `igLoginBySessionAction`:

```ts
/**
 * Signs in with a typed username and password, validating against the sidecar BEFORE
 * persisting anything (03-feature-description.md §5, ENH-1) — the opposite order from
 * `igLoginBySessionAction` above. `IG_USERNAME`/`IG_PASSWORD` are only written to the
 * secrets store when the sidecar's own `/login` reports `"ok"` for THIS call; a rejected
 * login changes nothing. A `two_factor_required`/`challenge_required` status is returned
 * as-is, unsaved — the login isn't finished, so there's nothing yet to persist. The caller
 * (Settings' Instagram section, `/first-run`'s connect step) finishes that case through the
 * existing, unmodified `igChallengeChooseAction`/`igChallengeCodeAction`/`igTwoFactorAction`
 * — the sidecar already remembers the pending username/password from this call's own
 * `/login` request (`session.py`'s `_pending_credentials`) — and persists the credentials
 * it already holds once one of those reports `"ok"`.
 *
 * Reuses the sidecar's own rate-limit/cooldown (`IG_RATE_LIMITED`) rather than opening a
 * second, faster retry loop: this calls the exact same `/login` endpoint every other login
 * path in this file calls, so a fixed username submitted repeatedly hits the same
 * server-side cooldown `igLoginAction` already would.
 */
export async function igLoginWithCredentialsAction(username: string, password: string): Promise<LoginResult> {
  const user = username.trim();
  if (!user || !password) return invalidInput("Enter both a username and a password.");
  try {
    log.info("ig.login_with_credentials.requested", {});
    const { status } = await igClient.login({ username: user, password });
    log.info("ig.login_with_credentials.result", { status });
    if (status === "ok") {
      setSecret("IG_USERNAME", user);
      setSecret("IG_PASSWORD", password);
    }
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/actions/ig-actions.test.ts`
Expected: PASS (all existing tests in this file plus the five new ones)

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/ig-actions.ts src/server/actions/ig-actions.test.ts
git commit -m "feat(ig): add igLoginWithCredentialsAction — validate a real login before saving

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 4: Settings' Instagram section — username/password form + testids

**Files:**
- Modify: `src/components/settings/instagram-section.tsx`

**Interfaces:**
- Consumes: `igLoginWithCredentialsAction` (Task 3), `setSecretAction` (`src/server/actions/secrets-actions.ts`, pre-existing), `igChallengeChooseAction`/`igChallengeCodeAction`/`igTwoFactorAction` (pre-existing, unchanged).
- Produces: `data-testid`s `ig-session-input`, `ig-session-connect-button`, `ig-connection-status-badge`, `ig-credentials-username-input`, `ig-credentials-password-input`, `ig-credentials-submit-button`, `ig-credentials-error` — the full set `04-test-cases.md` names for E2E-03/E2E-04.

No unit test for this task: `instagram-section.tsx` has no existing test file, and this is a UI-only addition over an already-tested action (Task 3). Verified instead via `browse-e2e` in Step 4.

- [ ] **Step 1: Add testids to the existing session-token block and the connected badge**

```tsx
// The sessionid Input:
<Input
  id="ig-sessionid"
  data-testid="ig-session-input"
  type="password"
  value={sessionid}
  onChange={(e) => setSessionid(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !busy && phase !== "connecting") void connectWithSession();
  }}
  autoComplete="off"
  placeholder="paste the sessionid cookie value"
  className="max-w-sm font-mono"
/>
```

```tsx
<Button
  size="sm"
  variant="secondary"
  data-testid="ig-session-connect-button"
  onClick={() => void connectWithSession()}
  disabled={busy || phase === "connecting" || sessionid.trim().length === 0}
>
  {phase === "connecting" ? "Connecting…" : "Connect"}
</Button>
```

Give `StatusRow` an optional `testId` prop and pass it through:

```tsx
function StatusRow({ tone, label, detail, testId }: { tone: "ok" | "warn" | "bad" | "busy"; label: string; detail?: string; testId?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "busy" ? Loader2 : tone === "bad" ? CircleOff : AlertTriangle;
  const color =
    tone === "ok" ? "text-[var(--pos)]" : tone === "bad" ? "text-destructive" : tone === "busy" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex items-center gap-2 text-sm" data-testid={testId}>
      <Icon className={`size-4 shrink-0 ${color} ${tone === "busy" ? "animate-spin" : ""}`} aria-hidden />
      <span className="font-medium">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">({detail})</span>}
    </div>
  );
}
```

```tsx
{view === "connected" && status && (
  <>
    <StatusRow testId="ig-connection-status-badge" tone="ok" label={status.username ? `Connected as @${status.username}` : "Connected"} />
```

- [ ] **Step 2: Add local state and handlers for the credentials form**

```tsx
// Inside InstagramSection, alongside the existing useState calls:
const [credUsername, setCredUsername] = useState("");
const [credPassword, setCredPassword] = useState("");
type CredPhase = "idle" | "submitting" | "two_factor" | "challenge_choice" | "challenge_code";
const [credPhase, setCredPhase] = useState<CredPhase>("idle");
const [credCode, setCredCode] = useState("");
const [credError, setCredError] = useState<string | null>(null);

/** Persists the credentials this component already holds — called once a login that
 *  started via `igLoginWithCredentialsAction` reaches a real "ok", whether immediately
 *  or after a 2FA/challenge code, since that action itself only persists on an
 *  *immediate* ok (see its own doc). */
async function finishCredLogin() {
  await Promise.all([setSecretAction("IG_USERNAME", credUsername), setSecretAction("IG_PASSWORD", credPassword)]);
  setCredPhase("idle");
  setCredUsername("");
  setCredPassword("");
  await refreshStatus();
}

function handleCredLoginResult(result: LoginResult) {
  if (!result.ok) {
    setCredError(result.error);
    setCredPhase("idle");
    return;
  }
  setCredError(null);
  setCredCode("");
  if (result.status === "two_factor_required") setCredPhase("two_factor");
  else if (result.status === "challenge_required") setCredPhase("challenge_choice");
}

async function submitCredLogin() {
  setCredError(null);
  setCredPhase("submitting");
  const result = await igLoginWithCredentialsAction(credUsername.trim(), credPassword);
  if (result.ok && result.status === "ok") {
    await finishCredLogin();
    return;
  }
  handleCredLoginResult(result);
}

async function chooseCredChallengeChannel(choice: "email" | "sms") {
  setBusy(true);
  const result = await igChallengeChooseAction(choice);
  setBusy(false);
  if (!result.ok) {
    setCredError(result.error);
    setCredPhase("idle");
    return;
  }
  if (result.status === "challenge_required") {
    setCredCode("");
    setCredPhase("challenge_code");
  } else if (result.status === "ok") {
    await finishCredLogin();
  } else {
    setCredPhase("idle");
  }
}

async function submitCredCode(kind: "challenge" | "two_factor") {
  setBusy(true);
  setCredError(null);
  const result = kind === "challenge" ? await igChallengeCodeAction(credCode) : await igTwoFactorAction(credCode);
  setBusy(false);
  if (!result.ok) {
    setCredError(result.error);
    return;
  }
  if (result.status === "ok") await finishCredLogin();
  else setCredPhase(result.status === "two_factor_required" ? "two_factor" : "challenge_choice");
}
```

Add the new import at the top:

```tsx
import { igLoginWithCredentialsAction } from "@/server/actions/ig-actions";
import { setSecretAction } from "@/server/actions/secrets-actions";
```

- [ ] **Step 3: Render the credentials form**

Insert this block right after the existing "Sign in with a session token" `<div>` (still inside `{view !== "connected" && (...)}`):

```tsx
<div className="flex flex-col gap-3 border border-border p-4">
  <h3 className="text-sm font-semibold">Sign in with a username and password</h3>
  <p className="text-xs text-muted-foreground">
    Validated against a real sidecar login before anything is saved — a wrong password is never stored as configured.
  </p>
  {credPhase === "idle" && (
    <>
      <div className="flex max-w-sm flex-col gap-2">
        <Label htmlFor="ig-credentials-username">Username</Label>
        <Input
          id="ig-credentials-username"
          data-testid="ig-credentials-username-input"
          value={credUsername}
          onChange={(e) => setCredUsername(e.target.value)}
          autoComplete="off"
        />
        <Label htmlFor="ig-credentials-password">Password</Label>
        <Input
          id="ig-credentials-password"
          data-testid="ig-credentials-password-input"
          type="password"
          value={credPassword}
          onChange={(e) => setCredPassword(e.target.value)}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "Enter" && credUsername.trim() && credPassword) void submitCredLogin();
          }}
        />
      </div>
      <div>
        <Button
          size="sm"
          variant="secondary"
          data-testid="ig-credentials-submit-button"
          onClick={() => void submitCredLogin()}
          disabled={!credUsername.trim() || !credPassword}
        >
          Connect
        </Button>
      </div>
      {credError && (
        <p data-testid="ig-credentials-error" className="text-sm text-destructive">
          {credError}
        </p>
      )}
    </>
  )}
  {credPhase === "submitting" && <StatusRow tone="busy" label="Signing in…" />}
  {credPhase === "two_factor" && (
    <CodeForm
      id="ig-credentials-2fa-code"
      label="6-digit code"
      hint="From your authenticator app or SMS."
      value={credCode}
      busy={busy}
      onChange={setCredCode}
      onSubmit={() => void submitCredCode("two_factor")}
      onCancel={() => setCredPhase("idle")}
    />
  )}
  {credPhase === "challenge_choice" && (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void chooseCredChallengeChannel("email")} disabled={busy}>
        Email
      </Button>
      <Button size="sm" variant="outline" onClick={() => void chooseCredChallengeChannel("sms")} disabled={busy}>
        SMS
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setCredPhase("idle")} disabled={busy}>
        Cancel
      </Button>
    </div>
  )}
  {credPhase === "challenge_code" && (
    <CodeForm
      id="ig-credentials-challenge-code"
      label="Verification code"
      hint="The code Instagram just sent to the channel you picked."
      value={credCode}
      busy={busy}
      onChange={setCredCode}
      onSubmit={() => void submitCredCode("challenge")}
      onCancel={() => setCredPhase("idle")}
    />
  )}
</div>
```

- [ ] **Step 4: Manually verify with the `browse` skill**

With the sidecar up and a real burner account: open `/settings`, drive E2E-04 by testid (`ig-credentials-username-input`, `ig-credentials-password-input`, `ig-credentials-submit-button`) with a deliberately wrong password first — confirm `ig-credentials-error` shows an inline error and the `secrets-ig-username-badge`/`secrets-ig-password-badge` rows (Task 2's generic testids) stay "Not set" or unchanged. Then correct the password and resubmit — confirm the panel ends connected. Separately drive E2E-03 with `ig-session-input`/`ig-session-connect-button` and confirm `ig-connection-status-badge` survives a reload.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/instagram-section.tsx
git commit -m "feat(settings): validate-then-save username/password Instagram login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 5: `/first-run`'s connect step — same credential path

**Files:**
- Modify: `src/components/first-run/connect-step.tsx`

**Interfaces:**
- Consumes: `igLoginWithCredentialsAction` (Task 3), `setSecretAction` (pre-existing). Reuses this file's own existing `phase`, `afterLogin`, `CodeForm`, `codeInputRef` state machine rather than duplicating a parallel one.

Feature A's brief names both surfaces ("first-run connect step + Settings Instagram section"). This task reuses the *existing* `phase`/`afterLogin`/`submitCode`/`chooseChallengeChannel` machinery already in this file (all of which already render the right UI for `two_factor`/`challenge_choice`/`challenge_code`), adding only: local username/password state, a `connectWithCredentials()` entry point, and a `credentialsPending` flag so `submitCode`/`chooseChallengeChannel` know to persist once a login that started via credentials reaches `"ok"`.

- [ ] **Step 1: Add state**

```tsx
// Inside ConnectStep, alongside existing useState calls:
const [credUsername, setCredUsername] = useState("");
const [credPassword, setCredPassword] = useState("");
// Set only while a credentials-path login is mid-flow (2FA/challenge not yet resolved)
// — tells submitCode/chooseChallengeChannel below whether a final "ok" should also
// persist IG_USERNAME/IG_PASSWORD, since igLoginWithCredentialsAction only persists on
// an *immediate* ok (see that action's own doc).
const [credentialsPending, setCredentialsPending] = useState<{ username: string; password: string } | null>(null);
const [credError, setCredError] = useState<string | null>(null);
```

Add the new imports:

```tsx
import { igLoginWithCredentialsAction } from "@/server/actions/ig-actions";
import { setSecretAction } from "@/server/actions/secrets-actions";
```

- [ ] **Step 2: Add `connectWithCredentials` and extend `submitCode`/`chooseChallengeChannel`**

```tsx
async function connectWithCredentials() {
  const user = credUsername.trim();
  if (!user || !credPassword) return;
  setCredError(null);
  setLoginFailure(null);
  setPhase("connecting");
  const result = await igLoginWithCredentialsAction(user, credPassword);
  if (result.ok && result.status === "ok") {
    await Promise.all([setSecretAction("IG_USERNAME", user), setSecretAction("IG_PASSWORD", credPassword)]);
    setCredUsername("");
    setCredPassword("");
    afterLogin(result);
    await refreshStatus();
    return;
  }
  if (result.ok) setCredentialsPending({ username: user, password: credPassword });
  if (!result.ok) setCredError(result.error);
  afterLogin(result);
}
```

In the existing `chooseChallengeChannel`, replace the success branch:

```tsx
// Before:
    } else {
      afterLogin(result);
      if (result.status === "ok") await refreshStatus();
    }

// After:
    } else {
      afterLogin(result);
      if (result.status === "ok") {
        if (credentialsPending) {
          await Promise.all([setSecretAction("IG_USERNAME", credentialsPending.username), setSecretAction("IG_PASSWORD", credentialsPending.password)]);
          setCredentialsPending(null);
        }
        await refreshStatus();
      }
    }
```

In the existing `submitCode`, replace the success branch:

```tsx
// Before:
    afterLogin(result);
    if (result.status === "ok") await refreshStatus();
  }

// After:
    afterLogin(result);
    if (result.status === "ok") {
      if (credentialsPending) {
        await Promise.all([setSecretAction("IG_USERNAME", credentialsPending.username), setSecretAction("IG_PASSWORD", credentialsPending.password)]);
        setCredentialsPending(null);
      }
      await refreshStatus();
    }
  }
```

- [ ] **Step 3: Render the credential form**

Insert this block into the `{phase === "idle" && !status?.loggedIn && (...)}` branch, right before the `serviceDown` block:

```tsx
{!serviceDown && (
  <div className="mt-8 max-w-[460px] border border-border p-4">
    <p className="text-sm font-medium">Or sign in with a username and password</p>
    <p className="mt-1.5 text-xs text-muted-foreground">Checked against a real login before anything is saved.</p>
    <div className="mt-4 flex flex-col gap-2.5">
      <Label htmlFor="ig-credentials-username">Username</Label>
      <Input
        id="ig-credentials-username"
        data-testid="ig-credentials-username-input"
        value={credUsername}
        onChange={(e) => setCredUsername(e.target.value)}
        autoComplete="off"
      />
      <Label htmlFor="ig-credentials-password">Password</Label>
      <Input
        id="ig-credentials-password"
        data-testid="ig-credentials-password-input"
        type="password"
        value={credPassword}
        onChange={(e) => setCredPassword(e.target.value)}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Enter" && credUsername.trim() && credPassword) void connectWithCredentials();
        }}
      />
    </div>
    <Button
      size="sm"
      className="mt-4"
      data-testid="ig-credentials-submit-button"
      onClick={() => void connectWithCredentials()}
      disabled={busy || !credUsername.trim() || !credPassword}
    >
      Connect
    </Button>
    {credError && (
      <p data-testid="ig-credentials-error" className="mt-2 text-sm text-destructive">
        {credError}
      </p>
    )}
  </div>
)}
```

- [ ] **Step 4: Manually verify with the `browse` skill**

Open `/first-run` on a fresh install with the sidecar up, reach `02 · INSTAGRAM`, and drive the same `ig-credentials-*` testids as Task 4's E2E-04, confirming a wrong password shows `ig-credentials-error` and does not advance, and a correct one reaches the CONNECTED view.

- [ ] **Step 5: Commit**

```bash
git add src/components/first-run/connect-step.tsx
git commit -m "feat(first-run): validate-then-save username/password Instagram login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 6: doc truth-pass — ONB-1/ONB-2 no longer live (cleanup a)

**Files:**
- Modify: `documents/architect/core-components/onboarding/03-feature-description.md`

No code, no test — `05-backlog-to-enhance.md` already marks both `ONB-1` and `ONB-2` "done", and `01-concept-brief.md`'s own status line already says "The two `kai kit init` secret prompt defects... are fixed." Section 2 of `03-feature-description.md` is the one place still describing them as live blockers.

- [ ] **Step 1: Update the feature summary table's Open item cell**

```md
<!-- Before -->
| 2 | Set up crowsnest in the terminal | `kai kit init` writes `.env.local`, prompts for Instagram credentials and an optional Anthropic key, creates the database, and starts the app | ◐ | `src/cli/kai.ts` (`cmdKitInit`) | ONB-1, ONB-2 |

<!-- After -->
| 2 | Set up crowsnest in the terminal | `kai kit init` writes `.env.local`, prompts for Instagram credentials and an optional Anthropic key, creates the database, and starts the app | ● | `src/cli/kai.ts` (`cmdKitInit`) | none — ONB-1/ONB-2 fixed, see 05-backlog-to-enhance.md |
```

- [ ] **Step 2: Update the Limitations bullets under section 2**

```md
<!-- Before -->
- **The masked `IG_PASSWORD` prompt saves an empty value on a real terminal** (`ONB-1`, blocker). The username saves, but the masked password read comes back empty, so `.env.local` gets `IG_PASSWORD=`. The Instagram sidecar then refuses to start ("IG_USERNAME and IG_PASSWORD must be set together", exit 78), launchd crash loops it, and Instagram sync never works. Nothing at onboarding time warns the buyer; the failure only shows up later as a dead sidecar. In the app, the connect step reports this as the local Instagram service isn't running.
- **The `ANTHROPIC_API_KEY` prompt echoes the key in plaintext** (`ONB-2`, medium). The same masked prompt code fails to suppress the echo on this terminal, so the key is visible on screen and lands in scrollback. It is entered and saved correctly; the defect is only that it is not hidden.

<!-- After -->
- **Fixed: the masked `IG_PASSWORD` prompt used to save an empty value on a real terminal** (`ONB-1`, was a blocker, now done — see `05-backlog-to-enhance.md`). The username saved, but the masked password read came back empty, so `.env.local` got `IG_PASSWORD=`, and the Instagram sidecar refused to start. Kept here as history: this was the failure mode a re-regression in `ask`'s secret path would reproduce.
- **Fixed: the `ANTHROPIC_API_KEY` prompt used to echo the key in plaintext** (`ONB-2`, was medium severity, now done). The same masked prompt code failed to suppress the echo on a real terminal; the key was entered and saved correctly, but was visible on screen and landed in scrollback.
```

- [ ] **Step 3: Commit**

```bash
git add documents/architect/core-components/onboarding/03-feature-description.md
git commit -m "docs(onboarding): mark ONB-1/ONB-2 fixed in 03-feature-description, matching 05-backlog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 7: `routerBin()` resolves `9router` from PATH

**Files:**
- Modify: `src/server/llm/router-control.ts`
- Test: `src/server/llm/router-control.test.ts` (append)

**Interfaces:**
- Consumes: `execFileSync` from `node:child_process` (already a project dependency, no new import target).
- Produces: `routerBin()` stays private/unexported (unchanged signature `(): string`), but now tries `ROUTER_BIN` env override first (unchanged), then a PATH lookup for `9router`, then the hardcoded Homebrew path last. This is what makes the guided keyless install (`npm install -g 9router` — Task 9) actually work: npm's global bin directory is on `PATH` for essentially every shell setup, but was never checked before.

- [ ] **Step 1: Extend the existing `node:child_process` mock and write the failing tests**

```ts
// src/server/llm/router-control.test.ts — change the top-level mock:
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ pid: 9999, unref: vi.fn(), on: vi.fn() })),
  execFileSync: vi.fn(),
}));
```

Add these two tests immediately after the existing `"startRouter resolves the binary from ROUTER_BIN when set"` test:

```ts
  test("startRouter resolves the binary from PATH when ROUTER_BIN is unset and `which` finds it", async () => {
    unreachable();
    const { spawn, execFileSync } = await import("node:child_process");
    delete process.env.ROUTER_BIN;
    vi.mocked(execFileSync).mockReturnValue("/Users/kai/.npm-global/bin/9router\n" as unknown as Buffer);

    await control.startRouter();

    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/Users/kai/.npm-global/bin/9router");
    expect(execFileSync).toHaveBeenCalledWith("which", ["9router"], { encoding: "utf8" });
  });

  test("startRouter falls back to the hardcoded Homebrew path when neither ROUTER_BIN nor PATH resolve it", async () => {
    unreachable();
    const { spawn, execFileSync } = await import("node:child_process");
    delete process.env.ROUTER_BIN;
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("which: no 9router in PATH");
    });

    await control.startRouter();

    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/opt/homebrew/bin/9router");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/llm/router-control.test.ts`
Expected: FAIL — the first new test expects `/Users/kai/.npm-global/bin/9router`, but today's `routerBin()` never calls `execFileSync` at all, so it returns the hardcoded Homebrew path regardless.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/llm/router-control.ts
import { execFileSync, spawn } from "node:child_process";
// (existing imports unchanged below this line)

/** Best-effort PATH lookup for a binary name. Never throws: `execFileSync("which", ...)`
 *  exits non-zero (and this mocked-`vi.fn()` default returns `undefined`) when nothing on
 *  PATH matches, which is the common case before a first `npm install -g 9router`. */
function resolveFromPath(bin: string): string | null {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" });
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

/** Resolves the 9router binary: `ROUTER_BIN` env override wins first (unchanged), then
 *  whatever `which 9router` finds on PATH — this is what makes `npm install -g 9router`
 *  (03-feature-description.md §6's guided keyless-install path) work without also
 *  requiring `ROUTER_BIN` to be set by hand, since npm's global bin directory is on PATH
 *  for essentially every shell setup. The hardcoded Homebrew default from before this
 *  change is now the last resort. */
function routerBin(): string {
  return process.env.ROUTER_BIN ?? resolveFromPath("9router") ?? "/opt/homebrew/bin/9router";
}
```

(`spawn` was already imported; only `execFileSync` is new on that line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/llm/router-control.test.ts`
Expected: PASS (all existing tests plus the two new ones — the pre-existing "spawns tray binary... /opt/homebrew/bin/9router" and "resolves from ROUTER_BIN" tests still pass because `execFileSync` defaults to returning `undefined` when unconfigured, and `resolveFromPath` treats that as "not found").

- [ ] **Step 5: Commit**

```bash
git add src/server/llm/router-control.ts src/server/llm/router-control.test.ts
git commit -m "feat(llm): resolve 9router from PATH so npm install -g 9router works unassisted

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 8: `getLlm()` falls back to direct Anthropic when the proxy is unreachable

**Files:**
- Modify: `src/server/llm/client.ts`
- Modify (mechanical `await` add only): `src/server/services/analyze.ts`, `src/server/services/ideas.ts`, `src/server/services/remix.ts` (three call sites), `src/server/actions/settings-actions.ts`, `src/server/llm/generation-probe.ts`
- Test: `src/server/llm/client.test.ts` (append)

**Interfaces:**
- Consumes: `routerReachable(timeoutMs?: number): Promise<boolean>` from `src/server/llm/router-control.ts` (already exists, already exported).
- Produces: `getLlm()` changes signature from `(): LlmClient` to `(): Promise<LlmClient>`. Every existing caller (all six call sites above, verified by grepping `getLlm(` across `src`) already sits inside an `async` function using the `opts?.llm ?? getLlm()` injection pattern — each becomes `opts?.llm ?? (await getLlm())`, a mechanical change with no other logic touched. `isCompatMode()` keeps its existing presence-only signature and behavior unchanged (ACTION-12's test contract: independent of key configuration) — it now describes "a proxy address is configured," not "every call routes through it," which is a documented, deliberate simplification (see Risks).

This closes the gap `02-architecture.md` §8 names: "no code (`getLlm()` or a caller) currently calls `routerReachable()` before deciding which client to hand back." A valid key with `LLM_BASE_URL` set-but-unreachable now falls through to `AnthropicLlmClient` instead of a `CompatLlmClient` pointed at a dead address.

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/llm/client.test.ts — append. This file's beforeAll already dynamically
// imports "./client"; add routerReachable to that same pattern.
```

Add to the existing `beforeAll`'s destructuring (the file already mocks nothing for router-control, so mock it before the dynamic import):

```ts
// Near the top of the file, alongside the other `let` declarations:
let routerControl: { routerReachable: ReturnType<typeof vi.fn> };

// Replace the client.ts import line inside beforeAll with a vi.doMock first:
beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  routerControl = { routerReachable: vi.fn().mockResolvedValue(true) };
  vi.doMock("./router-control", () => routerControl);
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setSecret } = await import("@/server/secrets/store"));
  ({
    NoApiKeyError,
    LlmParseError,
    getLlm,
    hasLlmKey,
    isCompatMode,
    resolveModel,
    resetLlmClient,
    _createLlm,
    _createCompatLlm,
  } = await import("./client"));
});
```

```ts
describe("getLlm reachability fallback", () => {
  beforeEach(() => {
    routerControl.routerReachable.mockReset();
  });

  test("LLM_BASE_URL set and reachable: still returns a compat client (unchanged behavior)", async () => {
    setSecret("ANTHROPIC_API_KEY", "sk-ant-test");
    process.env.LLM_BASE_URL = "http://localhost:20128";
    routerControl.routerReachable.mockResolvedValue(true);

    await getLlm();

    expect(routerControl.routerReachable).toHaveBeenCalled();
  });

  test("LLM_BASE_URL set but unreachable: falls back to a direct client instead of throwing or hanging", async () => {
    setSecret("ANTHROPIC_API_KEY", "sk-ant-test");
    process.env.LLM_BASE_URL = "http://localhost:20128";
    routerControl.routerReachable.mockResolvedValue(false);

    const client = await getLlm();

    expect(client).toBeDefined();
    // isCompatMode() itself stays presence-only, unchanged (ACTION-12) — this asserts
    // only that getLlm() no longer hands back a client pointed at a dead proxy.
    expect(isCompatMode()).toBe(true);
  });

  test("LLM_BASE_URL unset: never calls routerReachable at all", async () => {
    setSecret("ANTHROPIC_API_KEY", "sk-ant-test");
    delete process.env.LLM_BASE_URL;

    await getLlm();

    expect(routerControl.routerReachable).not.toHaveBeenCalled();
  });

  test("no key configured: still throws NoApiKeyError before any reachability check", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LLM_BASE_URL = "http://localhost:20128";

    await expect(getLlm()).rejects.toThrow(NoApiKeyError);
    expect(routerControl.routerReachable).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/llm/client.test.ts`
Expected: FAIL — `getLlm()` today never imports or calls `routerReachable`, so the mock's call count assertions fail, and `getLlm()` returning a plain (non-Promise) value makes `await getLlm()` resolve trivially without exercising any new branch — the "unreachable" test's `routerReachable` mock is simply never invoked.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/llm/client.ts — add the import:
import { routerReachable } from "./router-control";
```

```ts
// Replace getLlm():
/**
 * Lazy singleton — throws `NoApiKeyError` if `ANTHROPIC_API_KEY` is unset so callers can
 * surface the keyless-mode Alert instead of crashing. `new Anthropic()` (zero-arg) would
 * read `ANTHROPIC_API_KEY` from `process.env` itself, which never sees a db-only key —
 * the key resolved via `getSecret` (db-first, env fallback) is passed explicitly instead.
 *
 * A valid key should work even when `LLM_BASE_URL` points at a 9router that isn't
 * actually running (03-feature-description.md §6): `isCompatMode()` is presence-only, so
 * it isn't enough on its own to decide the client. `routerReachable()` (already used by
 * Settings' 9router status panel) settles it — reachable: honor the proxy, same as
 * before; unreachable: fall through to the real Anthropic API directly instead of
 * handing back a client pointed at a dead address.
 *
 * ponytail: reachability is checked once per cache lifetime, not per call — if 9router
 * comes back up mid-session after a fallback, calls keep going direct until the next
 * `resetLlmClient()` (a secret save) or process restart. Upgrade path: re-check
 * `routerReachable()` on every call, or invalidate the cache on a timer, if that gap
 * ever matters in practice.
 */
export async function getLlm(): Promise<LlmClient> {
  if (!hasLlmKey()) throw new NoApiKeyError();
  if (!cachedClient) {
    const apiKey = getSecret("ANTHROPIC_API_KEY");
    const baseURL = process.env.LLM_BASE_URL;
    const useCompat = isCompatMode() ? await routerReachable() : false;
    const anthropic = new Anthropic(useCompat && baseURL ? { apiKey, baseURL } : { apiKey });
    cachedClient = useCompat ? new CompatLlmClient(anthropic) : new AnthropicLlmClient(anthropic);
  }
  return cachedClient;
}
```

Update `isCompatMode()`'s doc to note the new, narrower scope of what it decides:

```ts
/**
 * A base-URL override (`LLM_BASE_URL`) means a local OpenAI-compat router is
 * *configured* — see `CompatLlmClient`. Presence-only, deliberately: `getLlm()` also
 * checks `routerReachable()` before deciding which client to actually hand back, so this
 * function alone no longer says whether a given call is routed through the proxy.
 */
export function isCompatMode(): boolean {
  return Boolean(process.env.LLM_BASE_URL);
}
```

Now the six mechanical call-site updates (no other logic changes):

```ts
// src/server/services/analyze.ts:101
const client = opts?.llm ?? (await getLlm());
```

```ts
// src/server/services/ideas.ts:79
const client = opts?.llm ?? (await getLlm());
```

```ts
// src/server/services/remix.ts:322, :374, :430 — same change at all three sites
const client = opts?.llm ?? (await getLlm());
```

```ts
// src/server/actions/settings-actions.ts:98 (inside testAnthropicKeyAction)
const client = llm ?? (await getLlm());
```

```ts
// src/server/llm/generation-probe.ts (inside probeLlmGeneration's try block)
client = llm ?? (await getLlm());
```

- [ ] **Step 4: Fix pre-existing synchronous `getLlm()` assertions in `client.test.ts`**

`getLlm()`'s signature change breaks five existing assertions in this same file that call it as a synchronous throw-or-not-throw — an async function never throws synchronously to its caller (every `throw` inside becomes a rejected Promise instead), so these must become `await`ed resolves/rejects assertions:

```ts
// Before:
test("getLlm throws NoApiKeyError when ANTHROPIC_API_KEY is absent", () => {
  delete process.env.ANTHROPIC_API_KEY;
  expect(() => getLlm()).toThrow(NoApiKeyError);
});

// After:
test("getLlm throws NoApiKeyError when ANTHROPIC_API_KEY is absent", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await expect(getLlm()).rejects.toThrow(NoApiKeyError);
});
```

```ts
// Before:
test("getLlm returns a client without throwing once a key is present (no network call made)", () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-fake";
  expect(() => getLlm()).not.toThrow();
});

// After:
test("getLlm returns a client without throwing once a key is present (no network call made)", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-fake";
  await expect(getLlm()).resolves.toBeDefined();
});
```

```ts
// Before:
test("resetLlmClient nulls the cache so a key change via the store takes effect", () => {
  delete process.env.ANTHROPIC_API_KEY;
  expect(() => getLlm()).toThrow(NoApiKeyError);

  setSecret("ANTHROPIC_API_KEY", "sk-test-db-value");
  expect(() => getLlm()).not.toThrow();

  resetLlmClient();
  process.env.LLM_BASE_URL = "http://localhost:20128";
  expect(() => getLlm()).not.toThrow();
  expect(isCompatMode()).toBe(true);
});

// After:
test("resetLlmClient nulls the cache so a key change via the store takes effect", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await expect(getLlm()).rejects.toThrow(NoApiKeyError);

  setSecret("ANTHROPIC_API_KEY", "sk-test-db-value");
  await expect(getLlm()).resolves.toBeDefined();

  resetLlmClient();
  process.env.LLM_BASE_URL = "http://localhost:20128";
  await expect(getLlm()).resolves.toBeDefined();
  expect(isCompatMode()).toBe(true);
});
```

```ts
// Before:
test("getLlm returns the compat client when LLM_BASE_URL is set (no crash, no network)", () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-fake";
  process.env.LLM_BASE_URL = "http://localhost:20128";
  expect(() => getLlm()).not.toThrow();
});

// After:
test("getLlm returns the compat client when LLM_BASE_URL is set (no crash, no network)", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-fake";
  process.env.LLM_BASE_URL = "http://localhost:20128";
  await expect(getLlm()).resolves.toBeDefined();
});
```

(This last test now exercises the mocked reachability path too, since `LLM_BASE_URL` is set — the `beforeAll`-level default `routerControl.routerReachable.mockResolvedValue(true)` from Step 1 keeps it returning a compat client, unchanged from before this task.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/llm/client.test.ts src/server/services/analyze.test.ts src/server/services/ideas.test.ts src/server/services/remix.test.ts src/server/actions/settings-actions.test.ts src/server/llm/generation-probe.test.ts`
Expected: PASS across all six files — the mechanical `await` additions change no other behavior, so every existing test in the five caller-side files (which already inject `opts.llm`/`llm` fakes, bypassing `getLlm()` entirely) is unaffected; `client.test.ts` passes with Step 4's updated assertions plus Step 1's four new ones.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS — confirms no other file calls `getLlm()` as if it were still synchronous (the grep for `getLlm(` earlier in this plan's research found exactly these six call sites plus `router-control.ts`'s own doc-comment mention, which is prose, not code).

- [ ] **Step 7: Commit**

```bash
git add src/server/llm/client.ts src/server/services/analyze.ts src/server/services/ideas.ts src/server/services/remix.ts src/server/actions/settings-actions.ts src/server/llm/generation-probe.ts src/server/llm/client.test.ts
git commit -m "feat(llm): getLlm() falls back to direct Anthropic when the configured proxy is unreachable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 9: `GenerationBlocked`'s no-key state offers the guided 9router install

**Files:**
- Modify: `src/components/remix/generation-blocked.tsx`

No test: this component has no existing test file and renders static, prop-driven copy — the change is markup and text only.

Cleanup (b): the module doc claims "this app has no mechanism to launch an external process," which was already false when written (`startRouter()` in `src/server/llm/router-control.ts` does exactly that) and is more obviously false now that Task 7/8 make that mechanism part of the AI-works-with-a-key contract. This step corrects the comment and adds the guided-install messaging the "no-key" state is missing.

- [ ] **Step 1: Fix the stale comment and add the guided install to the "no-key" branch**

```tsx
// Before (module doc):
 *  - "proxy-down": a key is configured (routing through the local 9router proxy) but
 *    the most recent attempt(s) in the run log below failed to connect — see
 *    `run-log-view.ts`'s `isProxyLikelyDown`. Fixed outside this app, in a terminal.
 *    There is no button here that "starts" it — this app has no mechanism to launch
 *    an external process, and a button that pretended to is exactly the kind of
 *    fabricated capability the truth pass exists to remove.

// After:
 *  - "proxy-down": a key is configured (routing through the local 9router proxy) but
 *    the most recent attempt(s) in the run log below failed to connect — see
 *    `run-log-view.ts`'s `isProxyLikelyDown`. `src/server/llm/router-control.ts`'s
 *    `startRouter()` can launch 9router from this app (Settings' 9router section uses
 *    it), so the fix belongs there, not here: Settings already has Start/Restart
 *    controls, and this panel stays a link, not a duplicate button, to avoid two
 *    places that can both spawn the same process.
```

```tsx
// Before (the "no-key" branch):
  if (reason === "no-key") {
    return (
      <div className="flex flex-col items-start gap-6 py-16">
        <p className="max-w-[38ch] text-lg text-foreground">{feature} needs a Claude API key.</p>
        <Button variant="secondary" render={<Link href="/settings" />}>
          Add API key in Settings
        </Button>
      </div>
    );
  }

// After:
  if (reason === "no-key") {
    return (
      <div className="flex flex-col items-start gap-6 py-16">
        <p className="max-w-[38ch] text-lg text-foreground">{feature} needs a Claude API key.</p>
        <Button variant="secondary" render={<Link href="/settings" />}>
          Add API key in Settings
        </Button>
        <div className="max-w-[42ch] text-sm text-muted-foreground">
          <p>No key on hand? 9router is a free, keyless alternative — install it once from a terminal:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">npm install -g 9router</pre>
          <p className="mt-2">
            Then start it from{" "}
            <Link href="/settings#router" className="underline underline-offset-2 hover:text-foreground">
              Settings' 9router section
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
```

- [ ] **Step 2: Manually verify with the `browse` skill**

With no `ANTHROPIC_API_KEY` configured, open the Remix studio and confirm the blocked panel (AI-01's scenario) now also shows the `npm install -g 9router` guidance beneath the existing "Add API key in Settings" button, and that the keyless core loop (feed, outliers, channels, Create Prompt export — AI-03) is untouched by this change.

- [ ] **Step 3: Commit**

```bash
git add src/components/remix/generation-blocked.tsx
git commit -m "feat(remix): guide keyless users to install 9router from the no-key blocked panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

### Task 10: Settings' 9router section — `router-*` testids + PATH-aware copy

**Files:**
- Modify: `src/components/settings/router-section.tsx`
- Modify: `src/server/actions/router-actions.ts`

No new test: `router-section.tsx` has no existing test file (UI-only change), and `router-actions.ts`'s only change is a string literal inside an existing, already-tested error path — the existing `getRouterStatusAction`/`startRouterAction` test coverage (if any) is unaffected since no logic changes, only the error message text.

- [ ] **Step 1: Add `id="router"` to the section (for `generation-blocked.tsx`'s Task 9 link) and the three testids**

```tsx
// The section wrapper:
<section id="router" className="flex flex-col gap-3">
```

```tsx
// The status badge line:
<div className="flex items-center gap-2 text-sm" data-testid="router-status-badge">
  <StatusDot tone={view.tone} />
  <span className="font-medium">9router: {view.label}</span>
</div>
```

```tsx
<Button size="sm" variant="outline" data-testid="router-check-button" onClick={() => void handleCheck()} disabled={busy !== null}>
  {busy === "check" ? <Loader2 className="animate-spin" aria-hidden /> : null}
  Check
</Button>
<Button size="sm" variant="secondary" data-testid="router-start-button" onClick={() => void handleStart()} disabled={busy !== null}>
  {busy === "start" ? "Starting…" : "Start"}
</Button>
```

- [ ] **Step 2: Mention PATH resolution in the start-failure copy (matches Task 7)**

```ts
// src/server/actions/router-actions.ts, inside startRouterAction:
// Before:
  return {
    ok: false,
    error: "9router did not start (check the binary path — ROUTER_BIN if overridden, otherwise /opt/homebrew/bin/9router — and $HOME/.crowsnest/9router.log)",
  };

// After:
  return {
    ok: false,
    error:
      "9router did not start (checked ROUTER_BIN if set, then PATH, then /opt/homebrew/bin/9router — if you haven't installed it yet, run `npm install -g 9router`; also check $HOME/.crowsnest/9router.log)",
  };
```

- [ ] **Step 3: Manually verify with the `browse` skill**

With the `9router` binary installed but not running, open `/settings`, click `router-start-button`, then `router-check-button`, and confirm `router-status-badge` reads "Up" (E2E-05's setup and assertions).

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/router-section.tsx src/server/actions/router-actions.ts
git commit -m "feat(settings): router-* testids and PATH-aware 9router start-failure copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RFY9MaeGmL1iPPEoeCuBHp"
```

---

## Sweeps

### 1. Cross-module reuse sweep

Every file/component `01-concept-brief.md`, `02-architecture.md`, and `03-feature-description.md` name in their Limitations/business-rules sections, checked against the task list above:

| File / surface | Named in | Covered by | Note |
| --- | --- | --- | --- |
| `src/cli/service-darwin.ts` (`services()`, `com.crowsnest.ig` `env: {}`) | 01 §"why it exists" open item; 02 §1, §7, §9, §10 | Task 1 | |
| `src/server/sidecar/control.ts` (`childEnv()`) | 02 §1, §7 | Read only, unmodified — Task 1 ports its shape, does not touch this file | Deliberate: `childEnv()`'s dev/`uv run` path already works; only the launchd path was broken. |
| `src/server/secrets/store.ts` (`getSecret`, `setSecret`, `getOrCreateServiceToken`, `MANAGED_SECRETS`) | 02 §1, §2, §4 | Consumed unmodified by Tasks 1, 3, 4, 5 | No schema/behavior change — reuse only. |
| `src/server/actions/secrets-actions.ts` (`setSecretAction`, `getSecretStatusAction`) | 02 §1 | Consumed unmodified by Tasks 2, 4, 5 | |
| `src/components/settings/secrets-section.tsx` | 02 §1; 03 §5 | Task 2 | Copy fix (cleanup c) + testids. |
| `src/server/llm/client.ts` (`getLlm`, `isCompatMode`, `hasLlmKey`) | 01, 02 §1, §8, §9; 03 §6 | Task 8 | |
| `src/server/llm/router-control.ts` (`routerReachable`, `startRouter`, `routerBin`) | 02 §1; 03 §6 | Tasks 7, 8 | |
| `src/server/actions/router-actions.ts` | 02 §1 | Task 10 | |
| `src/components/settings/router-section.tsx` | 02 §1; 03 §6 | Task 10 | |
| `src/components/status/dependency-status.ts` (`classifyLlmStatus`, `classifySidecarStatus`) | 02 §1 | Deliberately out of scope — see Risks | `routedThroughProxy` stays presence-derived; not part of traps 1/2. |
| `src/server/llm/generation-probe.ts` (`probeLlmGeneration`) | (uses `getLlm`) | Task 8 (mechanical `await` only) | |
| `src/components/remix/generation-blocked.tsx` | 02 §1 | Task 9 | Cleanup (b) + guided install. |
| `src/server/actions/ig-actions.ts` (`igLoginAction`, `igLoginBySessionAction`, `getIgStatusAction`) | 02 §1; 03 §5 | Task 3 (new action added; existing ones read, one doc-only edit, no behavior change) | |
| `src/components/settings/instagram-section.tsx` | 02 §1; 03 §5 | Task 4 | |
| `src/components/first-run/connect-step.tsx` | 02 §1; 03 §2, §5 | Task 5 | |
| `services/ig/crowsnest_ig/config.py`, `app.py`, `session.py` | 01, 02 §1, §7, §9 | Read for ground truth only, not modified | Deliberate: the sidecar's `/login` already accepts credentials directly; no Python change needed for Feature A. |
| `.env.example` (`LLM_BASE_URL` pre-filled) | 01, 02 §4, §9; 03 §6 | Deliberately out of scope | Removing the pre-filled default was considered and rejected: it would silently change behavior for every existing install with 9router actually running; Task 8's reachability check achieves the same outcome (a valid key works either way) without touching this file. Noted in Risks. |
| `src/cli/kai.ts` (`ask`, `setEnv`, `cmdKitInit`) | 01, 02 §1, §9, §10 (ONB-1/ONB-2) | Deliberately out of scope | Both defects are already fixed per `05-backlog-to-enhance.md`; Task 6 only corrects the stale doc describing them as live. No code change needed or made. |

No named file/component from 01/02/03's Limitations or business-rules sections is missing a task or an explicit out-of-scope note above.

### 2. Sidecar/env/migration/launchd surface sweep

| Surface | Touched? | Task | Note |
| --- | --- | --- | --- |
| `.env.local` keys | No new keys added or renamed | — | Task 1 reads existing `IG_USERNAME`/`IG_PASSWORD`/`IG_SERVICE_TOKEN`/`IG_PROXY`/`IG_DEVICE_SEED`/`CROWSNEST_DB_PATH` through the existing secrets store and `.env.local` parsing; Task 7/8 read existing `LLM_BASE_URL`/`ROUTER_BIN`. |
| Drizzle schema / a migration | No | — | `secrets` table (`src/server/db/schema.ts`) already has every row this plan needs (`IG_USERNAME`, `IG_PASSWORD`, `ANTHROPIC_API_KEY`, etc. are already in `MANAGED_SECRETS`). No new table, no new column. |
| launchd services | Yes | Task 1 | `com.crowsnest.ig`'s `EnvironmentVariables` dict changes from always-`{}` to populated-when-set. `com.crowsnest.server`'s entry is unchanged (Task 1's test asserts this explicitly). |
| Sidecar contract (`services/ig/crowsnest_ig/*.py`) | No | — | Confirmed by reading `app.py`, `session.py`, `models.py`, `config.py`: `/login` already accepts `{username, password}` in its request body independent of `.env.local`; nothing about the wire contract needs to change for Feature A. |

## Risks

- **The `com.crowsnest.server` launchd/packaging surface is exactly what Task 1 touches.** Before landing, run a fresh-HOME Kit smoke (the packaging-ops doc's standard check: a clean `~/.kai` install through `kai kit init` → `kai start`) to confirm `pinDbPathEnv()` resolves the same absolute db path the Next server itself uses, and that `com.crowsnest.ig`'s plist actually carries the injected `EnvironmentVariables` (`launchctl print gui/<uid>/com.crowsnest.ig` after `kai start`). A wrong path here would make Task 1 a silent no-op — `getSecret` would just return nothing from an empty or wrong database — without any test catching it, since the vitest suite uses `:memory:` and never exercises the real launchd plist end to end.
- **Two credential sources of truth remain: the secrets store (db) and `.env.local`.** Task 1 makes the secrets store win for the launchd path when a value exists there (matching `childEnv()`'s existing db-first precedent), and falls through to `.env.local` (via the sidecar's own `load_env_file()`) only when the secrets store has nothing. A buyer who edits `.env.local` by hand *after* also saving a value through the dashboard will see the dashboard's value win on the sidecar's next restart, which may be surprising if undocumented elsewhere — this plan does not add a runtime warning for that specific drift beyond Task 2's corrected copy ("takes effect... on the sidecar's next restart").
- **`getLlm()`'s reachability fallback caches its routing decision for the lifetime of the client cache**, not per call (documented inline with a `ponytail:` comment in Task 8). If 9router is down at the first call after a restart (falls back to direct) and later comes back up, calls keep going direct until the next secret save or process restart. This does not violate any test case in `04-test-cases.md` — AI-08's setup is "9router installed and running" from the start, which never triggers the fallback at all — but is worth naming as a known ceiling.
- **`dependency-status.ts`'s `routedThroughProxy` field stays presence-derived (`isCompatMode()`), not decision-derived.** After Task 8, `getLlm()` can silently route direct even when the dashboard's dependency panel still reports `routedThroughProxy: true` (because `LLM_BASE_URL` is set). This is a deliberate scope boundary — traps 1 and 2 name `getLlm()`/`isCompatMode()`/`routerBin()`, not a rewrite of `classifyLlmStatus`'s whole contract, which has its own passing test suite (`ACTION-10`, `ACTION-11`) this plan does not touch. A future pass could pass the real per-call routing decision through instead of re-deriving it from presence alone.
- **Every `data-testid` added in this plan is new** (`secrets-*`, `ig-session-*`, `ig-credentials-*`, `router-*`, plus `id="router"`) — none existed before, so nothing here can regress an existing `browse-e2e` script, but every browse-e2e verification step in Tasks 2/4/5/10 is a first run, not a re-run of a previously-green case; treat those manual steps as required, not optional.
- **`igLoginWithCredentialsAction` (Task 3) is a new, deliberate exception to `ig-actions.ts`'s "no action ever accepts a password" rule.** It is rate-limited only by reusing the sidecar's own `/login` cooldown (`IG_RATE_LIMITED`) — no separate throttling is added in this plan, matching `04-test-cases.md`'s `SEC-07`.

## Migrations or breaking changes

None. No schema change, no renamed config key, no removed export. `getLlm()`'s signature change (sync → async) is the one call-visible break, fully covered: this plan updates every call site in the repo (verified by grep) in Task 8's own commit.
