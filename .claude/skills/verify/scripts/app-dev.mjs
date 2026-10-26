// app-dev.mjs <renderer-port> -- electron-vite dev for app-host.mjs (APP_DEV=1): renderer HMR on the given
// port, never the operator's pnpm dev port, and main and preload rebuilt on change. Electron's own
// arguments arrive in ELECTRON_CLI_ARGS, as electron-vite's CLI passes them.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const { createServer } = await import(pathToFileURL(createRequire(path.join(ROOT, "package.json")).resolve("electron-vite")).href);
process.chdir(ROOT);
await createServer(
  { root: ROOT, mode: "e2e", build: { watch: {} }, server: { port: Number(process.argv[2]), strictPort: true } },
  { rendererOnly: false },
).catch((error) => {
  console.error(`app-dev: ${error?.stack ?? error}`);
  process.exit(1);
});
