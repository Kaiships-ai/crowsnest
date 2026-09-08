import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Registers the crowsnest MCP server with the reasoning agents a buyer actually uses
// (Claude Code, Codex) and prints copy-paste config for every other MCP client. The
// server itself is unchanged: it is a streamable-HTTP endpoint at /api/mcp (see
// src/server/mcp/http.ts). "Registering" only means telling each client that URL.

export const MCP_NAME = "crowsnest";

/** Codex reads ~/.codex/config.toml (CODEX_HOME overrides the dir). */
export function codexConfigPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
}

/** Claude Desktop's config on macOS. */
export function claudeDesktopConfigPath(): string {
  return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

/** The args to `claude` that add this server at user scope (global, not tied to a cwd). */
export function claudeCodeAddArgs(url: string): string[] {
  return ["mcp", "add", MCP_NAME, "--scope", "user", "--transport", "http", url];
}

/** Config block for a generic MCP client that speaks streamable HTTP (e.g. .mcp.json). */
export function genericMcpJson(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_NAME]: { type: "http", url } } }, null, 2);
}

/** Claude Desktop can't dial a raw HTTP MCP server; it needs the mcp-remote stdio shim. */
export function claudeDesktopJson(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_NAME]: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2);
}

/**
 * Idempotently upsert an `[mcp_servers.<name>]` http table into a Codex config.toml.
 * Pure: text in, text out. Replaces the existing table for the same name (so re-running
 * never duplicates it or leaves a stale url), else appends it. Only touches that one
 * table; every other line in the file is preserved verbatim.
 */
export function upsertCodexMcp(toml: string, name: string, url: string): string {
  const header = `[mcp_servers.${name}]`;
  const desired = `${header}\nurl = "${url}"`;
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) {
    const base = toml.replace(/\s*$/, "");
    return (base ? `${base}\n\n` : "") + `${desired}\n`;
  }
  // The table body runs until the next `[table]` header or EOF.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const next = [...lines.slice(0, start), ...desired.split("\n"), "", ...lines.slice(end)];
  return `${next.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "")}\n`;
}

/** Parse an MCP streamable-HTTP reply, which is either a JSON body or an SSE stream
 *  whose payload rides on `data:` lines. Returns the last JSON-RPC object, or null. */
export function parseMcpResponse(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  let last: Record<string, unknown> | null = null;
  for (const line of t.split("\n")) {
    const m = line.match(/^data:\s*(\{.*\})\s*$/);
    if (m) {
      try {
        last = JSON.parse(m[1]) as Record<string, unknown>;
      } catch {
        // skip a non-JSON data line
      }
    }
  }
  return last;
}

/** Count the tools an MCP tools/list result carries, or null if the shape isn't that. */
export function toolCountFrom(json: Record<string, unknown> | null): number | null {
  const result = json?.result as { tools?: unknown } | undefined;
  return Array.isArray(result?.tools) ? result!.tools!.length : null;
}

export type McpProbe = { reachable: boolean; tools: number | null; detail: string };

/** Hit the endpoint with a real tools/list so "reachable" means the MCP server answered,
 *  not just that a port is open. Never throws. */
export async function probeMcp(url: string, timeoutMs = 3000): Promise<McpProbe> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { reachable: false, tools: null, detail: `HTTP ${res.status}` };
    const tools = toolCountFrom(parseMcpResponse(await res.text()));
    return { reachable: true, tools, detail: tools !== null ? `${tools} tools` : "reachable" };
  } catch (err) {
    return { reachable: false, tools: null, detail: err instanceof Error ? err.message : "unreachable" };
  }
}

export type RegisterResult = { client: string; ok: boolean; detail: string };

/** Register with Claude Code via its own CLI (remove-then-add = idempotent). Skips
 *  cleanly when the `claude` binary isn't on PATH. */
export function registerClaudeCode(url: string): RegisterResult {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
  } catch {
    return { client: "Claude Code", ok: false, detail: "claude CLI not on PATH — skipped (use the printed command)" };
  }
  try {
    execFileSync("claude", ["mcp", "remove", MCP_NAME, "--scope", "user"], { stdio: "ignore" });
  } catch {
    // nothing to remove
  }
  try {
    execFileSync("claude", claudeCodeAddArgs(url), { stdio: "ignore" });
    return { client: "Claude Code", ok: true, detail: "registered at user scope" };
  } catch (err) {
    return { client: "Claude Code", ok: false, detail: err instanceof Error ? err.message : "claude mcp add failed" };
  }
}

/** Register with Codex by upserting the table into its config.toml. */
export function registerCodex(url: string): RegisterResult {
  const p = codexConfigPath();
  try {
    const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
    const next = upsertCodexMcp(existing, MCP_NAME, url);
    if (next !== existing) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, next);
    }
    return { client: "Codex", ok: true, detail: `wrote ${p}` };
  } catch (err) {
    return { client: "Codex", ok: false, detail: err instanceof Error ? err.message : "could not write config.toml" };
  }
}
