#!/usr/bin/env node
// Stdio MCP server for .mcp.json that forwards each JSON-RPC line to the Lead Studio app's
// MCP. The app listens on a free port it writes to <userData>/mcp.port, which an http
// entry in .mcp.json cannot read, so the port is read here on every message.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const userData =
  process.env.LEAD_STUDIO_USER_DATA ?? path.join(os.homedir(), "Library/Application Support/lead-studio");
const portFile = path.join(userData, "mcp.port");

const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function forward(line) {
  const message = JSON.parse(line);
  let port;
  try {
    port = readFileSync(portFile, "utf8").trim();
  } catch {
    if (message.id !== undefined) {
      reply({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: `Lead Studio is not running (no ${portFile})` } });
    }
    return;
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: line,
  });
  const text = await res.text();
  if (!text) return;
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    process.stdout.write(`${text.trim()}\n`);
    return;
  }
  for (const data of text.split("\n").filter((l) => l.startsWith("data: "))) {
    process.stdout.write(`${data.slice(6)}\n`);
  }
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  if (line.trim()) await forward(line).catch((err) => console.error("lead-studio-mcp:", err));
}
