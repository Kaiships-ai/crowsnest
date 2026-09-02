# E2 + E3 workspace out of the vault and cook into a Crowsnest plugin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the studio workspace off the vault into Crowsnest's data tree (E2), and give Crowsnest its own plugin dir carrying the cook command, the craft laws, and the skills it needs, with the cook reading a Crowsnest-written brief.md (E3). After this branch, the vault is out of the cook path.

**Architecture:** E2 repoints the workspace path helpers to data/workspace. E3 adds plugins/ksa (a plugin.json manifest, the rewritten cooking.md and serve.md, the 7 baoyu skills the cook uses), has Crowsnest write brief.md into the sandbox from the studio brief, folds the SHOCK and VO craft laws into the cook command so quality survives leaving the vault, and points E1's harness profile pluginDir at plugins/ksa. hyperframes and faceless-explainer stay global (user-level) and are declared, not vendored.

**Tech Stack:** TypeScript, drizzle, Next server, node-pty, the Claude Code plugin format (a plugin.json manifest plus commands/ and skills/ dirs at the plugin root, loaded via --plugin-dir).

**Spec:** docs/superpowers/specs/2026-08-14-e2-workspace-out-of-vault-spec.md and docs/superpowers/specs/2026-08-14-e3-commands-skills-into-crowsnest-spec.md

**Branch:** feat/e2-e3-workspace-and-plugin, stacked on feat/d1-create-run-tracking (which is stacked on E1). E2 and E3 land together because moving the sandbox out of the vault (E2) breaks the cwd-walk that finds /ksa:cooking; only E3's plugin dir restores it. This is the approved reason they are combined.

## Global Constraints

