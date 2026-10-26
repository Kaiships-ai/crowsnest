#!/usr/bin/env node
// Stdio MCP server for .mcp.json that forwards each JSON-RPC line to the Lead Studio app's
// MCP. The app listens on a free port it writes to <userData>/mcp.port and mints a fresh
// `local` token into <userData>/mcp.token on each start, which an http entry in .mcp.json
// cannot read, so both are read here on every message.
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const userData =
  process.env.LEAD_STUDIO_USER_DATA ?? path.join(os.homedir(), "Library/Application Support/lead-studio");
const portFile = path.join(userData, "mcp.port");
const tokenFile = path.join(userData, "mcp.token");

const reply = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notRunning = (id, why) =>
  id !== undefined && reply({ jsonrpc: "2.0", id, error: { code: -32000, message: `Lead Studio is not running (${why})` } });

async function forward(line) {
  const message = JSON.parse(line);
  let port;
  let token;
  try {
    port = readFileSync(portFile, "utf8").trim();
    token = readFileSync(tokenFile, "utf8").trim();
  } catch (err) {
    notRunning(message.id, `no ${err.path}`);
    return;
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: line,
    });
  } catch (err) {
    // The app died without its quit hook, so the port file outlived it.
    if (err.cause?.code === "ECONNREFUSED") rmSync(portFile, { force: true });
    notRunning(message.id, `nothing listens on port ${port}`);
    return;
  }
  const text = await res.text();
  if (res.status === 401) {
    if (message.id !== undefined) reply({ ...JSON.parse(text), id: message.id });
    return;
  }
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
