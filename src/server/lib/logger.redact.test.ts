import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * ONB-5: `emit()` used to hand `insertLogEvent` the RAW `fields` object while only the
 * stdout/stderr line went through `redact()`. `insertLogEvent` (src/server/logs/store.ts)
 * happens to run its own, separate `redactLogFields` before writing — so nothing has
 * actually leaked in practice — but that is a second implementation the logger must not
 * rely on: this test isolates `logger.ts`'s own contract by mocking `insertLogEvent` and
 * asserting what `emit()` itself passes it is already masked, independent of whatever the
 * store module does with it.
 */
const mocks = vi.hoisted(() => ({ insertLogEvent: vi.fn() }));
vi.mock("@/server/logs/store", () => mocks);
const { insertLogEvent } = mocks;

import { log } from "./logger";

beforeEach(() => {
  insertLogEvent.mockReset();
});

describe("logger redacts before persisting", () => {
  test("a raw secret passed to log.error never reaches insertLogEvent unmasked", () => {
    log.error("test.event", { password: "hunter2", ok: 1 });

    expect(insertLogEvent).toHaveBeenCalledTimes(1);
    const persisted = insertLogEvent.mock.calls[0][0] as { fields: Record<string, unknown> };
    expect(persisted.fields).toEqual({ password_redacted: true, ok: 1 });
    expect(JSON.stringify(persisted.fields)).not.toContain("hunter2");
  });
});
