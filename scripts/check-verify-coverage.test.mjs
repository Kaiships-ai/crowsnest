import assert from "node:assert/strict";
import test from "node:test";
import { uncoveredFiles } from "./check-verify-coverage.mjs";

test("a renderer change alone fails", () => {
  assert.deepEqual(uncoveredFiles(["src/renderer/x.tsx"]), ["src/renderer/x.tsx"]);
});

test("a renderer change with its verify feature passes", () => {
  assert.deepEqual(uncoveredFiles(["src/renderer/x.tsx", ".claude/skills/verify/features/x.md"]), []);
});

test("a server change alone fails", () => {
  assert.deepEqual(uncoveredFiles(["src/server/db/schema.ts", "README.md"]), ["src/server/db/schema.ts"]);
});

test("a change outside the guarded paths passes", () => {
  assert.deepEqual(uncoveredFiles(["app/src/main/index.ts", "src/app/page.tsx", "documents/index.md"]), []);
});

test("touching only the feature index does not cover a renderer change", () => {
  assert.deepEqual(uncoveredFiles(["src/renderer/x.tsx", ".claude/skills/verify/features/README.md"]), [
    "src/renderer/x.tsx",
  ]);
});
