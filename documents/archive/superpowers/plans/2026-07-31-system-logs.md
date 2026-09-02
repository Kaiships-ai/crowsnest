# System logs implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist backend, frontend, and sidecar log events to sqlite and read them at a new `/logs` route that defaults to problems only.

**Architecture:** A new `log_events` table plus a `src/server/logs/store.ts` module (insert, prune, query). The existing backend logger inserts rows on info/warn/error. A `POST /api/logs/ingest` endpoint takes events from the browser and the Python sidecar, re-redacts, and inserts. The sidecar posts each event over httpx with the existing shared secret. The viewer is a server component that queries the store.

**Tech Stack:** Next.js (nodejs runtime routes), drizzle-orm + better-sqlite3, zod, vitest, React, Python (FastAPI sidecar with httpx), lucide-react icons.

## Global constraints

- This is NOT the Next.js in training data. Read the relevant guide under `node_modules/next/dist/docs/` before writing route or server-action code.
- Prose in any `.md`/`.txt` file must have no em dashes, en dashes, or curly quotes. Two hooks enforce it. Applies to prose, not code.
- Never persist a credential. Redaction runs at every insert point.
- Stored levels are info, warn, error only. debug is stdout only, never inserted.
- Retention cap is 50000 rows, pruned oldest first.
- Shared secret is `IG_SERVICE_TOKEN`, sent as header `X-IG-Token`, compared constant time (the sidecar already does this for the reverse direction).
- Run the full suite with `npx vitest run`. Run one file with `npx vitest run <path>`.

---

### Task 1: log_events table, store module, retention

**Files:**
- Modify: `src/server/db/schema.ts` (add the `logEvents` table)
- Create: `src/server/logs/store.ts`
- Create: `src/server/logs/store.test.ts`
- Generate: a new drizzle migration under `drizzle/` (via `npm run db:generate`)

**Interfaces:**
- Consumes: `db` from `@/server/db`, `sqliteTable/text/integer/index` from drizzle.
- Produces:
  - `type StoredLogLevel = "info" | "warn" | "error"`
  - `type LogSource = "backend" | "frontend" | "sidecar"`
  - `interface LogEventInput { ts: string; level: StoredLogLevel; source: LogSource; event: string; fields: Record<string, unknown> }`
  - `interface LogEventRow extends LogEventInput { id: number }`
  - `interface LogQueryFilter { levels?: StoredLogLevel[]; source?: LogSource; event?: string; since?: string; until?: string; search?: string; limit?: number }`
  - `function insertLogEvent(input: LogEventInput): void` (redacts, inserts, prunes)
  - `function queryLogEvents(filter?: LogQueryFilter): LogEventRow[]`
  - `const RETENTION_MAX = 50000`
  - `function redactLogFields(fields: Record<string, unknown>): Record<string, unknown>` (re-exported from logger, see Task 2; for Task 1 define it locally then Task 2 makes it the shared source. To avoid a forward dependency, Task 1 defines `redactLogFields` inside store.ts and Task 2 imports it into logger.)

- [ ] **Step 1: Add the table to schema.ts**

Append to `src/server/db/schema.ts`:

```ts
export const logEvents = sqliteTable(
  "log_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: text("ts").notNull(),
    level: text("level").notNull(), // "info" | "warn" | "error"
    source: text("source").notNull(), // "backend" | "frontend" | "sidecar"
    event: text("event").notNull(),
    fields: text("fields").notNull(), // JSON string, already redacted
  },
  (t) => ({
    byLevel: index("log_events_level_id").on(t.level, t.id),
    bySource: index("log_events_source_id").on(t.source, t.id),
  }),
);
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0009_*.sql` creating `log_events` and its two indexes. Commit it with the task.

- [ ] **Step 3: Write the failing store test**

