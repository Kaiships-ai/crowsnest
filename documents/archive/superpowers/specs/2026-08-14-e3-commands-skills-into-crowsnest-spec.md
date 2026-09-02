# E3 commands and skills into Crowsnest spec

Status: draft, awaiting Kai's wireframe approval before build.
Roadmap: E3 is step 4 of 4 (E1 harness, D1 create-run tracking, E2 workspace out of vault, E3 commands and skills into Crowsnest). This is the real separation. After E3 the vault is out of the cook path entirely.

## Goal

Take the cook off the vault. Today the cook only works because its cwd is inside the vault, so claude walks up and loads the vault's `.claude/commands` and skills. E3 gives Crowsnest its own plugin dir carrying the cook command and the skills it needs, has Crowsnest write the cook's input as a `brief.md` in the sandbox, and folds the craft laws into the command so quality survives leaving the vault. When E3 lands, the vault (Kai-Official-OS) is ops and strategy only, not part of a cook.

## Non-goals

- No change to the run model or the studio UI. That is D1.
- No change to where the sandbox lives on disk beyond what E2 already did. E2 owns the path move; E3 owns the command and skill move. See the E2 dependency note: these two may land together.
- hyperframes and faceless-explainer are not vendored. They stay global and declared (see section 4).

## Current state (grounded)

- The cook command is injected from the studio, not resolved in server code: `studio-panel.tsx:26-28` sends `"/ksa:cooking\r"` into the pty; publish sends `"/ksa:serve\r"`. Discovery is entirely by cwd-walk into the vault.
- No Crowsnest plugin dir exists. No `.claude-plugin/plugin.json` anywhere in the repo (only prose mentions in `docs/reviews/cook-debate-config.md`). The E1 `pluginDir` profile field is defined but unset.
- No `brief.md` writer exists. `getStudioBrief(postId)` (`src/server/queries/studio.ts:5`) returns a DB object consumed by the studio screen; nothing writes a brief file into the sandbox before a cook.
- The cook command is `Kai-Official-OS/.claude/commands/ksa/cooking.md` (7524 bytes). Its siblings include `serve.md` (4392 bytes) and the rest of the ksa family (reach, measure, amplify, and others). Only `cooking` and `serve` are referenced from Crowsnest's `src`.
- cooking.md reads its input spec from `Studio/workspace/reach/` (cooking.md:30). It writes renders to `Studio/workspace/renders/YYYY-MM-DD-<slug>/` and keeps editable projects in `Studio/workspace/videos/<slug>/` (cooking.md:41,74,78).
- Craft laws in cooking.md (cooking.md:14-22) point at vault files and require the sub-agent to read them, not paraphrase: `Studio/inspiration/SHOCK-PLAYBOOK.md`, `Studio/inspiration/VO-SCRIPT-PLAYBOOK.md`, and a `website-to-hyperframes/` reference clone.
- Skills: the vault has 21 `baoyu-*` project skills, two of them `baoyu-danger-*` (`baoyu-danger-gemini-web`, `baoyu-danger-x-to-markdown`). cooking.md references `baoyu-skill-selection.md` for skill choice. hyperframes and faceless-explainer are user-level skills (`~/.claude/skills/hyperframes*`, `~/.claude/skills/faceless-explainer`), not vault project skills.

## What E3 builds

### 1. A Crowsnest plugin dir

Create a plugin dir inside Crowsnest with a `.claude-plugin/plugin.json` manifest, loaded by the harness via the E1 profile's `pluginDir` field (`--plugin-dir`). The manifest declares the plugin name and the commands and skills it carries. Proposed location: `plugins/ksa/` at the repo root (final path settled in the plan). It carries:

- `ksa:cooking` (rewritten, see section 2 and 3)
- `ksa:serve` (moved from the vault; rewrite any vault-relative paths the same way)
- the baoyu skills the cook actually invokes

E1's `buildCookProfile` sets `pluginDir` to this dir. That is the field E1 left unset.

### 2. Crowsnest writes brief.md into the sandbox

Crowsnest writes the full remix studio output as `brief.md` in the sandbox (`data/workspace/videos/<slug>/brief.md` after E2), before the cook starts. The brief is the full remix output: source outlier, research notes, chosen hook, chosen style or vault item, outline, script variants, target length, frame-pass layout, video_kind. This is the locked cook input: Crowsnest hands its own brief, no vault reach spec.

