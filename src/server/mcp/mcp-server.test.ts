import { expect, test } from "vitest";

test("result() returns JSON text and structuredContent that agree", async () => {
  const { result } = await import("./mcp-server");
  const r = result({ ok: true, n: 2 });
  expect(r.content[0]).toMatchObject({ type: "text" });
  expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({ ok: true, n: 2 });
  expect(r.structuredContent).toEqual({ ok: true, n: 2 });
});

test("errorResult() sets isError and carries the payload", async () => {
  const { errorResult } = await import("./mcp-server");
  const r = errorResult({ error: "not found", id: "x" });
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toMatchObject({ error: "not found", id: "x" });
});
