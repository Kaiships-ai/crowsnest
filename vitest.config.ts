import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      // agent worktrees nest full repo copies under .claude/worktrees — never collect
      // their tests
      ".claude/**",
      // Vendored plugin code, not this app's. plugins/ksa/skills/baoyu-image-gen ships
      // its own test suite written for a different runner; under vitest all 14 files
      // fail with "No test suite found", which is 14 permanently red files that say
      // nothing about this repo and hide a real regression in the noise. tsconfig
      // already excludes plugins for the same reason.
      "plugins/**",
      // Playwright specs (*.e2e.spec.ts) run under `npm run test:e2e`, not vitest.
      // Without this, vitest collects them and each throws "Playwright Test did not
      // expect test() to be called here."
      "e2e/**",
      "studio/**",
      "scripts/**/*.test.mjs",
    ],
    // Runs before each test file's own imports, so db/index.ts always reads a
    // CROWSNEST_DB_PATH default of ":memory:" at module-load time — see
    // src/test/setup-env.ts for why this is needed.
    setupFiles: ["./src/test/setup-env.ts"],
    // Half the cores by default; scripts/heavy.sh drops it to 1 when the Mac is low on memory.
    maxWorkers: Number(process.env.HEAVY_WORKERS) || "50%",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
