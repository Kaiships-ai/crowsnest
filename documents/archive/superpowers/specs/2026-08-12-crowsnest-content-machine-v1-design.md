# Crowsnest content machine v1

Turn Crowsnest from a research tool into an end-to-end content machine: research the niche, brief it, create the video, publish, measure your own reach, repeat. Kai-Official-OS stays the craft and ops layer. Publish and the LLM proxy are reused, not rebuilt.

Visuals (the real spec surface, read these first):
- High-level stack: ~/.agent/diagrams/crowsnest-highlevel-stack.html
- Screen wireframes, before and after: ~/.agent/diagrams/crowsnest-v1-wireframes.html

## Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| KSA move-in | Orchestrate, not absorb | Creation stays a Claude Code + HyperFrames job; Crowsnest drives it. No re-hosting an agent runtime. |
| Create runtime | Embedded Claude Code at full power | A terminal or sidebar pane inside Crowsnest, not a headless subprocess. Kai steers it. |
| Craft context | Vault is the create session's cwd, read-only | SHOCK/VO playbooks, brand, frame-packs read in place. Nothing copied. |
| Publish | Reuse the Graph path (ig_publish) | Official Instagram Graph API, one-click, no ban risk. instagrapi sidecar stays read-only. |
| LLM | 9router powers Crowsnest's own analysis + remix + ideas | Create runs Claude Code on Claude Max, not 9router. |
| Create sandbox | One per-post project folder (by slug) | Cheap isolation, matches KSA's own file layout, no mess across the vault. |
| Storage | AssetStore seam now (put/get/publicUrl), local disk behind it | Object store deferred; swap is a config change later. |
| Object store (later) | Cloudflare R2 | S3-compatible, public URLs replace the Vercel hosting step, free egress, nothing to run. |

## The loop

Research (competitor outliers) to Brief (script + frame pass visual layout) to Create (embedded Claude Code + HyperFrames) to Publish (Graph) to Measure (own reach). Measure feeds Research: what got reach decides what to make next.

## Scope

In v1:
- Planned post gets a video_kind picker (default explainer) and a Create in Studio button.
- New Create studio screen: brief pane, embedded Claude Code pane, output pane with one-click Graph publish.
- Create session harness and per-post sandbox.
- AssetStore seam with a local-disk implementation.
- Publish reuses ig_publish; published post auto-records on the /mine calendar.

Out of v1:
- MinIO or R2 build (seam only).
- Hermes and any Telegram path.
- Carousel (post) branch. Video reel only.
- Auto-running the create step. Kai opens the studio and steers.
- U6 MCP server.

## Screens

Three, detailed in the wireframe file.

1. Planned post (/mine, plan dialog). Change: add the video_kind picker and the Create in Studio button. Everything else stays.
2. Create studio (new, /mine/<post>/studio). Three panes: the brief (read from the planned post), the embedded Claude Code session, and the output preview plus publish.
3. Publish and measure (reuse /mine). The published post is auto-recorded on the calendar; its reach is what the flywheel reads. No new screen.

## The create session harness

The embedded Claude Code session is full power but bounded:
- One job per run: run /ksa:cooking on this brief.
- cwd is a per-post project folder (Studio/workspace/videos/<slug>).
- The vault is available read-only for craft (playbooks, brand, frame-packs).
- Writes are confined to the project folder and KSA's renders path (Studio/workspace/renders/<date-slug>).
- On finish, Crowsnest captures the rendered MP4 path back onto the planned post.

Embed mechanism (decided): an in-page web terminal. A server-side node-pty spawns the Claude Code CLI with cwd set to the per-post sandbox, and streams it to an xterm.js terminal in the studio page over a websocket. The plan resolves the Next 16 specifics (custom server or a sidecar ws process, node-pty native build, how claude is invoked so it stays steerable, and the permission posture for the spawned session).

## Publish

Reuse the existing Graph publish helper (ig_publish.py in Kai-Official-OS): a Graph token, an IG Business or Creator account on a Facebook Page, media served from a public HTTPS URL. The AssetStore.publicUrl is what provides that URL. v1 keeps the current hosting path; the R2 backend later serves the public URL directly and drops the Vercel step. The instagrapi sidecar is never used to publish.

## AssetStore seam

A small interface in front of storage so the object store is a later config change, not a rewrite:
- put(bytes, kind) returns an id (content-addressed, reuse the existing media_assets sha256 dedup).
- get(id) returns the bytes or a local path.
- publicUrl(id) returns a public HTTPS URL for Graph publish.

v1 implementation: local disk plus the current hosting path for publicUrl. Later implementation: Cloudflare R2 (public bucket serves publicUrl directly).

## Acceptance

From a planned post that carries a script:
1. Open the Create studio.
2. The embedded Claude Code session runs /ksa:cooking on the brief in a per-post sandbox and produces an MP4.
3. One-click publish posts it through the Graph path.
4. The post is auto-recorded on the /mine calendar.
5. Own-channel reach is measured on /mine and is available to the research step.
