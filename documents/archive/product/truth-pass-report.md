# Truth pass report

Written 2026-07-31. Wave 0, frontend team. Scope: rendering layer only, no schema
changes, no new server actions.

## Removed

1. TikTok and YT Shorts platform chips. Took the two options out of
   `PLATFORM_OPTIONS` in `filter-bar.tsx` (kept All and IG), removed the tiktok and
   youtube_shorts icon branches from `PLATFORM_META` in `platform-chip.tsx`, and
   removed the dead TikTok/YouTube URL builders from `channelProfileUrl` in
   `channel-header.tsx` (it now always builds the Instagram URL). The `platform`
   column in `schema.ts` was not touched, per instruction, since it sits inside two
   unique indexes and is the seam for a later platform.

2. The platform chip icon on the feed card. `v1-scope.md`'s P0 truth pass table
   calls this out by name: with one platform the chip carries zero information, and
   the prototype has no platform chip anywhere, so removing it moves toward the
   prototype. Removed the `PlatformChip` render and its import from
   `outlier-card.tsx`. Left it in place on `video-detail.tsx` and
   `quick-preview-sheet.tsx`, which were not named in either doc.

3. The feed card bookmark button (`outlier-card.tsx`). Tooltip said "Save to
   Vault" and the button was a link to the video page that saved nothing. There is
   no save-from-feed path because saving requires an analysis, which only exists on
   the video detail page. The thumbnail is already a link there, so nothing was
   lost by removing it.

4. Untrack controls. Removed the disabled "Untrack" button and its tooltip from
   `channel-header.tsx`, and the "Untrack" dropdown item that fired a toast from
   `channel-table.tsx`. No remove-channel action exists anywhere in `src/`.

5. The niche keywords input on the Settings page (`niche-profile-section.tsx`).
   Persisted to `app_settings.niche_keywords` and was read back only to repopulate
   its own field; no generation prompt or query in the app ever reads it. My call
   was to remove the field rather than keep it with a disclaimer, because the
   brief's rule is absolute ("a capability the app does not have does not appear in
   the interface at all") and a keyword input sitting next to a real Description
   field reads as configuration either way, disclaimer or not. I kept
   `initialKeywords` threaded through the component and send it back unchanged on
   every save, so the existing stored value is not wiped by this change, just no
   longer shown or editable.

## Reworded

6. Remix hook textareas (`stage-hook.tsx`). The five generated hooks used to
   render in editable `Textarea` fields whose edits never reached the server and
   were lost on reload. Replaced each with a plain, non-editable paragraph styled
   to match the old field's look. "Use this hook" is now the only way to commit a
   hook, same as before, but the UI no longer pretends an edit will stick.

7. Script generation progress (`stage-script.tsx`). Removed the five hardcoded
   strings ("Writing variant 2...", etc.) that cycled on a 1200ms timer against one
   atomic server call with no incremental signal. Replaced with a single honest
   label, "Writing script...", shown for the whole wait alongside the existing
   skeleton rows. `DEFAULT_COUNT` is still a fixed constant of 3 (there is no
   variant-count control anywhere in the app for it to disagree with), so removing
   the false claim about a specific variant number was the fix.

8. "Use in Remix" on a manual template (`template-card.tsx`). The old fallback for
   a template with no source video told the user to press Cmd K and pick a video;
   the command palette only lists five nav routes and cannot search videos, so the
   instruction could never be followed. Remix always starts from a source video
   (`/feed/[videoId]/remix`), and a manually created template has none, so there is
   nothing for the button to do in that case. The button is now only rendered when
   `item.sourceVideo` exists.

9. Stale transcription string (`quick-preview-sheet.tsx`). "No transcript yet -
   transcription arrives with the phase-2A sync engine" said the opposite of the
   video detail page, where transcription is live. Changed to "No transcript yet -
   open the full page to transcribe."

10. "1 results" (`feed/page.tsx`). Added the singular/plural branch so a single
    match reads "1 result."

11. Unreadable caption overlay (`outlier-card.tsx`). The old scrim was a
    three-stop gradient tuned to fade fully transparent across the card's middle,
    exactly where the headline sits, so a bright thumbnail put white text on
    near-white. Removed the gradient entirely and gave the headline its own opaque
    backing plate (`bg-black/70` with a blur, sized to the text block) instead.
    This is correct against any thumbnail brightness, not just the one screenshot
    that surfaced the bug.

## Found but not on the list

- `src/server/providers/types.ts`, `src/server/queries/feed.ts`, and the comment
  on `schema.ts:36` still carry the `"instagram" | "tiktok" | "youtube_shorts"`
  union. Left alone: these are internal types, not a rendering-layer control, and
  match the doc's own reasoning for keeping the schema column multi-valued.
- `api-key-status-card.tsx` has a permanently-disabled icon button next to the
  presence-only API keys. Checked it: it is a tooltip anchor for an "info" glyph,
  not a control that claims to do something and does not. Left it alone.
- No other unconditional `disabled` controls or raw-zero-for-missing-data
  displays turned up in a pass over `src/components/settings/`,
  `src/components/vault/`, and the dashboard/channel-detail stat components; the
  existing `formatCompact`/`formatMultiplier` helpers already render a dash for
  null values project-wide.

## Verification

- `npx tsc --noEmit`: no new errors from any file this pass touched. The existing
  failures are all in `src/server/queries/channels.test.ts`,
  `src/server/services/outlier-calc.test.ts`, `src/server/services/analyze.test.ts`,
  `src/server/services/remix.test.ts`, and `src/server/llm/client.test.ts`, caused
  by another in-progress backend change already sitting uncommitted in the working
  tree before this pass started (a `computeChannelMedian` to
  `computeChannelBaseline` rename, a missing `scoreVideos` export, an `isOwn`
  schema column, an `LlmClient.ping` addition). None of those files were touched
  here.
- `npx eslint` on every file changed in this pass: clean.
- `npx vitest run`: 21 failing tests, all inside `src/server/queries/channels.test.ts`,
  `src/server/services/outlier-calc.test.ts`, and `src/server/services/sync-engine.test.ts`,
  same root cause as above (pre-existing, not from this pass). 549 tests pass. No
  test in the suite references any component touched in this pass, so nothing
  needed a literal-string update.
