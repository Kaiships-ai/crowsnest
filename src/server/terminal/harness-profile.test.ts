import { describe, expect, it } from "vitest";
import {
  buildCookProfile,
  buildHarnessArgs,
  COOK_SETTING_SOURCES,
  KSA_PLUGIN_DIR,
  type HarnessProfile,
} from "./harness-profile";

const base: HarnessProfile = {
  cwd: "/tmp/sandbox",
  permissionMode: "bypassPermissions",
  env: {} as NodeJS.ProcessEnv,
};

describe("buildHarnessArgs", () => {
  it("always emits permission mode", () => {
    expect(buildHarnessArgs(base)).toEqual(["--permission-mode", "bypassPermissions"]);
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

  it("emits an EMPTY setting-sources value rather than dropping the flag", () => {
    // The load-bearing case. "" means "load no settings sources at all"; omitting the
    // flag loads user, project and local, which is how the SessionStart hooks leaked
    // into the cook in the first place. A truthiness check here would silently undo the
    // whole fix.
    const args = buildHarnessArgs({ ...base, settingSources: "" });
    const flagIndex = args.indexOf("--setting-sources");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe("");
  });

  it("omits setting-sources when the profile does not set one, so non-cook profiles are unaffected", () => {
    expect(buildHarnessArgs(base)).not.toContain("--setting-sources");
  });

  it("no longer passes --settings, which merged rather than replaced and could not delete an inherited hook", () => {
    expect(buildHarnessArgs(buildCookProfile("/tmp/sandbox"))).not.toContain("--settings");
  });
});

describe("buildCookProfile", () => {
  it("sets pluginDir to the ksa plugin directory", () => {
    const profile = buildCookProfile("/tmp/sandbox");
    expect(profile.pluginDir).toBe(KSA_PLUGIN_DIR);
  });

  it("emits --plugin-dir followed by the ksa plugin path", () => {
    const args = buildHarnessArgs(buildCookProfile("/tmp/sandbox"));
    const flagIndex = args.indexOf("--plugin-dir");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe(KSA_PLUGIN_DIR);
  });

  it("scopes settings sources to none, which is what keeps SessionStart hooks out of the cook", () => {
    const profile = buildCookProfile("/tmp/sandbox");
    expect(profile.settingSources).toBe(COOK_SETTING_SOURCES);
    expect(COOK_SETTING_SOURCES).toBe("");
    const args = buildHarnessArgs(profile);
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
  });
});
