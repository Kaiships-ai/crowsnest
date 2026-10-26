import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { authenticateMcpToken } from "@/server/services/mcp-tokens";

import { buildMcpServer } from "./mcp-server";

/**
 * Bridges the app's raw Node http server (server.ts) to the MCP streamable HTTP
 * transport. Stateless: a fresh server and transport per request, torn down when the
 * response closes. That is enough for a single local user driving read tools, and it
 * sidesteps session bookkeeping. Every request shares the app's one SQLite connection
 * because the query functions the tools call are the app's own.
 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function isLocalRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined && !isLocalHost(URL.canParse(origin) ? new URL(origin).host : undefined)) return false;
  return isLocalHost(req.headers.host);
}

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLocalRequest(req)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "crowsnest MCP only answers local clients." }, id: null }));
    return;
  }
  const agent = authenticateMcpToken(req.headers.authorization);
  if (!agent) {
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "crowsnest MCP needs Authorization: Bearer <token>; the token is missing, unknown, or revoked." }, id: null }));
    return;
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const server = buildMcpServer(agent);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: err instanceof Error ? err.message : "internal error" }, id: null }));
  }
}
