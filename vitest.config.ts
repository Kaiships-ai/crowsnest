import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // agent worktrees nest full repo copies under .claude/worktrees — never collect their tests
    exclude: ["**/node_modules/**", "**/.next/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
