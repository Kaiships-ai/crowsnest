---
name: cn-remix
description: >
  Crowsnest analyze-to-script workflow from Claude Code: scout the outlier feed,
  inspect a candidate's analysis, then remix it into a saved script and a planned
  post through the crowsnest_* MCP tools, with a human gate at every real choice.
  2 phases, 12 MCP calls, 5 human gates.
  Trigger: /cn-remix
---

# Crowsnest analyze-to-script (cn-remix)

Take one outlier from the Crowsnest feed and turn it into a saved script and a planned post, from Claude Code, using the crowsnest MCP tools. This stops at the script. Generating the video (HyperFrames) and publishing are separate.

## Before you start

- Run the `crowsnest-up` skill first. It brings up the 9router LLM proxy (`LLM_BASE_URL`, port 20128), the dev server on localhost:3000 (which serves the `crowsnest_*` MCP tools), and a connected browser.
- Without the proxy the generation steps (hooks, outline, variants) fail. Research and the reads still work without it.

## Inputs

- Feed filters (optional): `minScore`, `followerBand`, `sinceDays`, `query`. Default to a high `minScore` and `analyzed: "yes"` unless the user says otherwise.
- The picked video id, decided at gate 1.
- The topic, the angle, and the target length, from the user at gate 2.

Ask the user for anything not obvious from the request.

## Output

A review file at `docs/remix-reviews/{postId}.md`, written in step 2f, that you and the user read together before the video step. It carries the saved `scriptId` and `postId` inside, plus the full script and the context to judge it. The file has two kinds of content: context to read, and review sections that each end with a `Decision:` line the human fills.

Layout of the review file:

```
# Remix review: {source handle} to {script title}

## Context (read-only)
- Source outlier: handle, url, outlier score, views, why it worked, hook type
- Grounding: the research the generation used (source beats, similar outliers, the user's facts)
- Ids: sessionId, scriptId, postId, source videoId

## 1. Hook
The chosen hook, then the rejected options.
Decision: keep / swap ->

## 2. Script
The chosen variant, full text.
Decision: approve / revise ->

## 3. Structure and beats
The outline the script follows.
Decision: holds for video / re-cut ->

## 4. Length and format
Target length and the suggested video kind or platform.
Decision: right / change ->

## 5. Niche and voice fit
Does it sound like the user, on brand.
Decision: on brand / adjust ->

## 6. Originality and fact-check
Claims to verify, and how close it sits to the source (not a copy).
Decision: cleared / flag ->

## Recommendation
Claude's call: ready for the video step, or revise, with the reason.

## Decision checklist
- [ ] Hook
- [ ] Script
- [ ] Structure
- [ ] Length and format
- [ ] Niche and voice
- [ ] Originality and fact-check
```

No video, no schedule, no publish. Those are separate steps.

## Phase 1: Analyze and pick (HUMAN GATE)

### 1a: Scan the feed

- Call `crowsnest_feed` with the user's filters.
- Read the top items: `outlierScore`, `channel.handle`, `caption`, `viewCount`.

### 1b: Inspect candidates

- Call `crowsnest_video(videoId)` on the real candidates for the analysis: hook type, why it worked, the structure beats, the transcript.

### 1c: Pick one (HUMAN GATE)

- Present the top 3 to 5 candidates with score and why-it-worked.
- Wait for the human to pick the outlier before proceeding. Do not pick for them.

## Phase 2: Brief and script

### 2a: Open the session and set the prompt (HUMAN GATE)

- `crowsnest_remix_session(videoId)` returns the session id. One session per video, so this reuses an existing session if the video was remixed before. Warn the user that its old topic, hooks, and variants will be overwritten; there is no separate new-session path.
- `crowsnest_remix_set_prompt(sessionId, topic, targetLengthSec)`.
- Wait for the human to confirm the topic, the angle, and the length before generating anything.

### 2b: Research (no proxy)

- `crowsnest_remix_research(sessionId)`. Read the source analysis and the similar outliers back to the user so they see what generation draws on.

### 2c: Hooks (HUMAN GATE)

- `crowsnest_remix_hooks(sessionId, steer?)` returns the hook options. Pass a `steer` note for a different angle.
- Wait for the human to pick a hook, then `crowsnest_remix_choose_hook(sessionId, hook)`.

### 2d: Style and outline

- `crowsnest_remix_style(sessionId, styleVaultItemId?)`. Omit the id to use the source video's own structure.
- `crowsnest_remix_outline(sessionId, steer?)`. Read the beats back. The user can steer with a note and you regenerate.

### 2e: Variants (HUMAN GATE)

- `crowsnest_remix_variants(sessionId, steer?)` returns three. A failed variant comes back as an error at its slot; regenerate just that one with `crowsnest_remix_regenerate_variant(sessionId, index, steer?)`.
- Wait for the human to pick one variant by index. Do not pick for them.

### 2f: Save, finish, and write the review

- `crowsnest_remix_save_script(sessionId, variantIndex, title)` returns the script id.
- `crowsnest_remix_finish(sessionId)` returns the planned post id (an undated draft).
- Write the review file at `docs/remix-reviews/{postId}.md` in the layout under Output. Fill the context from the session state and `crowsnest_video`; put the chosen variant in section 2 and the rejected hooks and the other variants in sections 1 and 6; write your own recommendation. Leave every `Decision:` line blank for the human.
- Present the file and walk the six review sections. The remix is not done until the user has filled the decision checklist.

## Error handling

- A generation call returns a connection error: the LLM proxy is down. Stop, tell the user to start it, do not retry blindly.
- `crowsnest_remix_session` reused a session: warn before overwriting the old fields.
- A variant slot is an error: regenerate that one slot, keep the others.
- The human rejects at a gate: adjust (a steer note, a different filter) and re-present. Do not push past a gate.
- Nothing worth remixing: widen the filters (lower `minScore`, wider `sinceDays`) and rescan.

## Quick reference

| Phase | MCP steps | Human gate | Output |
| --- | --- | --- | --- |
| 1. Analyze and pick | feed, video | Yes, pick the outlier | chosen videoId |
| 2a. Prompt | session, set_prompt | Yes, topic and angle | sessionId |
| 2b. Research | research | No | research notes |
| 2c. Hooks | hooks, choose_hook | Yes, pick the hook | chosen hook |
| 2d. Style and outline | style, outline | No | outline beats |
| 2e. Variants | variants, regenerate | Yes, pick the variant | three variants |
| 2f. Save, finish, review | save_script, finish | Yes, sign off the review file | review file, scriptId, postId |

Total: 2 phases, 12 MCP calls, 5 human gates (4 in-flow picks plus the final review).
