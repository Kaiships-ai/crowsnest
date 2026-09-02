import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Untracked scratch and vendor bundles, not our source:
    "Crowsnest UI Mockups/**",
    "claude-animation/**",
    // Skill helper scripts (their own CommonJS runtime), not the Next.js app:
    ".claude/**",
    // Local plugin skills (taste/ship) and their helper scripts, not app source:
    "plugins/**",
  ]),
]);

export default eslintConfig;