Create `src/server/logs/store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { migrate } from "@/server/db/test-migrate";
import { insertLogEvent, queryLogEvents, redactLogFields, RETENTION_MAX } from "./store";

function make(overrides: Partial<Parameters<typeof insertLogEvent>[0]> = {}) {
  return {
    ts: "2026-07-31T10:00:00.000Z",
    level: "error" as const,
    source: "backend" as const,
    event: "sync.failed",
    fields: { jobId: "j1" },
    ...overrides,
  };
}

describe("log store", () => {
  beforeEach(() => migrate());

  test("insert then query returns the row with parsed fields", () => {
    insertLogEvent(make());
    const rows = queryLogEvents({ levels: ["error"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("sync.failed");
    expect(rows[0].fields).toEqual({ jobId: "j1" });
  });

  test("problems-only default excludes info", () => {
    insertLogEvent(make({ level: "info", event: "sync.started" }));
    insertLogEvent(make({ level: "error", event: "sync.failed" }));
    const rows = queryLogEvents();
    expect(rows.map((r) => r.event)).toEqual(["sync.failed"]);
  });

  test("source filter", () => {
    insertLogEvent(make({ source: "backend" }));
    insertLogEvent(make({ source: "sidecar" }));
    expect(queryLogEvents({ levels: ["error"], source: "sidecar" })).toHaveLength(1);
  });

  test("free text search matches event and fields", () => {
    insertLogEvent(make({ event: "ig.session.expired", fields: { handle: "@kai" } }));
    expect(queryLogEvents({ levels: ["error"], search: "kai" })).toHaveLength(1);
    expect(queryLogEvents({ levels: ["error"], search: "expired" })).toHaveLength(1);
    expect(queryLogEvents({ levels: ["error"], search: "nope" })).toHaveLength(0);
  });

  test("redactLogFields masks a password", () => {
    expect(redactLogFields({ password: "hunter2", ok: 1 })).toEqual({ password_redacted: true, ok: 1 });
  });

  test("insert redacts before storing", () => {
    insertLogEvent(make({ fields: { token: "abc", jobId: "j1" } }));
    expect(queryLogEvents({ levels: ["error"] })[0].fields).toEqual({ token_redacted: true, jobId: "j1" });
  });

  test("retention keeps the newest RETENTION_MAX rows", () => {
    for (let i = 0; i < RETENTION_MAX + 5; i++) {
      insertLogEvent(make({ level: "info", event: `e${i}` }));
    }
    const rows = queryLogEvents({ levels: ["info"], limit: RETENTION_MAX + 100 });
    expect(rows.length).toBe(RETENTION_MAX);
    // newest first, so e{max+4} present, e0..e4 pruned
    expect(rows[0].event).toBe(`e${RETENTION_MAX + 4}`);
    expect(rows.some((r) => r.event === "e0")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run src/server/logs/store.test.ts`
Expected: FAIL, cannot import from `./store`.

- [ ] **Step 5: Write store.ts**

Create `src/server/logs/store.ts`:

```ts
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { logEvents } from "@/server/db/schema";

export type StoredLogLevel = "info" | "warn" | "error";
export type LogSource = "backend" | "frontend" | "sidecar";

export interface LogEventInput {
  ts: string;
  level: StoredLogLevel;
  source: LogSource;
  event: string;
  fields: Record<string, unknown>;
}
export interface LogEventRow extends LogEventInput {
  id: number;
}
export interface LogQueryFilter {
  levels?: StoredLogLevel[];
  source?: LogSource;
  event?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
}

export const RETENTION_MAX = 50000;
const DEFAULT_LIMIT = 200;

/** Same rule as the stdout logger: a key in this set is never stored as a value. */
const REDACT_KEYS = new Set([
  "password", "ig_password", "igPassword", "token", "igServiceToken",
  "authorization", "cookie", "settings", "sessionid", "service_token",
]);

export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.has(k)) out[`${k}_redacted`] = true;
    else out[k] = v;
  }
  return out;
}

export function insertLogEvent(input: LogEventInput): void {
  const clean = redactLogFields(input.fields ?? {});
  db.insert(logEvents)
    .values({ ts: input.ts, level: input.level, source: input.source, event: input.event, fields: JSON.stringify(clean) })
    .run();
  // Monotonic autoincrement id means MAX(id) - RETENTION_MAX is the cutoff; the
  // kept window has no gaps, so this leaves exactly the newest RETENTION_MAX rows.
  db.run(sql`delete from log_events where id <= (select max(id) - ${RETENTION_MAX} from log_events)`);
}

export function queryLogEvents(filter: LogQueryFilter = {}): LogEventRow[] {
  const levels = filter.levels ?? ["warn", "error"];
  const conds = [inArray(logEvents.level, levels)];
  if (filter.source) conds.push(eq(logEvents.source, filter.source));
  if (filter.event) conds.push(like(logEvents.event, `${filter.event}%`));
  if (filter.since) conds.push(gte(logEvents.ts, filter.since));
  if (filter.until) conds.push(lte(logEvents.ts, filter.until));
  if (filter.search) {
    const needle = `%${filter.search}%`;
    conds.push(or(like(logEvents.event, needle), like(logEvents.fields, needle))!);
  }
  const rows = db
    .select()
    .from(logEvents)
    .where(and(...conds))
    .orderBy(desc(logEvents.id))
    .limit(filter.limit ?? DEFAULT_LIMIT)
    .all();
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    level: r.level as StoredLogLevel,
    source: r.source as LogSource,
    event: r.event,
    fields: safeParse(r.fields),
  }));
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run src/server/logs/store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts src/server/logs/store.ts src/server/logs/store.test.ts drizzle/
git commit -m "feat(logs): log_events table, store, and 50k retention"
```

