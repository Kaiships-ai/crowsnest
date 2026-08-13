import { describe, expect, it } from "vitest";
import { buildHarnessArgs, type HarnessProfile } from "./harness-profile";

const base: HarnessProfile = {
  cwd: "/tmp/sandbox",
  permissionMode: "bypassPermissions",
  settingsJson: '{"hooks":{"SessionStart":[]}}',
  env: {} as NodeJS.ProcessEnv,
};

describe("buildHarnessArgs", () => {
  it("always emits permission mode and settings", () => {
    expect(buildHarnessArgs(base)).toEqual([
      "--permission-mode",
      "bypassPermissions",
      "--settings",
      '{"hooks":{"SessionStart":[]}}',
    ]);
  });

  it("adds model when set", () => {
    expect(buildHarnessArgs({ ...base, model: "minimax" })).toContain("--model");
    expect(buildHarnessArgs({ ...base, model: "minimax" })).toContain("minimax");
  });

  it("adds plugin-dir only when set", () => {
    expect(buildHarnessArgs(base)).not.toContain("--plugin-dir");
    expect(buildHarnessArgs({ ...base, pluginDir: "/plugins/ksa" })).toContain("--plugin-dir");
  });

  it("does not emit the old dangerously-skip flag", () => {
    expect(buildHarnessArgs(base)).not.toContain("--dangerously-skip-permissions");
  });
});
