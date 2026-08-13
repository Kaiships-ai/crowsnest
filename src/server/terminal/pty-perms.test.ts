import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensurePtyExecutable } from "./pty-perms";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "pty-perms-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("ensurePtyExecutable", () => {
  it("adds the exec bit to pty.node and spawn-helper when missing", () => {
    for (const f of ["pty.node", "spawn-helper"]) {
      const p = path.join(dir, f);
      writeFileSync(p, "x");
      chmodSync(p, 0o644); // no exec bit
    }
    ensurePtyExecutable(dir);
    for (const f of ["pty.node", "spawn-helper"]) {
      expect(statSync(path.join(dir, f)).mode & 0o111).not.toBe(0);
    }
  });
  it("is a no-op when the dir does not exist", () => {
    expect(() => ensurePtyExecutable(path.join(dir, "nope"))).not.toThrow();
  });
});
