import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Works whether kai.ts runs as CJS (tsx in the repo) or ESM. In the repo `__dirname`
// exists; the fallback covers an ESM load.
const here =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

/** The app root: the repo in dev, or `~/.kai/app/current/app` in a bundle. */
export const appRoot = resolve(here, "..", "..");

/**
 * A bundle ships sibling `bin/node`, `bin/uv`, `runtime/python`, and `wheelhouse`
 * next to the app dir. Their absence means we are running from the dev repo.
 */
export const bundleRoot = resolve(appRoot, "..");
export const isBundle = existsSync(join(bundleRoot, "bin", "node"));

/** Node that is running this process. In a bundle it is the pinned bundled node. */
export const nodeBin = isBundle ? join(bundleRoot, "bin", "node") : process.execPath;
export const uvBin = isBundle ? join(bundleRoot, "bin", "uv") : "uv";
export const pythonBin = isBundle
  ? join(bundleRoot, "runtime", "python", "bin", "python3")
  : "python3";
export const wheelhouse = isBundle ? join(bundleRoot, "wheelhouse") : "";

/** Not node_modules/.bin/tsx: pnpm makes that a shell shim, which node cannot run. */
export const tsxBin = join(appRoot, "node_modules", "tsx", "dist", "cli.mjs");

export const igDir = join(appRoot, "services", "ig");
export const igVenvPython = join(igDir, ".venv", "bin", "python");

/** Buyer state lives outside version dirs so updates preserve it. */
export const stateDir = isBundle
  ? resolve(bundleRoot, "..", "..", "state") // ~/.kai/app/vX -> ~/.kai/state
  : join(appRoot, "data");
export const logDir = join(homedir(), ".kai", "logs");
