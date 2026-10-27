import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log } from "@/server/lib/logger";
import { igSidecar } from "@/server/connectors/ig-sidecar/manifest";
import { getOrCreateServiceToken } from "@/server/connectors/ig-sidecar/service-token";
import { readSecret } from "@/server/connectors/secrets";

const PID_FILE = "data/sidecar.pid";
const SIDECAR_CWD = path.resolve(process.cwd(), "services/ig");

function ingestUrl(): string {
  const port = process.env.PORT ?? "3000";
  return process.env.CROWSNEST_INGEST_URL ?? `http://127.0.0.1:${port}/api/logs/ingest`;
}

function childEnv(): NodeJS.ProcessEnv {
  const inject: Record<string, string | undefined> = {
    IG_SERVICE_TOKEN: getOrCreateServiceToken(),
    IG_USERNAME: readSecret(igSidecar, "IG_USERNAME"),
    IG_PASSWORD: readSecret(igSidecar, "IG_PASSWORD"),
    IG_SESSIONID: readSecret(igSidecar, "IG_SESSIONID"),
    IG_PROXY: process.env.IG_PROXY,
    IG_DEVICE_SEED: process.env.IG_DEVICE_SEED,
    CROWSNEST_INGEST_URL: ingestUrl(),
  };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(inject)) if (v) env[k] = v;
  return env;
}

/** Spawns the sidecar exactly like scripts/ig-service.sh: cwd services/ig, `uv run
 *  python -m crowsnest_ig`, detached with stdio ignored so it survives this process
 *  exiting. The child's pid is tracked in data/sidecar.pid so Stop and status checks
 *  survive a reload of this server. */
export function startSidecar(): void {
  const child = spawn("uv", ["run", "python", "-m", "crowsnest_ig"], {
    cwd: SIDECAR_CWD,
    env: childEnv(),
    detached: true,
    stdio: "ignore",
  });
  // The child is detached with stdio ignored, so a failure that only shows up after
  // spawn() returns (a missing `uv` binary surfaces as ENOENT here, or a crash right at
  // boot) arrives solely as an "error" event, never as a thrown exception in this
  // function. Node treats an unhandled "error" event on a ChildProcess as a fatal
  // exception in *this* process, the one serving the Settings page, so it must be
  // handled even though there is nothing left to do here but log it: the detached child
  // is on its own, and it's startSidecarAction's post-spawn health poll, not this
  // handler, that actually decides whether Start succeeded.
  child.on("error", (err) => {
    log.error("sidecar.spawn.error", { error: err.message });
  });
  if (child.pid) writeFileSync(PID_FILE, String(child.pid));
  child.unref();
}

/** Whether the pid tracked in data/sidecar.pid still belongs to a live process.
 *  `process.kill(pid, 0)` sends no signal, it only probes for existence/permission. */
export function sidecarPidAlive(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopSidecar(): void {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  rmSync(PID_FILE, { force: true });
}
