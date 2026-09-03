import { beforeAll, describe, expect, test } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

describe("mediaInfoFor", () => {
  let migrate: typeof import("@/server/db/test-migrate")["migrate"];
  let recordAsset: typeof import("@/server/media/store")["recordAsset"];
  let mediaInfoFor: typeof import("./mcp-server")["mediaInfoFor"];

  beforeAll(async () => {
    ({ migrate } = await import("@/server/db/test-migrate"));
    ({ recordAsset } = await import("@/server/media/store"));
    ({ mediaInfoFor } = await import("./mcp-server"));
    migrate();
  });

  test("resolves path/byteSize/durationSec from the stored asset row only, never touching the file", async () => {
    const sha = "e".repeat(64);
    const asset = await recordAsset({ sha256: sha, kind: "video", contentType: "video/mp4", byteSize: 555, durationSec: 8.5 });

    const info = await mediaInfoFor(asset.id);

    expect(info).not.toBeNull();
    expect(info?.path).toMatch(/\.mp4$/);
    expect(info?.path?.startsWith("/") || /^[A-Za-z]:[\\/]/.test(info?.path ?? "")).toBe(true);
    expect(info?.byteSize).toBe(555);
    expect(info?.durationSec).toBe(8.5);
  });

  test("returns null for a null assetId", async () => {
    expect(await mediaInfoFor(null)).toBeNull();
  });
});

describe("pagination on crowsnest_scripts and crowsnest_ideas", () => {
  let db: typeof import("@/server/db")["db"];
  let tables: typeof import("@/server/db")["tables"];
  let newId: typeof import("@/server/db")["newId"];
  let migrate: typeof import("@/server/db/test-migrate")["migrate"];
  let buildMcpServer: typeof import("./mcp-server")["buildMcpServer"];

  beforeAll(async () => {
    ({ db, tables, newId } = await import("@/server/db"));
    ({ migrate } = await import("@/server/db/test-migrate"));
    ({ buildMcpServer } = await import("./mcp-server"));
    migrate();
  });

  function tsAt(minutesAgo: number): string {
    return new Date(Date.UTC(2026, 0, 1, 0, minutesAgo)).toISOString();
  }

  // registerTool's callback isn't part of McpServer's public type — reaching into
  // the internal registry is the lightest way to call a tool directly in a test
  // without standing up a client/transport pair.
  function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
    const registry = (server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ structuredContent: unknown }> }>;
    })._registeredTools;
    return registry[name].handler(args, {});
  }

  test("crowsnest_scripts: limit/offset slices the full list, total/count reflect it", async () => {
    await db.insert(tables.scripts).values([
      { id: newId(), title: "Script A", content: "a", status: "draft", createdAt: tsAt(10), updatedAt: tsAt(10) },
      { id: newId(), title: "Script B", content: "b", status: "draft", createdAt: tsAt(20), updatedAt: tsAt(20) },
    ]);

    const server = buildMcpServer();
    const r = await callTool(server, "crowsnest_scripts", { limit: 1, offset: 0 });
    const body = r.structuredContent as { total: number; count: number; items: unknown[] };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.count).toBe(body.items.length);
    expect(body.items.length).toBeLessThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(body.count);
  });

  test("crowsnest_ideas: limit/offset slices within the requested tab", async () => {
    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@mcp-ideas-page", trackedSince: tsAt(0) });

    const videoIds = [newId(), newId()];
    await db.insert(tables.videos).values(
      videoIds.map((id) => ({
        id, channelId, platform: "instagram" as const, externalId: `mcp-idea-${id}`,
        url: "https://example.com/post", postedAt: tsAt(0), firstSeenAt: tsAt(0),
      }))
    );
    await db.insert(tables.idea).values(
      videoIds.map((videoId, i) => ({
        id: newId(), sourceVideoId: videoId, concept: `Idea ${i}`, angle: "An angle",
        status: "inbox", createdAt: tsAt(i * 10), updatedAt: tsAt(i * 10),
      }))
    );

    const server = buildMcpServer();
    const r = await callTool(server, "crowsnest_ideas", { tab: "inbox", limit: 1, offset: 0 });
    const body = r.structuredContent as { total: number; count: number; items: unknown[] };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.count).toBe(body.items.length);
    expect(body.items.length).toBeLessThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(body.count);
  });
});
