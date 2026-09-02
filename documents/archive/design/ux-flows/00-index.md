# Crowsnest UX flows, for annotation

Drafted 2026-07-28 by four agents working in parallel, after a sixteen point design interview with Kai. 36 flows across four files. Every flow is written as Entry, Screen, Actions, System, Failure, Empty, and an Open question where one exists.

Read them as proposals, not as documentation. Roughly a third of what is described does not exist in code yet, and each flow says which state it is in.

## The files

| File | Flows | Covers |
|---|---|---|
| 01-coldstart-channels.md | A1 to A4, B1 to B6 | first run, connecting the burner, connecting the owned channel, binaries, adding and syncing channels, failure and recovery, fleets |
| 02-feed-video.md | C1 to C4, D1 to D6 | browsing and filtering outliers, presets, previews, video detail, playback, analysis with frames, similarity, saving to Vault, prompt export |
| 03-vault-remix.md | E1 to E3, F1 to F4 | template library, the five stage remix pipeline, editing and saving scripts |
| 04-ownchannel-system.md | G1 to G5, H1 to H4 | own channel numbers, the comparison view, the three deferred reports, settings, command palette, the Claude Code pane, the MCP tool surface |

## What was settled before these were written

The interview closed fourteen of sixteen questions. These are the ones that shaped every flow below.

- v1 is for Kai alone. Local, single user, no auth, no tenancy. A sellable version is deferred, recorded in `docs/adr/0001`.
- Instagram only. Feature parity with Sandcastles is the goal. Matching their pixel design is not, since nobody has seen the product. Matching their corpus is not, since that is a company with servers.
- Nothing gets cut from the loop. The north star is: find a viral video, take its hook and script and layout, regenerate it in Kai's own style.
- The UI is the primary interface. MCP comes second.
- Sync runs in staggered batches of the three to five stalest channels, not all at once.
- Text generation runs on the free local 9router proxy. Vision and heavy work runs on Claude Code. Claude Code is also the fallback when the proxy fails.
- Layout is read from video frames, extracted by the watch skill's script, never guessed from the transcript.
- Own channel numbers come from the Instagram Graph API using a token copied into this project's `.env.local`. The burner and the owned account never cross.

## What is still open, and needs a decision in these pages

1. Does the owned channel live in the `channels` table with a source marker, which puts Kai's own posts into the Feed and into outlier scoring, or in a separate table? Raised in A3.
2. Does the deep first sync (90 days on first contact, 30 after) land, and what counts as a first sync? Raised in B2.
3. Which of the 13 proposed MCP tools earn a place in v1. Raised in H4.
4. Whether to spend $49 on one month of Sandcastles to see the product being cloned.

## Defects found while drafting

These are bugs in code that exists, not design questions. They were found by reading the source, and each names its location.

- Vault slot chips are cosmetic. `{topic}` renders as a chip but the template text is passed verbatim to the model, so the model reads the literal characters. Every template with a slot feeds noise into generation. (E2, F2)
- Analysis can never be re-run. `getOrCreateAnalysis` returns the cached row and nothing deletes it. The one analysis on file was made from a transcript alone with invented style tags, and under current code it is permanent. (D3)
- The Feed lies about its own filter state. A bare `/feed` applies `minScore: 5` server side while the score select reads only the URL and displays "Any score". (C1)
- Create Prompt on the Script stage exports the source video, not the draft the user just wrote. (F4)
- `MEDIA_RETENTION_DAYS` is validated at boot and documented in the README, and no code reads it. Nothing ever deletes a downloaded video. (D2)
- A saved script cannot record which Vault hook seeded it, so `hookVaultItemId` is always null. Already known, listed in the README. (F3)

## How to annotate

Mark anything wrong, missing, or not worth building. The open questions are the highest value places to leave an opinion, since they are blocked on a decision only Kai can make. Approved flows go to Claude Design on desktop for the visual pass.