---

### Task 2: backend logger writes rows

**Files:**
- Modify: `src/server/lib/logger.ts`
- Create: `src/server/lib/logger.test.ts` (if none exists; otherwise extend it)

**Interfaces:**
- Consumes: `insertLogEvent`, `redactLogFields` from `@/server/logs/store` (Task 1).
- Produces: no new export. `log.info/warn/error` now also insert a row; `log.debug` does not.

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/logger.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { migrate } from "@/server/db/test-migrate";
import { queryLogEvents } from "@/server/logs/store";
import { log } from "./logger";

describe("logger db sink", () => {
  beforeEach(() => migrate());

  test("error is written as a row", () => {
    log.error("sync.failed", { jobId: "j9" });
    const rows = queryLogEvents({ levels: ["error"] });
    expect(rows.some((r) => r.event === "sync.failed" && r.source === "backend")).toBe(true);
  });

  test("debug is not written", () => {
    log.debug("noise", { a: 1 });
    expect(queryLogEvents({ levels: ["info", "warn", "error"], limit: 1000 })).toHaveLength(0);
  });

  test("a db failure does not throw out of log.error", () => {
    const spy = vi.spyOn(await import("@/server/logs/store"), "insertLogEvent").mockImplementation(() => {
      throw new Error("db down");
    });
    expect(() => log.error("still.fine", {})).not.toThrow();
    spy.mockRestore();
  });
});
```

Note: if the top-level `await import` in the third test is awkward under the file's config, replace it with a static `import * as store from "@/server/logs/store"` at the top and `vi.spyOn(store, "insertLogEvent")`.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/server/lib/logger.test.ts`
Expected: FAIL, rows not written.

- [ ] **Step 3: Wire the sink into emit()**

In `src/server/lib/logger.ts`, add an import at the top:

```ts
import { insertLogEvent } from "@/server/logs/store";
```

Then in `emit()`, after the stdout/stderr write, add the db sink for non-debug levels:

```ts
function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);

  if (level !== "debug") {
    try {
      insertLogEvent({ ts: new Date().toISOString(), level, source: "backend", event, fields });
    } catch {
      // A logging sink must never break the caller. The line is already on stdout.
    }
  }
}
```

Note: `insertLogEvent` redacts internally, so pass the raw `fields`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/server/lib/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard against an import cycle**

`logger.ts` now imports `store.ts`, which imports `db`. Run the whole suite to confirm nothing that `db` imports also imports `logger` at module load in a way that cycles.

Run: `npx vitest run`
Expected: still 960+ passing, no "cannot access before initialization" error.

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/logger.ts src/server/lib/logger.test.ts
git commit -m "feat(logs): backend logger persists info/warn/error rows"
```

---

### Task 3: ingest endpoint

**Files:**
- Create: `src/app/api/logs/ingest/route.ts`
- Create: `src/app/api/logs/ingest/route.test.ts`

**Interfaces:**
- Consumes: `insertLogEvent` from `@/server/logs/store`, `serverConfig` (or however `IG_SERVICE_TOKEN` is read) from `@/server/config`.
- Produces: `POST /api/logs/ingest`. Body: `{ ts, level, source, event, fields }`. Returns 204 on success, 400 on bad shape, 401 when a `sidecar` post has a bad `X-IG-Token`.

- [ ] **Step 1: Read the token accessor**

Open `src/server/config.ts` and confirm how `IG_SERVICE_TOKEN` is exposed (a `serverConfig.igServiceToken` field or similar). Use that accessor in the route rather than reading `process.env` directly.

- [ ] **Step 2: Write the failing test**

Create `src/app/api/logs/ingest/route.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { migrate } from "@/server/db/test-migrate";
import { queryLogEvents } from "@/server/logs/store";
import { POST } from "./route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/logs/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const base = { ts: "2026-07-31T10:00:00.000Z", level: "error", event: "e", fields: {} };

