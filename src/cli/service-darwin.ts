import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { appRoot, igDir, igVenvPython, logDir, nodeBin, tsxBin } from "./runtime";

// The only macOS-coded file. Windows/Linux later is one sibling (a Windows service, a
// systemd unit) behind this same small shape: define(), load(), unload(), running().

export type Service = {
  label: string;
  program: string[];
  cwd: string;
  env: Record<string, string>;
};

const AGENTS = join(homedir(), "Library", "LaunchAgents");

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
      env: {},
    },
  ];
}

function plistPath(label: string): string {
  return join(AGENTS, `${label}.plist`);
}

function plist(s: Service): string {
  const args = s.program
    .map((a) => `    <string>${a}</string>`)
    .join("\n");
  const env = Object.entries(s.env)
    .map(([k, v]) => `    <key>${k}</key>\n    <string>${v}</string>`)
    .join("\n");
  const out = join(logDir, `${s.label}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${s.label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${s.cwd}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${out}</string>
  <key>StandardErrorPath</key><string>${out}</string>
</dict>
</plist>
`;
}

const uid = process.getuid?.() ?? 0;

function launchctl(args: string[]): void {
  execFileSync("launchctl", args, { stdio: "ignore" });
}

/** Write both plists (idempotent) and load them. Reloads if already loaded. */
export function start(): void {
  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  for (const s of services()) {
    writeFileSync(plistPath(s.label), plist(s));
    // bootout first so a changed plist (new version dir) takes effect, ignore if not loaded.
    try {
      launchctl(["bootout", `gui/${uid}/${s.label}`]);
    } catch {
      // not loaded yet
    }
    launchctl(["bootstrap", `gui/${uid}`, plistPath(s.label)]);
  }
}

export function stop(): void {
  for (const s of services()) {
    try {
      launchctl(["bootout", `gui/${uid}/${s.label}`]);
    } catch {
      // already stopped
    }
  }
}

/** True if launchd currently has the label loaded. */
export function running(label: string): boolean {
  try {
    execFileSync("launchctl", ["print", `gui/${uid}/${label}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function installed(label: string): boolean {
  return existsSync(plistPath(label));
}