- npm/node are not on the default PATH; prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- The verification gate for every code task is BOTH `npm run typecheck` and the task's vitest files.
- Repo data convention: local data roots under data/ (data/crowsnest.db, data/media). The workspace moves to data/workspace.
- The cook command itself does not change what it does; E3 changes where it reads input (./brief.md), where it finds its craft laws (folded inline), and where it writes output (sandbox-relative), not the HyperFrames workflow it runs.
- hyperframes and faceless-explainer are user-level skills at ~/.claude/skills. They are declared as relied-upon, never vendored (they self-update; a vendored copy goes stale).
- Never vendor a baoyu-danger-* skill. The 7 the cook uses: baoyu-xhs-images, baoyu-cover-image, baoyu-slide-deck, baoyu-image-gen, baoyu-infographic, baoyu-diagram, baoyu-article-illustrator (source: the vault's baoyu-skill-selection.md mapping table).
- Plugin format (verified from the CLI and docs): the manifest is plugins/ksa/.claude-plugin/plugin.json with fields name, description, version, author. commands/ and skills/ live at the plugin ROOT (plugins/ksa/commands, plugins/ksa/skills), never inside .claude-plugin/. Loaded with --plugin-dir (E1's HarnessProfile.pluginDir field, currently unset).

## Rulings baked in (mechanical decisions)

1. Workspace root config key: WORKSPACE_ROOT, default data/workspace, matching the MEDIA_ROOT idiom.
2. Plugin location: plugins/ksa/ at the repo root (a manually assembled dir loaded via --plugin-dir, not `claude plugin init`, which only targets ~/.claude/skills).
3. Cook output paths: the cook's cwd is the sandbox data/workspace/videos/<slug>. Renders go to data/workspace/renders/<date>-<slug>/ so the existing render-watch (which polls data/workspace/renders for a <date>-<slug> dir with video.mp4) still captures them. From the sandbox cwd that is ../../renders/<date>-<slug>/. The editable project stays in the sandbox cwd itself.
4. Command form: keep the legacy commands/ksa/cooking.md and commands/ksa/serve.md flat-markdown shape (less rewrite than converting to skills/), which --plugin-dir still loads.

## Decisions surfaced to Kai (do NOT finalize autonomously)

- D-CRAFT: the rewritten cooking.md folds ~350 lines of the SHOCK and VO playbooks inline. This is craft content Kai protects; his process is show-it-get-the-yes. The build produces the rewritten command as a reviewable artifact and Kai approves it before it becomes the live cook.
- D-SERVE: vendoring serve.md pulls in its Python IG-publish helper (ig_publish.py), a host script (host_to_web.sh), the .secrets/instagram.env dependency, and its served/Logs/index.md outputs. Where credentials live and whether the cook's /ksa:serve is vendored as-is or replaced by Crowsnest's native publish is a security-sensitive architecture choice for Kai. The build reads these scripts before doing anything and presents the options; it does not silently vendor a credential-handling script.
- D-BRIEF: the exact brief.md markdown shape (below) is a proposed default; Kai confirms the sections.

---

## E2

### Task 1: workspace root off the vault

**Files:**
- Modify: `src/server/config.ts` (add WORKSPACE_ROOT)
- Modify: `src/server/studio/paths.ts` (root from WORKSPACE_ROOT, export rendersRoot)
- Modify: `src/server/terminal/render-watch.ts` (root from the shared helper)
- Modify tests: `src/server/studio/paths.test.ts`, `src/server/terminal/render-watch.test.ts`, `src/server/terminal/ws.test.ts`

- [ ] **Step 1: Add the config key**

In config.ts, in a storage group: `WORKSPACE_ROOT: z.string().min(1).default("data/workspace"),` matching the MEDIA_ROOT idiom.

- [ ] **Step 2: Repoint paths.ts**

Change the private `workspace()` helper to `path.join(config.WORKSPACE_ROOT)` (or resolve it), keeping sandboxDir = `<root>/videos/<slug>` and rendersDir = `<root>/renders/<date>-<slug>`. Export a `rendersRoot()` = `<root>/renders` so render-watch shares one source of truth.

- [ ] **Step 3: Repoint render-watch.ts**

Replace its inline `rendersRoot()` (currently `path.join(config.VAULT_PATH, "Studio", "workspace", "renders")`) with an import of `rendersRoot` from paths.ts.

- [ ] **Step 4: Update the tests**

paths.test.ts and render-watch.test.ts and ws.test.ts mock VAULT_PATH and assert vault workspace paths. Update them to mock WORKSPACE_ROOT and assert `data/workspace/...` paths. Read each test first.

- [ ] **Step 5: The vault-existence guard**

ws.ts:99 checks `existsSync(config.VAULT_PATH)` before creating the sandbox. After E2 the sandbox is not in the vault, but the cook still needs the plugin (E3) not the vault. Change this guard to check the workspace root's parent is creatable (or drop it and rely on mkdirSync), and add a guard that the plugin dir exists once E3 sets pluginDir. For this task, replace the VAULT_PATH existence check with a check that does not block a cook when the vault is absent (the whole point is to leave the vault). Note the change in the report.

- [ ] **Step 6: Verify and commit**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npm run typecheck && npx vitest run src/server/studio src/server/terminal`
Commit: `git commit -m "feat(workspace): move the studio workspace to data/workspace"`

---

## E3

### Task 2: the plugin skeleton and pluginDir

**Files:**
- Create: `plugins/ksa/.claude-plugin/plugin.json`
- Modify: `src/server/terminal/harness-profile.ts` (buildCookProfile sets pluginDir)
- Test: extend harness-profile.test.ts

- [ ] **Step 1: The manifest**

```json
{
  "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
  "name": "ksa",
  "version": "0.1.0",
  "description": "Crowsnest cook and serve commands plus the baoyu skills the cook uses",
  "author": { "name": "Crowsnest" }
}
```

Place commands/ and skills/ at plugins/ksa/ root in later tasks, never inside .claude-plugin/.

- [ ] **Step 2: Point the profile at the plugin**

In buildCookProfile, set `pluginDir` to the absolute path of plugins/ksa (resolve from the repo root, e.g. `path.join(process.cwd(), "plugins", "ksa")`). buildHarnessArgs already emits `--plugin-dir <pluginDir>` when set. Add a config override (COOK_PLUGIN_DIR) defaulting to that path if the file's config pattern makes that clean; otherwise a module constant.

- [ ] **Step 3: Test**

Extend harness-profile.test.ts: buildCookProfile now returns a pluginDir, and buildHarnessArgs emits `--plugin-dir`. Update the E1 test that asserted pluginDir was unset (it is now set).

- [ ] **Step 4: Verify and commit**

typecheck + vitest. Commit: `feat(plugin): ksa plugin manifest, cook profile loads it`

---

### Task 3: vendor the baoyu skills

**Files:**
- Create: `plugins/ksa/skills/baoyu-*/` (the 7 skill dirs)
- Create: `plugins/ksa/commands/ksa/cooking/baoyu-skill-selection.md` (the selection reference cooking.md needs)

- [ ] **Step 1: Copy the 7 skills**

Copy from the vault's real dirs (the vault's .claude/skills/<name> are symlinks into .agents/skills/<name>; copy the real target) into plugins/ksa/skills/:
baoyu-xhs-images, baoyu-cover-image, baoyu-slide-deck, baoyu-image-gen, baoyu-infographic, baoyu-diagram, baoyu-article-illustrator. Source root: /Users/kienbeovl/Desktop/entrepreneur/Kai-Official-OS/.agents/skills/<name>/. Use `cp -RL` to dereference symlinks. Confirm no baoyu-danger-* was copied.

- [ ] **Step 2: Copy the selection reference**

Copy the vault's .claude/commands/ksa/cooking/baoyu-skill-selection.md into plugins/ksa/commands/ksa/cooking/baoyu-skill-selection.md so cooking.md's reference resolves inside the plugin.

- [ ] **Step 3: Verify and commit**

Confirm the 7 dirs each have a SKILL.md. No code, no tests. Commit: `feat(plugin): vendor the 7 baoyu skills the cook uses`. Note the ~1.5MB size in the report.

---

### Task 4: brief.md writer

**Files:**
- Create: `src/server/studio/write-brief.ts` (serialize the studio brief to markdown)
- Modify: the cook-spawn path (ws.ts) to write ./brief.md into the sandbox before the cook starts
- Test: `src/server/studio/write-brief.test.ts`

**Interfaces:**
- Consumes: getStudioBrief(postId) from src/server/queries/studio.ts (and the frame-pass layout, video_kind).
- Produces: `writeBrief(dir: string, postId: string): Promise<void>` that writes `<dir>/brief.md`.

- [ ] **Step 1: Confirm the brief source shape**

Read src/server/queries/studio.ts getStudioBrief and what it returns (source outlier, research, hook, style, outline, script variants, target length, frame-pass layout, video_kind). Read how the studio screen consumes it so the serializer includes the full remix output.

- [ ] **Step 2: The serializer (proposed brief.md shape, D-BRIEF, confirm with Kai)**

```markdown
# Cook brief: <title>

## Source outlier
<the source reel/post the remix is based on>

## Research notes
<research>

## Chosen hook
<hook>

## Style / vault item
<chosen style or vault reference>

## Outline
<outline>

## Script variants
<variants>

## Target length
<seconds>

## Video kind
<video_kind>

## Frame-pass layout
<the frame-pass layout if present>
```

Fill each section from the brief object; omit a section if its data is absent (say so, do not fabricate).

- [ ] **Step 3: Write it before the cook**

In ws.ts, on the fresh-spawn path, after mkdirSync(dir) and before (or as) the cook spawns, call `await writeBrief(dir, postId)`. Guard it so a brief-write failure is logged and does not crash the attach.

- [ ] **Step 4: Test and commit**

Test writeBrief produces a brief.md with the expected sections for a known brief object (mock getStudioBrief). typecheck + vitest. Commit: `feat(studio): write brief.md into the sandbox before the cook`

---

### Task 5: rewrite serve.md into the plugin (D-SERVE, read scripts first, present options)

This task is gated on Kai's D-SERVE decision. Before writing anything: read the vault's serve.md, host_to_web.sh, and ig_publish.py in full and report what they do with credentials and where they publish. Then present two options to the controller: (A) vendor serve.md + its helpers with outputs repathed to data/workspace/served and secrets pointed at Crowsnest's existing secrets store; (B) replace the cook's /ksa:serve with Crowsnest's native publish path. Do not vendor a credential-handling script before the controller rules on D-SERVE.

(Steps deferred pending the D-SERVE ruling; the controller fills them in after reading the scripts.)

---

### Task 6: rewrite cooking.md into the plugin (D-CRAFT, produce for Kai's approval)

**Files:**
- Create: `plugins/ksa/commands/ksa/cooking.md` (the rewritten command)

This is the craft-critical artifact. Produce the rewritten cooking.md but do NOT treat it as final: it is presented to Kai for approval before it becomes the live cook (his process gate for craft content).

Rewrite targets (from the grounding of the vault cooking.md):
- Line 30 input: read ./brief.md in the sandbox (or $ARGUMENTS if given) instead of Studio/workspace/reach/. Drop the "run /ksa:reach first" fallback (that stage does not exist in Crowsnest).
- Lines 18-22, 69, 71: fold the SHOCK-PLAYBOOK sections 0-10 and the VO-SCRIPT-PLAYBOOK sections including the "CADENCE CORRECTION: FLOW, don't chop" supersession, inline, as the craft laws the render sub-agent must follow. Keep the supersession notice explicit. Do not fold the project-specific review section (SHOCK 177-213); fold the rules, not the one-off critique.
- Lines 41, 74, 78 output: renders to ../../renders/<date>-<slug>/ (relative to the sandbox cwd), the editable project stays in the sandbox cwd. Match the render-watch capture convention.
- Line 12: the baoyu-skill-selection.md reference now resolves inside the plugin (Task 3 vendored it).
- Lines 16, 26: drop the [[wikilinks]] and the vault-only "Blueprint" reference, or convert to plain prose. Keep the underlying default logic (video is the default mode until $200) as plain text if it drives behavior.
- Line 71 DESIGN.md: resolve or drop the vault brand-tokens reference; if Crowsnest has its own design tokens the sandbox can reach, point at those, else state the tokens inline.
- Line 52 hyperframes: keep `npx hyperframes skills update`, verify it resolves with the global hyperframes.

- [ ] **Step 1: Produce the rewritten cooking.md with the folded craft laws.**
- [ ] **Step 2: Present it to Kai for approval (controller does this, via the craft-review gate), do not finalize without the yes.**
- [ ] **Step 3: On approval, commit: `feat(plugin): Crowsnest cook command, craft laws folded, reads brief.md`**

---

### Task 7: end-to-end wiring and the vault-out check

- [ ] **Step 1: Confirm discovery**

With pluginDir set (Task 2) and cooking.md in the plugin (Task 6), the cook finds /ksa:cooking from plugins/ksa, not the vault. Confirm buildHarnessArgs emits --plugin-dir and the command name is ksa:cooking (plugin name ksa + command file commands/ksa/cooking.md).

- [ ] **Step 2: The vault-out assertion**

grep the cook path for any remaining VAULT_PATH dependency. config.VAULT_PATH may still exist for other uses; confirm the COOK no longer reads it (paths moved in E2, command moved in E3). Note what still uses VAULT_PATH, if anything.

- [ ] **Step 3: Live smoke (manual, with Kai)**

A real studio cook: brief.md is written, /ksa:cooking resolves from the plugin, the render lands in data/workspace/renders and is captured. This is the manual gate; it cannot be unit-tested.

## Self-review notes

- E2 is mechanical and safe. E3 splits into mechanical (scaffold, vendor, brief.md, pluginDir) and decision-gated (serve architecture D-SERVE, craft fold D-CRAFT).
- The combined branch keeps the cook working: E2 moves the sandbox, E3 restores command discovery via the plugin. Neither alone is shippable.
- brief.md is the load-bearing new artifact (B4); its shape is a proposed default pending Kai.
- serve.md and cooking.md carry Kai-facing gates by design; do not autonomously finalize the craft fold or vendor the credential script.
