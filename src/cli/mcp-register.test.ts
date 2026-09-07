import { describe, expect, test } from "vitest";

import {
  claudeCodeAddArgs,
  claudeDesktopJson,
  genericMcpJson,
  parseMcpResponse,
  toolCountFrom,
  upsertCodexMcp,
} from "./mcp-register";

const URL = "http://localhost:3000/api/mcp";

describe("upsertCodexMcp", () => {
  test("empty config gets the block", () => {
    const out = upsertCodexMcp("", "crowsnest", URL);
    expect(out).toBe(`[mcp_servers.crowsnest]\nurl = "${URL}"\n`);
  });

  test("preserves an unrelated section and appends the block", () => {
    const existing = `[model]\nname = "gpt-5"\n`;
    const out = upsertCodexMcp(existing, "crowsnest", URL);
    expect(out).toContain(`[model]`);
    expect(out).toContain(`name = "gpt-5"`);
    expect(out).toContain(`[mcp_servers.crowsnest]\nurl = "${URL}"`);
  });

  test("replaces an existing crowsnest block instead of duplicating it", () => {
    const existing = `[mcp_servers.crowsnest]\nurl = "http://localhost:9999/api/mcp"\n`;
    const out = upsertCodexMcp(existing, "crowsnest", URL);
    expect(out).toContain(`url = "${URL}"`);
    expect(out).not.toContain("9999");
    // exactly one header
    expect(out.match(/\[mcp_servers\.crowsnest\]/g)!.length).toBe(1);
  });

  test("replacing the crowsnest block keeps a later section intact", () => {
    const existing = `[mcp_servers.crowsnest]\nurl = "http://old"\n\n[mcp_servers.other]\nurl = "http://other"\n`;
    const out = upsertCodexMcp(existing, "crowsnest", URL);
    expect(out).toContain(`url = "${URL}"`);
    expect(out).toContain(`[mcp_servers.other]`);
    expect(out).toContain(`url = "http://other"`);
  });

  test("is idempotent", () => {
    const once = upsertCodexMcp("", "crowsnest", URL);
    const twice = upsertCodexMcp(once, "crowsnest", URL);
    expect(twice).toBe(once);
  });
});

describe("parseMcpResponse", () => {
  test("parses a plain JSON body", () => {
    const json = parseMcpResponse('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
  });

  test("parses an SSE data line", () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}\n\n';
    expect(toolCountFrom(parseMcpResponse(sse))).toBe(1);
  });

  test("returns null on garbage", () => {
    expect(parseMcpResponse("not json")).toBeNull();
  });
});

describe("toolCountFrom", () => {
  test("counts tools", () => {
    expect(toolCountFrom({ result: { tools: [{}, {}, {}] } })).toBe(3);
  });
  test("null when not a tools/list shape", () => {
    expect(toolCountFrom({ result: {} })).toBeNull();
    expect(toolCountFrom(null)).toBeNull();
  });
});

describe("client config generators", () => {
  test("generic json is streamable-http shaped", () => {
    expect(JSON.parse(genericMcpJson(URL))).toEqual({ mcpServers: { crowsnest: { type: "http", url: URL } } });
  });
  test("claude desktop json uses the mcp-remote shim", () => {
    expect(JSON.parse(claudeDesktopJson(URL))).toEqual({
      mcpServers: { crowsnest: { command: "npx", args: ["-y", "mcp-remote", URL] } },
    });
  });
  test("claude code add args target user scope over http", () => {
    expect(claudeCodeAddArgs(URL)).toEqual(["mcp", "add", "crowsnest", "--scope", "user", "--transport", "http", URL]);
  });
});
