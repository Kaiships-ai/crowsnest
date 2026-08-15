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
  /** maps to --setting-sources; the whitelist of settings files to load at all */
  settingSources?: string;
  /** scrubbedTerminalEnv() output */
  env: NodeJS.ProcessEnv;
}

/**
 * The empty settings-source whitelist: load NO settings.json at any level.
 *
 * The previous attempt, `--settings '{"hooks":{"SessionStart":[]}}'`, did not work and
 * the smoke caught it. `--settings` loads ADDITIONAL settings, a merge, so it cannot
 * delete an inherited hook. Confirmed live from a sandbox cwd: with that flag and no
 * source scoping, the first thing the cook printed back out of its own context was
 *
 *   SessionStart:startup hook success: ADHD MODE ACTIVE (always-on) ...
 *
 * plus the superpowers and humanizer preambles. `--setting-sources` is the real lever:
 * it is a whitelist of which sources to load, and an empty value loads none of them, so
 * there is no inherited SessionStart hook left to override.
 *
 * Verified live under this exact value, from `data/workspace/videos/<slug>`:
 *  - the same probe prints no hook banner at all;
 *  - the session still authenticates (Claude Max, OAuth via keychain, with no
 *    ANTHROPIC_API_KEY in the environment) — dropping settings.json does not touch auth;
 *  - `--plugin-dir` still resolves the plugin: asked to list its commands, the session
 *    named `ksa:cooking` and `ksa:serve`.
 *
 * `--bare` would also skip hooks but is disqualified: it disables plugin sync, which the
 * cook needs, and it restricts auth to an API key.
 *
 * The three named scopes (`user`, `project`, `local`) each also suppressed the banner in
 * testing, but all three load a settings file the cook has no use for and could be
 * changed under it later. Loading nothing is the narrower, more stable promise.
 */
export const COOK_SETTING_SOURCES = "";

export function buildHarnessArgs(p: HarnessProfile): string[] {
  const args: string[] = ["--permission-mode", p.permissionMode];
  // Emitted whenever the field is present, including the empty string, which is the
  // whole point: "" means "load no settings sources" and is NOT the same as omitting the
  // flag, which loads all three.
  if (p.settingSources !== undefined) args.push("--setting-sources", p.settingSources);
  if (p.model) args.push("--model", p.model);
  if (p.pluginDir) args.push("--plugin-dir", p.pluginDir);
  return args;
}

export function buildCookProfile(cwd: string): HarnessProfile {
  return {
    cwd,
    permissionMode: "bypassPermissions",
    settingSources: COOK_SETTING_SOURCES,
    model: config.COOK_MODEL,
    pluginDir: KSA_PLUGIN_DIR,
    env: scrubbedTerminalEnv(),
  };
}