describe("POST /api/logs/ingest", () => {
  beforeEach(() => migrate());

  test("frontend post needs no token and is stored", async () => {
    const res = await POST(req({ ...base, source: "frontend" }));
    expect(res.status).toBe(204);
    expect(queryLogEvents({ levels: ["error"], source: "frontend" })).toHaveLength(1);
  });

  test("sidecar post without a valid token is 401 and not stored", async () => {
    const res = await POST(req({ ...base, source: "sidecar" }, { "x-ig-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(queryLogEvents({ levels: ["error"], source: "sidecar" })).toHaveLength(0);
  });

  test("malformed body is 400", async () => {
    const res = await POST(req({ level: "error" }));
    expect(res.status).toBe(400);
  });

  test("payload with a password is redacted before storage", async () => {
    await POST(req({ ...base, source: "frontend", fields: { password: "hunter2", ok: 1 } }));
    expect(queryLogEvents({ levels: ["error"], source: "frontend" })[0].fields).toEqual({ password_redacted: true, ok: 1 });
  });
});
```

For the sidecar-with-valid-token happy path, add a test that reads the real token from config and sends it, asserting 204. Copy the token accessor found in Step 1.

- [ ] **Step 3: Run it, verify it fails**

Run: `npx vitest run src/app/api/logs/ingest/route.test.ts`
Expected: FAIL, no `./route`.

- [ ] **Step 4: Write the route**

Create `src/app/api/logs/ingest/route.ts` (adjust the config import to match Step 1):

```ts
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { serverConfig } from "@/server/config";
import { insertLogEvent } from "@/server/logs/store";

export const runtime = "nodejs";

const Body = z.object({
  ts: z.string().min(1),
  level: z.enum(["info", "warn", "error"]),
  source: z.enum(["backend", "frontend", "sidecar"]),
  event: z.string().min(1),
  fields: z.record(z.unknown()).default({}),
});

function tokenOk(header: string | null): boolean {
  const expected = serverConfig.igServiceToken;
  if (!header || !expected) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  const evt = parsed.data;
  if (evt.source === "sidecar" && !tokenOk(request.headers.get("x-ig-token"))) {
    return new Response(null, { status: 401 });
  }

  // insertLogEvent redacts; the browser and sidecar are not trusted to have done so.
  insertLogEvent({ ts: evt.ts, level: evt.level, source: evt.source, event: evt.event, fields: evt.fields });
  return new Response(null, { status: 204 });
}
```

If `serverConfig.igServiceToken` is not the real accessor, replace it with the one found in Step 1.

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/app/api/logs/ingest/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/logs/ingest/
git commit -m "feat(logs): POST /api/logs/ingest with token gate and redaction"
```

---

### Task 4: sidecar pushes events

**Files:**
- Modify: `services/ig/crowsnest_ig/logging.py`
- Modify: `services/ig/crowsnest_ig/config.py` (add the ingest URL, if not derivable)
- Create or modify: `services/ig/tests/test_logging_forward.py`

**Interfaces:**
- Consumes: `IG_SERVICE_TOKEN` (already in config), a new `CROWSNEST_INGEST_URL` env var defaulting to `http://127.0.0.1:3000/api/logs/ingest`.
- Produces: every `log_event(...)` call also fires an httpx POST to the ingest URL, fire and forget, never raising.

- [ ] **Step 1: Confirm the sidecar test runner**

Look under `services/ig/` for how Python tests run (a `pytest` config, a `Makefile`, or a `pyproject.toml` test section). Use that command in later steps. If none exists, run `cd services/ig && python -m pytest`.

- [ ] **Step 2: Write the failing test**

Create `services/ig/tests/test_logging_forward.py`:

```python
import logging
from unittest.mock import patch

from crowsnest_ig import logging as clog


def test_forward_posts_event(monkeypatch):
    monkeypatch.setenv("CROWSNEST_INGEST_URL", "http://test/api/logs/ingest")
    monkeypatch.setenv("IG_SERVICE_TOKEN", "secret")
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append((url, json, headers))

        class R:
            status_code = 204

        return R()

    with patch("crowsnest_ig.logging.httpx.post", side_effect=fake_post):
        clog.log_event("session.invalidated", level=logging.ERROR, handle="@kai")

    assert len(calls) == 1
    url, body, headers = calls[0]
    assert url == "http://test/api/logs/ingest"
    assert body["event"] == "session.invalidated"
    assert body["level"] == "error"
    assert body["source"] == "sidecar"
    assert headers["X-IG-Token"] == "secret"


def test_forward_swallows_errors(monkeypatch):
    monkeypatch.setenv("CROWSNEST_INGEST_URL", "http://test/api/logs/ingest")
    monkeypatch.setenv("IG_SERVICE_TOKEN", "secret")

    def boom(*a, **k):
        raise RuntimeError("next is down")

    with patch("crowsnest_ig.logging.httpx.post", side_effect=boom):
        # must not raise
        clog.log_event("session.recovered", level=logging.INFO)
```

- [ ] **Step 3: Run it, verify it fails**

Run: (the command from Step 1, targeting the new file), e.g. `cd services/ig && python -m pytest tests/test_logging_forward.py -v`
Expected: FAIL, no forwarding happens.

- [ ] **Step 4: Add forwarding to log_event**

In `services/ig/crowsnest_ig/logging.py`, add near the top:

```python
import os

import httpx

_LEVEL_NAME = {logging.INFO: "info", logging.WARNING: "warn", logging.ERROR: "error"}


def _forward(event: str, level: int, fields: dict) -> None:
    """POST one event to the Next ingest endpoint. Fire and forget: any failure
    is swallowed because the line is already on stdout and logging must never
    break the caller."""
    url = os.environ.get("CROWSNEST_INGEST_URL", "http://127.0.0.1:3000/api/logs/ingest")
    token = os.environ.get("IG_SERVICE_TOKEN", "")
    body = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z",
        "level": _LEVEL_NAME.get(level, "info"),
        "source": "sidecar",
        "event": event,
        "fields": _redact(fields),
    }
    try:
        httpx.post(url, json=body, headers={"X-IG-Token": token}, timeout=1.0)
    except Exception:
        pass
```

Then at the end of `log_event`, after the existing `logger.log(...)` line, call it:

```python
def log_event(event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Emit one structured event line."""
    logger = configure()
    logger.log(level, event, extra={"event": event, "fields": fields})
    _forward(event, level, fields)
```

`_redact` already exists in this module, so the sidecar redacts before sending and the Next endpoint redacts again.

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd services/ig && python -m pytest tests/test_logging_forward.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/ig/crowsnest_ig/logging.py services/ig/tests/test_logging_forward.py
git commit -m "feat(logs): sidecar forwards events to the ingest endpoint"
```

---

### Task 5: frontend captures unhandled errors

**Files:**
- Create: `src/components/logs/client-error-reporter.tsx`
- Modify: `src/app/(shell)/layout.tsx` (mount the reporter once)
- Create: `src/components/logs/client-error-reporter.test.tsx`

**Interfaces:**
- Consumes: `POST /api/logs/ingest`.
- Produces: a client component `ClientErrorReporter` that registers `window.onerror` and an `unhandledrejection` listener, each POSTing a `frontend` event.

- [ ] **Step 1: Write the failing test**

Create `src/components/logs/client-error-reporter.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ClientErrorReporter } from "./client-error-reporter";

afterEach(() => vi.restoreAllMocks());

describe("ClientErrorReporter", () => {
  test("posts a frontend event on an unhandled rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorReporter />);

    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.reject(new Error("boom")).catch(() => {}) as Promise<unknown>,
      reason: new Error("boom"),
    }));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("/api/logs/ingest", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.source).toBe("frontend");
    expect(body.level).toBe("error");
    expect(body.event).toBe("client.unhandledrejection");
  });
});
```

Note: confirm `@testing-library/react` and a jsdom environment are already used by other `.test.tsx` files. If the repo uses a different render helper or environment directive (for example a `// @vitest-environment jsdom` comment), copy that from a neighboring component test.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/components/logs/client-error-reporter.test.tsx`
Expected: FAIL, no `./client-error-reporter`.

