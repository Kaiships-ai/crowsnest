import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // agent worktrees nest full repo copies under .claude/worktrees — never collect their tests
    exclude: ["**/node_modules/**", "**/.next/**", ".claude/**"],
    // Runs before each test file's own imports, so db/index.ts always reads a
    // CROWSNEST_DB_PATH default of ":memory:" at module-load time — see
    // src/test/setup-env.ts for why this is needed.
    setupFiles: ["./src/test/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
