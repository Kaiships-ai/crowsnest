---
description: KSA Serve - take an approved /ksa:cooking asset (carousel OR Reel video), get one approve/hold, then auto-publish it to Instagram via the ig_publish helper - or produce a post-ready bundle for manual posting if auto-publish isn't wired.
argument-hint: "[optional asset folder name]"
allowed-tools: AskUserQuestion, Bash, Read, Write, Glob, Grep
---

# /ksa:serve

Publish an approved asset (carousel or Reel). Cadence: after /ksa:cooking approval.
One human step only: approve. Then Claude publishes automatically. All prompts use AskUserQuestion.

Publishing is outward-facing and hard to undo - the approve gate is a HARD gate.

This command runs from the Crowsnest ksa plugin. Its cwd is the per-post sandbox
(`data/workspace/videos/<slug>`), and the finished renders sit next to it at
`data/workspace/renders/<date>-<slug>/`, which is `../../renders/` from the sandbox.
The two helper scripts are bundled in the plugin at
`${CLAUDE_PLUGIN_ROOT}/commands/ksa/serve/`.

## Steps

1. **Pick the asset.** Read `../../renders/` (the Crowsnest renders dir, `data/workspace/renders/`). If `$ARGUMENTS` names a folder, use it; else AskUserQuestion to pick which approved asset folder to serve. If none, tell Kai to run `/ksa:cooking` first.

2. **Detect asset type.** `video.mp4` present -> Reel path. `slide1.jpg` (2-10 slides) -> carousel path. Grab `caption.txt` either way.

3. **Path check.** Auto-publish needs two things wired: an Instagram Graph token and Vercel CLI access. The token is read by the helper from an env file: by default it walks up from the helper's location looking for `.secrets/instagram.env`, but from the plugin that walk does not reach Kai's token, so set `IG_ENV_PATH` to the absolute path of the `instagram.env` file (for example the vault's `.secrets/instagram.env`, or wherever Crowsnest keeps it). Vercel needs `vercel login` or `VERCEL_TOKEN`. Check both. If either is missing, skip to the **manual bundle path** (step 8) - that is still a full, valid publish, just not hands-off.

4. **Host on public URLs** (auto-publish path only). The publish API needs public HTTPS URLs. Host via the bundled helper (copies into the website repo, deploys via Vercel CLI, waits for HTTP 200, prints URLs in the order passed):
   ```
   ${CLAUDE_PLUGIN_ROOT}/commands/ksa/serve/host_to_web.sh <slug> <files...>
   ```
   - carousel: pass `slide1.jpg ... slideN.jpg`.
   - Reel: pass `video.mp4 cover.jpg`.
   The helper targets Kai's website repo by default (override with `IG_WEB_REPO` and `IG_WEB_BASE_URL`). If deploy errors, tell Kai to auth Vercel. Collect the printed URLs.

5. **CTA check.** Capture runs on **ChatbotX** (self-hosted on Kai's M1), not ManyChat - ManyChat was dropped 2026-07-13. Two flows are live and verified firing as of 2026-07-23: **PACK** (free starter pack) and **MACHINE** (the Content Machine Kit). Confirm the caption's keyword matches a flow that is actually live and that the keyword appears exactly once. If the keyword has no live flow, warn: the post will not capture leads. Do not block.

6. **Publish-approval gate (HARD).** AskUserQuestion: "Publish this to Instagram now? Public, hard to undo." options `Publish` / `Hold`. If Hold, stop and change nothing.

7. **Auto-publish** (bundled helper; never echo the token - it reads the env file resolved in step 3):
   - **carousel:**
     ```
     python3 ${CLAUDE_PLUGIN_ROOT}/commands/ksa/serve/ig_publish.py publish --caption-file <asset>/caption.txt --images <url1> <url2> ...
     ```
   - **Reel:**
     ```
     python3 ${CLAUDE_PLUGIN_ROOT}/commands/ksa/serve/ig_publish.py publish-reel --caption-file <asset>/caption.txt --video <mp4_url> --cover <cover_url>
     ```
   Both return JSON `{media_id, permalink}`. Reels take longer (video processing) - the helper polls up to ~6 min. Record the result (platform, type, time, media_id, permalink) to `../../served/YYYY-MM-DD-<slug>.md` (the Crowsnest served dir, `data/workspace/served/`) and stop.

8. **Manual bundle path** (no token or no Vercel wired). Assemble `../../served/YYYY-MM-DD-<slug>-bundle/`: copy the media files + `caption.txt`, and write a short `POST-THIS.md` explaining what to post where. Tell Kai to post it by hand from phone/desktop - this counts as publishing; the token just makes it hands-off. Still record it to `../../served/YYYY-MM-DD-<slug>.md`.

9. **Handoff - measure it.** Publishing without measuring loses track of what is live. Tell Kai to run **`/ksa:measure`** now for a baseline, and again roughly 48 hours later once reach has settled. A served record with no performance data is an incomplete record.

## Notes
- Token maintenance: `python3 ${CLAUDE_PLUGIN_ROOT}/commands/ksa/serve/ig_publish.py refresh` before the 60-day expiry (set `IG_ENV_PATH` first so it rewrites the right file). Quota: `... limit`.
- Never print or commit the access token. The env file it reads stays outside this repo and is gitignored where it lives.
- **Every publish MUST leave a served record** at `../../served/YYYY-MM-DD-<slug>.md`, on both the auto and the manual path.
