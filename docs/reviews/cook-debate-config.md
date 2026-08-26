# Cook debate: CONFIG lens

Scope: the harness profile in section 06 of `crowsnest-cook-bigpicture.html`, and how it maps to real `claude` flags. Grounded against the live binary (`claude --version` reports 2.1.231, matching the doc's citation), `src/server/terminal/session.ts`, `src/server/studio/paths.ts`, and the real `Kai-Official-OS/.claude/commands/ksa/cooking.md`, plus a walk of the actual skill directories on disk. Nothing below is theoretical; every claim was checked against a file or a command output.

## Ranked findings, worst first

### 1. Vendoring hyperframes fights its own update mechanism

`cooking.md` line 52 has the cook run `npx hyperframes skills update` before every video build, "for freshness only." That line only makes sense if hyperframes assumes it lives in one well-known place that a package-manager-style command keeps current. It does: today that place is `~/.claude/skills/hyperframes*`, seven directories, roughly 3 MB total (`hyperframes`, `-cli`, `-core`, `-creative`, `-animation`, `-keyframes`, `-registry`), maintained as a live suite outside both Crowsnest and the vault.

Copy that into `crowsnest/harness/plugin/skills/` and one of two things happens: the updater keeps refreshing the global copy while the cook actually reads the frozen plugin copy (silent staleness, the render quality regresses without any error), or someone repoints the updater at the plugin directory and now Crowsnest's "vendored, versioned" copy auto-mutates outside any commit, which defeats the entire point of vendoring. Either way this is a functional break, not a tidiness question, and video is the declared default format (cooking.md line 26: Reels out-reach carousels roughly 13x on this account), so this hits the majority path.

Alternative: keep hyperframes at user level, exactly where its own tooling expects it, and have the Crowsnest plugin depend on it being present rather than owning a copy. If the founder wants a version boundary, pin a hash of `hyperframes --version` (or equivalent) that the harness checks at cook start and refuses to run against a version it has not been tested with. That gets "no silent drift" without breaking the updater's contract.

### 2. `--setting-sources user` will also drop Crowsnest's own project hooks, not just the vault's

This repo already has a project `.claude/settings.json` (checked directly): a `PreToolUse` hook on `Write|Edit` running `humanizer-doc-check.sh`, a `UserPromptSubmit` hook running `humanizer-context.sh`, and a `settings.local.json` enabling the `humanizer@humanizer` plugin. Those are project-level settings, same category as the vault's `SessionStart` hook the profile is trying to kill.

The doc's own roadmap (E2) plans to move `data/workspace` inside the Crowsnest repo. Once a cook's cwd is a subdirectory of this repo, `--setting-sources user` does not selectively drop "the vault's hooks." It drops every project-level setting reachable from that cwd, including Crowsnest's own. Today that is invisible because the profile is designed against a vault cwd where dropping project settings is exactly what you want. After E2 it is a silent behavior change: a cook session that writes a markdown file (a brief, a caption, a log entry) skips the same humanizer check every other write in this repo enforces, and nobody decided that on purpose.

This is not an argument against the flag, it is an argument that E1's spec needs an explicit line for E2: either the profile force-adds `--settings` for the specific Crowsnest hooks it still wants, or someone accepts in writing that cook sessions are exempt from them. Right now the doc treats "user" as a synonym for "not vault," and after E2 that stops being true.

### 3. "All baoyu skills" is a bigger, blurrier surface than the plan accounts for

The doc's skills table (section 05) lists "baoyu*" as one row, "carousel and image generation for the post branch." On disk, `baoyu-*` is not one skill, it is 21 separate skill directories in the vault, and they exist in *two* divergent trees at once: `Kai-Official-OS/.claude/skills/baoyu-*` and `Kai-Official-OS/.agents/skills/baoyu-*` (confirmed both exist, are not symlinked, and are not identical directory listings). The cook's own reference doc, `cooking/baoyu-skill-selection.md`, names `.agents/skills/` as canonical and uses exactly 7 of the 21: `baoyu-xhs-images`, `baoyu-cover-image`, `baoyu-image-gen`, `baoyu-infographic`, `baoyu-diagram`, `baoyu-article-illustrator`, `baoyu-slide-deck`. The other 14 include `baoyu-post-to-wechat`, `baoyu-post-to-weibo`, `baoyu-post-to-x`, `baoyu-translate`, and two skills literally named `baoyu-danger-gemini-web` and `baoyu-danger-x-to-markdown`, none of which the cook ever touches.

"Vendor all skills into Crowsnest" as stated either over-copies (pulling in unrelated posting/translation tools and two skills the vault authors flagged as dangerous enough to name that way) or requires someone to hand-pick the 7 that matter, at which point it is no longer "all skills," it is a curated subset that will quietly stop matching the vault's picks the next time `baoyu-skill-selection.md` adds an 8th mapping. Given there are already two un-synced copies inside the vault itself, a third copy inside Crowsnest is a near-certain drift source, not a hypothetical one.

Alternative: vendor the 7 named skills, explicitly, as a pinned list checked into the plugin, not a directory glob. Treat any future addition to `baoyu-skill-selection.md` as a deliberate PR into Crowsnest's plugin, not an automatic pickup. That is more honest about the actual maintenance cost than "all skills."

### 4. A denylist is the wrong posture for a `bypassPermissions` session

`scrubClaudeEnv()` (in `src/server/services/claude-task.ts`) is a regex denylist: `TOKEN|SECRET|PASSWORD|_KEY$|SESSIONID|CROWSNEST_DB_PATH|DATABASE_URL`. `session.ts` reuses this same function for the interactive terminal and bolts on an extra `CLAUDE_CODE_*` strip, and the cook profile in the doc keeps `--permission-mode bypassPermissions`. A denylist only catches secrets whose name matches a pattern someone thought of in advance. It has already had a name-shape blind spot fixed once (the `CLAUDE_CODE_*` patch, added specifically because the original denylist missed a class of variable), which is itself evidence the pattern under-catches over time.

For a low-privilege, read-only, tool-allowlisted caller (the frame-pass use in `claude-task.ts`, `--allowedTools Read`) a denylist is a reasonable, cheap safety net. For a session that bypasses permissions entirely and can read and write anything the process user can touch, the blast radius of one missed variable is the whole box, not one file. Recommend an allowlist for the bypass-permissions path specifically: `PATH`, `HOME`, `TERM`, `LANG`, plus the two or three names the cook is known to need, and stop reusing `scrubClaudeEnv()` unmodified for both risk tiers.

### 5. The profile count is undercounted by roughly 4x

Section 06's "Profile select" row says `video_kind` picks between two profiles, "video vs post." But `cooking.md`'s own routing table (step 3v) maps `video_kind` to eight distinct HyperFrames workflows: `explainer`, `site-tour`, `product-promo`, `music-video`, `pr-announcement`, `talking-head`, `slideshow`, `general`, each naming a different underlying workflow skill. If a "profile" is meant to declare exactly which skills get mounted for a session (the doc's own stated goal, "declared, not discovered"), the real number of distinct profiles once E3 vendors per-workflow skills rather than the whole hyperframes suite is closer to 9 (8 video kinds plus post) than 2.

At 2-3 branches, a switch statement in `harness.ts` is fine. At 9, it is a pile nobody reviews carefully, and the doc does not say where this config lives (code, JSON, DB) or who is allowed to edit it, both questions the task brief specifically raised and the doc leaves open. Recommend deciding this in the E1 spec, not deferring it: JSON with a schema check that fails closed (refuse to spawn rather than spawn with a guessed default) is the safer choice once past single digits, specifically because a bad profile edit under `bypassPermissions` is not a minor bug, it is an unreviewed session with filesystem access.

### 6. No version guard on a flag set that is already known to be order-sensitive

Every flag in section 06 checks out against `claude --help` on 2.1.231, confirmed live in this review. That part of the doc is accurate today. But `DEFAULT_BINARY` in both `session.ts` and `claude-task.ts` is a hardcoded absolute path with no version pin, and this codebase already has a documented instance of the CLI being flag-order-sensitive enough to break silently: the comment in `claude-task.ts` warns `--allowedTools` must stay last because it "greedily consumes every following token" and will swallow whatever comes after it. A profile with `--model`, `--plugin-dir`, `--setting-sources`, `--mcp-config`, `--permission-mode`, and `--append-system-prompt` all in one spawn call is exactly the kind of multi-flag surface where an upgrade that changes one flag's arity turns into a silently wrong session rather than a clean error.

Recommend a `claude --version` (or `--help` hash) check at harness startup that fails closed with a readable message, instead of letting a changed CLI surface a raw parse error in the studio terminal pane.

## Answering the direct questions

**`--plugin-dir` versus project-level `.claude/commands` + `.claude/skills` versus a marketplace entry:** `--plugin-dir` is the right call, and it is the part of this proposal I would not push back on. Project-level commands/skills only resolve because of cwd-based discovery, which is the exact ambient-loading behavior the whole redesign exists to kill (see today's step 3 in section 03: "implicit discovery... because of the cwd"). `--plugin-dir` is explicit and survives `--setting-sources user` because plugin loading is a separate mechanism from settings resolution. A marketplace entry is real overhead (a manifest, a publish step, a registry) for a plugin with exactly one installer; skip it unless a second consumer shows up. One gap: every real plugin on this machine (`humanizer`, `visual-explainer`) ships a `.claude-plugin/plugin.json` manifest, and the doc's directory tree in section 04 does not show one. That is a checklist item for E3, not a flaw in picking `--plugin-dir`.

**`--bare` as an alternative to `--setting-sources user`:** disqualified, and worth stating plainly since the question was raised. `claude --help` on this machine says `--bare` requires auth "strictly ANTHROPIC_API_KEY or apiKeyHelper... OAuth and keychain are never read." The founder is on Claude Max (section 06: "opus 4.8 (Claude Max)"), which authenticates via OAuth/keychain, not an API key. `--bare` would silently force a switch from flat-rate subscription billing to metered API billing, or simply fail to authenticate. `--setting-sources user` is correct precisely because it does not touch auth, only settings resolution.

## Where I would deviate from "everything owned by Crowsnest"

Two places, and I would say so directly to the founder rather than soften it:

- **hyperframes stays at user level.** It was never vault-owned to begin with (it already lives in `~/.claude/skills/`, shared across contexts, with its own updater), so "get it out of the vault" does not require "put it inside Crowsnest." Vendoring it achieves the opposite of the stated goal (freshness and correctness) for a suite that was already outside the thing being decoupled from.
- **baoyu vendoring should be an explicit 7-item pinned list, not "all skills."** The founder's instinct ("all skills into Crowsnest, project-level, no vault") is right in spirit, wrong in scope as literally stated, because "all baoyu skills" is 21 directories in two disagreeing trees, most of which the cook has never touched.

Everything else in the profile (`--model`, cwd, `--plugin-dir`, `--permission-mode`, `--mcp-config`, `--append-system-prompt`, the Crowsnest-side env scrub and watchdog) is sound in shape; the fixes are in the details above, not the architecture.

## Biggest concern and strongest endorsement

**Biggest concern:** finding 1 and 2 together. Vendoring hyperframes can degrade render quality with no error message, and the settings-sources flag can silently disable Crowsnest's own hooks the moment E2 lands, and neither failure mode produces a crash a founder would notice, they both produce output that is quietly worse than it should be. Silent degradation is a worse failure class than a hard stop for a founder who is not reading the spawn args on every run.

**Strongest endorsement:** the core move, from "commands and skills load because the cwd happens to be inside the vault" to "commands and skills are declared on the spawn line via `--plugin-dir`, and hooks are killed by `--setting-sources` rather than by scrubbing env vars after the fact," is the correct fix for the actual bug (the `load_vault_context.py` hook firing where it should not). That mechanism is right. The disagreement in this review is entirely about what gets copied into the plugin and how it is kept honest against its sources, not about whether to build the plugin.