- [ ] **Step 3: Write the component**

Create `src/components/logs/client-error-reporter.tsx`:

```tsx
"use client";

import { useEffect } from "react";

function post(event: string, fields: Record<string, unknown>): void {
  void fetch("/api/logs/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      source: "frontend",
      event,
      fields,
    }),
  }).catch(() => {
    // Reporting an error must not itself throw.
  });
}

/** Registers global handlers that report unhandled client errors to /api/logs/ingest.
 *  Mount once, high in the shell tree. Renders nothing. */
export function ClientErrorReporter(): null {
  useEffect(() => {
    const onError = (e: ErrorEvent) => post("client.error", { message: e.message, source: e.filename, line: e.lineno });
    const onRejection = (e: PromiseRejectionEvent) =>
      post("client.unhandledrejection", { message: String((e.reason as Error)?.message ?? e.reason) });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
```

- [ ] **Step 4: Mount it in the shell layout**

In `src/app/(shell)/layout.tsx`, import and render `<ClientErrorReporter />` once inside the layout's returned tree (it renders nothing, so placement is not visual).

```tsx
import { ClientErrorReporter } from "@/components/logs/client-error-reporter";
// ...inside the returned JSX, near the top of the shell:
<ClientErrorReporter />
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/components/logs/client-error-reporter.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/logs/ src/app/\(shell\)/layout.tsx
git commit -m "feat(logs): report unhandled client errors to the ingest endpoint"
```