Source of the content: `getStudioBrief(postId)` already returns the DB object. E3 adds a writer that serializes it (plus the frame-pass layout and video_kind) to `brief.md`. This writer does not exist today and is the larger new piece of E3 (blocker B4).

The cook command is rewritten so step "pick the spec" reads `./brief.md` in the sandbox instead of `Studio/workspace/reach/`. No AskUserQuestion to pick a spec file; there is exactly one brief, the sandbox's own.

### 3. Fold the craft laws into the command

cooking.md's craft laws currently live as vault paths the sub-agent must read (`Studio/inspiration/SHOCK-PLAYBOOK.md`, `VO-SCRIPT-PLAYBOOK.md`, the website-to-hyperframes reference). Outside the vault those paths do not resolve. Fold the SHOCK-PLAYBOOK and VO-SCRIPT-PLAYBOOK craft rules directly into the Crowsnest cook command so the craft bar survives the move. Do not drop them, and do not leave them as dangling vault paths. The command carries the rules inline (cold-open and hook mechanics, the "FLOW, don't chop" VO cadence correction that supersedes the older fragment rules), and requires each render sub-agent brief to include them.

The website-to-hyperframes reference clone is a larger asset than a playbook. The plan decides whether to vendor a trimmed reference into the plugin or describe the cold-open pattern inline. Either way the command must not point at a vault path.

### 4. hyperframes and faceless-explainer stay global

These are user-level skills that self-update (hyperframes updates via `npx hyperframes skills update`). Vendoring them into Crowsnest goes stale. They stay at `~/.claude/skills` and are found by the cook at user level. The harness declares that it relies on them (a note in the plugin manifest or the profile), it does not copy them. This reverses the earlier "all skills into Crowsnest" idea (blocker B4).

### 5. Vendor only the baoyu skills the cook uses

Vendor into the plugin only the baoyu skills the cook actually invokes, not all 21, and never the two `baoyu-danger-*`. The exact set (the handoff says 7) is enumerated in the plan by tracing cooking.md's build paths and `baoyu-skill-selection.md`. The plan lists them by name before vendoring.

## Acceptance criteria

1. A cook runs end to end with the sandbox outside the vault (E2 in place) and finds `/ksa:cooking` from the Crowsnest plugin dir, not the vault.
2. Before the cook starts, `brief.md` exists in the sandbox and contains the full remix output (source outlier, research, hook, style, outline, script variants, target length, frame-pass layout, video_kind).
3. The cook reads `./brief.md` and never reads `Studio/workspace/reach/` or any vault path.
4. The rendered video meets the craft bar: the SHOCK and VO cadence rules are applied because they are in the command, verified by inspecting a render sub-agent brief or the output.
5. hyperframes and faceless-explainer are resolved from the user-level skills, not vendored copies.
6. Only the named baoyu skills are vendored; no `baoyu-danger-*` is present in the plugin.
7. With the vault path removed from `config` (or simply unused by the cook), a cook still completes. The vault is out of the cook path.
8. `ksa:serve` works from the plugin dir with no vault-relative path.

## Open questions to settle in the plan

1. Plugin dir location and manifest shape: `plugins/ksa/` versus another path; the exact `plugin.json` fields the CLI 2.1.231 requires (read the CLI plugin docs, do not guess the manifest schema).
2. brief.md format: the exact serialization of `getStudioBrief` plus frame-pass layout and video_kind into markdown the cook command can parse. This is the load-bearing new artifact; get its shape right.
3. The baoyu set: the exact list of skills to vendor, traced from cooking.md and baoyu-skill-selection.md.
4. The website-to-hyperframes reference: vendor trimmed, or describe inline.
5. Whether E3 lands together with E2 (recommended in the E2 spec) or after it with the interim bridge removed here.
6. What happens to `config.VAULT_PATH` after E3: kept for ops paths, or removed if nothing else uses it (grep before removing).

## Files touched (anticipated)

- new: `plugins/ksa/.claude-plugin/plugin.json`, `plugins/ksa/commands/ksa/cooking.md` (rewritten), `plugins/ksa/commands/ksa/serve.md`, vendored `plugins/ksa/skills/baoyu-*` (the named set)
- new: a brief.md writer (`src/server/studio/write-brief.ts` or similar) and its call site before the cook spawns (`ws.ts` or the studio action path)
- `src/server/terminal/harness-profile.ts` (`buildCookProfile` sets `pluginDir`)
- `src/server/queries/studio.ts` if the brief object needs more fields (frame-pass layout, video_kind) than `getStudioBrief` returns today
