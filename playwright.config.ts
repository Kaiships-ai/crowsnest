import { defineConfig, devices } from "@playwright/test";

// Playwright e2e lane for the crowsnest web UI. Specs live in ./e2e as
// *.e2e.spec.ts (vitest owns *.test.ts, so the two lanes never collide).
// Specs that navigate the real app need the dev server running (npm run dev)
// or a webServer block; the mock-backend harness (e2e/helpers/mock-backend.ts)
// runs keyless and offline.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.CROWSNEST_E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