---

### Task 6: the /logs viewer

**Files:**
- Create: `src/app/(shell)/logs/page.tsx`
- Create: `src/components/logs/logs-view.tsx` (client: filters, toggle, inline expand, refresh)
- Modify: `src/components/layout/nav-items.ts` (add the Logs nav item)
- Create: `src/components/logs/logs-view.test.tsx`

**Interfaces:**
- Consumes: `queryLogEvents`, `LogEventRow`, `LogQueryFilter` from `@/server/logs/store`.
- Produces: the `/logs` route. `LogsView` takes `{ rows: LogEventRow[]; filter: LogQueryFilter }` and renders the table and controls.

- [ ] **Step 1: Add the nav item**

In `src/components/layout/nav-items.ts`, add `ScrollText` to the lucide import and insert before Settings:

```ts
{ href: "/logs", label: "Logs", icon: ScrollText, group: "System" },
```

- [ ] **Step 2: Write the failing view test**

Create `src/components/logs/logs-view.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LogsView } from "./logs-view";
import type { LogEventRow } from "@/server/logs/store";

const rows: LogEventRow[] = [
  { id: 2, ts: "2026-07-31T10:00:00.000Z", level: "error", source: "sidecar", event: "session.invalidated", fields: { handle: "@kai" } },
  { id: 1, ts: "2026-07-31T09:00:00.000Z", level: "warn", source: "backend", event: "ratelimit.backoff", fields: {} },
];

describe("LogsView", () => {
  test("renders one row per event with its source", () => {
    render(<LogsView rows={rows} filter={{ levels: ["warn", "error"] }} />);
    expect(screen.getByText("session.invalidated")).toBeInTheDocument();
    expect(screen.getByText("ratelimit.backoff")).toBeInTheDocument();
    expect(screen.getByText("sidecar")).toBeInTheDocument();
  });

  test("shows an empty state when there are no rows", () => {
    render(<LogsView rows={[]} filter={{ levels: ["warn", "error"] }} />);
    expect(screen.getByText(/no log events/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx vitest run src/components/logs/logs-view.test.tsx`
Expected: FAIL, no `./logs-view`.

- [ ] **Step 4: Write the view component**

Create `src/components/logs/logs-view.tsx`. Follow the repo's existing table and control styling (copy classes from a neighboring list screen such as the feed or channels list). Minimum behavior:

```tsx
"use client";

import { useState } from "react";
import type { LogEventRow, LogQueryFilter } from "@/server/logs/store";

export function LogsView({ rows, filter }: { rows: LogEventRow[]; filter: LogQueryFilter }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No log events match this filter.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="text-left">Time</th>
          <th className="text-left">Level</th>
          <th className="text-left">Source</th>
          <th className="text-left">Event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
            <td>{r.ts}</td>
            <td>{r.level}</td>
            <td>{r.source}</td>
            <td>
              {r.event}
              {openId === r.id && <pre className="mt-1 text-xs">{JSON.stringify(r.fields, null, 2)}</pre>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

The filter controls (level checkboxes, the "show everything" toggle, source select, event input, time range, free-text, and a Refresh button) drive the URL search params. Wire them as a small form that navigates to `/logs?levels=...&source=...&search=...`. The page reads those params. Keep the controls in this component using `useRouter`/`useSearchParams` from `next/navigation`, following how the feed screen already reads filters from the URL (check `src/app/(shell)/feed/page.tsx` for the pattern before writing this).

- [ ] **Step 5: Write the page**

Create `src/app/(shell)/logs/page.tsx`:

```tsx
import { LogsView } from "@/components/logs/logs-view";
import { queryLogEvents, type LogQueryFilter, type StoredLogLevel } from "@/server/logs/store";

export const dynamic = "force-dynamic"; // always read the latest rows, never build-time freeze

type SearchParams = Promise<{ levels?: string; source?: string; event?: string; since?: string; until?: string; search?: string }>;

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const levels = sp.levels
    ? (sp.levels.split(",").filter(Boolean) as StoredLogLevel[])
    : (["warn", "error"] as StoredLogLevel[]);
  const filter: LogQueryFilter = {
    levels,
    source: sp.source as LogQueryFilter["source"],
    event: sp.event,
    since: sp.since,
    until: sp.until,
    search: sp.search,
  };
  const rows = queryLogEvents(filter);
  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Logs</h1>
      <LogsView rows={rows} filter={filter} />
    </div>
  );
}
```

Note: this repo's Next may type `searchParams` as a promise (as shown) or a plain object. Check a neighboring page under `src/app/(shell)/` and match its signature exactly.

- [ ] **Step 6: Run the view test, verify it passes**

Run: `npx vitest run src/components/logs/logs-view.test.tsx`
Expected: PASS.

- [ ] **Step 7: Load the page in the browser**

Start the dev server and open `http://localhost:3001/logs` (this repo uses port 3001, and localhost not 127.0.0.1). Confirm the nav item appears, the page renders, the problems-only default is applied, and toggling to show everything and typing a search re-queries. Seed a couple of rows first if the table is empty (for example, trigger a sync so the backend logger writes some).

- [ ] **Step 8: Commit**

```bash
git add src/app/\(shell\)/logs/ src/components/logs/logs-view.tsx src/components/logs/logs-view.test.tsx src/components/layout/nav-items.ts
git commit -m "feat(logs): /logs viewer with filters, problems-only default, and nav item"
```

---

### Task 7: full suite and build gate

**Files:** none new.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all prior tests plus the new ones pass.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build passes, `/logs` shows up as a route.

- [ ] **Step 4: Commit any lint/type fixups**

```bash
git add -A
git commit -m "chore(logs): typecheck and build green for the logs feature"
```

## Self-review notes

- Spec coverage: data model (Task 1), backend capture (Task 2), ingest endpoint (Task 3), sidecar push (Task 4), frontend capture (Task 5), viewer plus nav plus retention default (Task 1 retention, Task 6 viewer). Redaction is in Tasks 1 and 3. debug exclusion is in Task 2. All spec sections map to a task.
- Type consistency: `insertLogEvent`, `queryLogEvents`, `redactLogFields`, `LogEventRow`, `LogQueryFilter`, `StoredLogLevel`, `LogSource`, `RETENTION_MAX` are defined in Task 1 and used unchanged in Tasks 2, 3, and 6.
- Known verification points left to the implementer, called out inline: the exact `IG_SERVICE_TOKEN` accessor in config (Task 3 Step 1), the Python test command (Task 4 Step 1), the component test environment helper (Task 5 Step 1), and the page `searchParams` signature (Task 6 Step 5). Each says where to look before writing.
