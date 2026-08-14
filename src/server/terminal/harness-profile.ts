import path from "node:path";
import { config } from "@/server/config";
import { scrubbedTerminalEnv } from "./session";

/** absolute path to the ksa plugin the cook loads via --plugin-dir */
export const KSA_PLUGIN_DIR = path.join(process.cwd(), "plugins", "ksa");

export interface HarnessProfile {
  /** maps to --model; unset means the CLI default */
  model?: string;
  /** the sandbox dir the cook runs in */
  cwd: string;
  /** maps to --plugin-dir */
  pluginDir?: string;
  /** maps to --permission-mode */
  permissionMode: "bypassPermissions";
  /** serialized object passed to --settings; hooks-off */
  settingsJson: string;
  /** scrubbedTerminalEnv() output */
  env: NodeJS.ProcessEnv;
}

/**
 * The SessionStart override that keeps this app's hooks (ADHD, caveman, superpowers,
 * humanizer, last30days) out of the cook's context. Verified live in Task 3 to override
 * rather than append.
 */
export const HOOKS_OFF_SETTINGS = '{"hooks":{"SessionStart":[]}}';

export function buildHarnessArgs(p: HarnessProfile): string[] {
  const args: string[] = ["--permission-mode", p.permissionMode, "--settings", p.settingsJson];
  if (p.model) args.push("--model", p.model);
  if (p.pluginDir) args.push("--plugin-dir", p.pluginDir);
  return args;
}

export function buildCookProfile(cwd: string): HarnessProfile {
  return {
    cwd,
    permissionMode: "bypassPermissions",
    settingsJson: HOOKS_OFF_SETTINGS,
    model: config.COOK_MODEL,
    pluginDir: KSA_PLUGIN_DIR,
    env: scrubbedTerminalEnv(),
  };
}
