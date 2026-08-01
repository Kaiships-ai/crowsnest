# Stepwise smoke test plan, 2026-08-01

Agent-runnable checklist for the core six pages. I drive the gstack browser
against `http://localhost:3000` (not `127.0.0.1`) and report pass or fail per
case. Every case here is read-only: no case starts a sync, spends LLM quota,
writes a secret, or stops the sidecar. A case that opens a dialog closes it
without submitting.

Each case has numbered Steps and one Expected line. A case passes only when the
Expected line holds with no console error thrown during the steps.

## Preconditions

- Dev server up on 3000 (`/crowsnest-up` brings up 9router, the dev server, and
  the browser).
- Instagram connected, channels synced. State at write time: 3 channels tracked,
  about 42 posts synced, thumbnails and avatars on disk (no video files yet).
- Feed filter defaults to a 5x minimum outlier score, so the default Feed shows
  only the small set of posts scoring 5x or higher.

## Feed (/feed)

### TC-Feed-1: Page loads
Steps:
1. Go to `/feed`.
Expected: topbar reads "Outlier Feed", the filter bar is present (fleet, score,
views, timeframe, search, sort, grid/list toggle), a result count line sits
above a grid of cards, and the browser console has no errors.

### TC-Feed-2: Card opens the quick preview sheet
Steps:
1. On `/feed`, click a card thumbnail (the video image, not the handle or Remix).
Expected: a "Quick preview" sheet slides in from the right showing the
thumbnail, channel handle, caption, view/like/comment counts, a Transcript
section, and two buttons "Open full page" and "Remix". The URL stays `/feed`
(the card is preview-first by design, it does not navigate on click).

### TC-Feed-3: Quick preview to full page
Steps:
1. Open the quick preview sheet (TC-Feed-2).
2. Click "Open full page".
Expected: navigates to `/feed/[videoId]` for that card.

### TC-Feed-4: Close the quick preview sheet
Steps:
1. Open the quick preview sheet.
2. Press Escape (or click outside the sheet).
Expected: the sheet closes, focus returns to the grid, URL still `/feed`.

### TC-Feed-5: Search with no match
Steps:
1. Type `zzzzznomatch` in the search box.
2. Press Enter.
Expected: the grid is replaced by a "No post matches" message with a
"Clear search" button, not a blank area.

### TC-Feed-6: Clear search restores results
Steps:
1. From the no-match state, click "Clear search".
Expected: the grid returns to the prior result set and the result count matches
the number of cards shown.

### TC-Feed-7: Filter to zero results
Steps:
1. With the search box empty, set the minimum score filter to its highest option.
Expected: the grid shows "No post matches this slice" with a "Clear filters"
button.

### TC-Feed-8: List view toggle
Steps:
1. Click the list view button in the filter bar.
Expected: the grid switches to list rows with a Score, Post, Channel, Views,
Posted header, with no full page reload. The URL gains `view=list`.

### TC-Feed-9: Remix from a card
Steps:
1. Click "Remix" on a card footer.
Expected: navigates to `/feed/[videoId]/remix`.

## Video detail (/feed/[videoId])

### TC-VD-1: Page loads
Steps:
1. From the feed, open a card's full page (TC-Feed-3).
Expected: the page shows a "← Feed" back link, the video area, caption, stat
row, and an action row with "Remix this" and a save action ("Keep this post").
No console errors.

### TC-VD-2: Analysis and transcript tabs
Steps:
1. Click the "Transcript" tab, then "Hook & structure", then "Why it worked".
Expected: each tab switches content in place with no page reload. If a transcript
exists the Transcript tab shows its text and a copy control. If none exists it
shows a transcribe prompt (do not click it, that is a side effect).

### TC-VD-3: Similar outliers
Steps:
1. Scroll to the "Similar outliers" section.
Expected: a row of related videos renders, or an "Analyze more videos to see
patterns" style empty message. Not a blank gap.

### TC-VD-4: Remix this
Steps:
1. Click "Remix this".
Expected: navigates to `/feed/[videoId]/remix`.

### TC-VD-5: Tab title
Steps:
1. Read the browser tab title on the detail page.
Expected: the title includes the video caption (or "Video") plus "Crowsnest".

### TC-VD-6: Not found
Steps:
1. Go to `/feed/not-a-real-id`.
Expected: the page renders a not-found state (content matches a 404), not a
crash. The status code is known to stay 200, which is an accepted gap.

## Remix studio (/feed/[videoId]/remix)

### TC-RX-1: Page loads with the stepper
Steps:
1. From a video detail page, click "Remix this".
Expected: the page shows a stepper with five stages: Prompt, Research, Hook,
Style, Script. No console errors (watch for any performance measure error, it
should not appear on a healthy dev server).

### TC-RX-2: Prompt stage
Steps:
1. Look at the Prompt stage.
Expected: a topic field is shown, pre-filled or empty depending on prior
sessions.

### TC-RX-3: Research stage content
Steps:
1. If the Research stage is already reached, view it.
Expected: it shows reference material pulled from the Vault (saved posts) and
similar outliers. Do not advance into a generation stage, that spends LLM quota.

### TC-RX-4: Stepper locks unreached stages
Steps:
1. Click a stage ahead of the furthest one reached (for example click Script on
   a fresh session).
Expected: nothing happens, the stepper does not jump ahead.

### TC-RX-5: Not found
Steps:
1. Go to `/feed/not-a-real-id/remix`.
Expected: a not-found state renders, not a crash.

## Channels (/channels)

### TC-CH-1: Page loads
Steps:
1. Go to `/channels`.
Expected: h1 "Channels", a fleet rail on the left, a channel table on the right.
No console errors.

### TC-CH-2: Summary count
Steps:
1. Read the summary line above the table.
Expected: it states the tracked channel count (3 at time of writing, adjust if a
channel was added or removed).

### TC-CH-3: Table columns filled
Steps:
1. Read the table rows.
Expected: Channel (handle), Followers, and Outliers (30d) are filled for every
row. Median views shows a number for a channel with at least
score_min_usable_posts (5) posts that have a view count, and a dash for a channel
below that. A dash is the correct "not enough data" signal, not a failure. At
write time only @kallaway clears the threshold; @nateherkai and @kaiships.ai
have zero posts with view counts, so their dash is expected.

### TC-CH-4: Add channel dialog
Steps:
1. Click "Add channel".
2. Close the dialog without submitting.
Expected: a dialog with a handle field opens, and closing it adds no channel.

### TC-CH-5: Fleet filter
Steps:
1. Click a fleet in the left rail.
Expected: the URL gains a `fleet=` param and the table narrows to that fleet's
channels.

### TC-CH-6: Open a channel
Steps:
1. Click a channel row.
Expected: navigates to `/channels/[channelId]`.

## Vault (/vault)

### TC-VLT-1: Page loads
Steps:
1. Go to `/vault`.
Expected: h1 "Vault" with a count line, and four tabs: Saved posts, Scripts,
Hooks, Styles. No console errors.

### TC-VLT-2: Saved posts tab
Steps:
1. View the Saved posts tab.
Expected: rows with thumbnail, score, reason, and posted date, or an empty state
with a link into the Feed.

### TC-VLT-3: Tab switching
Steps:
1. Click Scripts, then Hooks, then Styles.
Expected: each tab switches content in place, no reload. Each shows cards or the
appropriate empty copy.

### TC-VLT-4: Deep link to a tab
Steps:
1. Go to `/vault?tab=scripts`.
Expected: the Scripts tab is active on first paint, not Saved posts.

### TC-VLT-5: New template dialog
Steps:
1. Click the add/new template action.
2. Close the dialog without saving.
Expected: a create-template dialog opens, and closing it saves nothing.

## Settings (/settings)

### TC-SET-1: Page loads and nav anchors
Steps:
1. Go to `/settings`.
2. Click each left-nav item: Niche profile, Instagram, Graph API, API keys,
   Local binaries, Scoring, Feed defaults, Sync, Onboarding.
Expected: each click scrolls to its section (anchor jump), no page reload. No
console errors.

### TC-SET-2: Instagram status (read-only)
Steps:
1. Read the Instagram section.
Expected: the sidecar control shows "Sidecar: Running" and the connection panel
shows "Connected as @kaiships.ai.support" with instagrapi version and service
URL. Do not click Stop, Disconnect, or submit a session ID (all side effects).

### TC-SET-3: API keys and secrets
Steps:
1. Read the API keys section.
Expected: three groups (LLM, Instagram sidecar, Graph API) list their secrets
with Configured or Not set badges. A configured secret shows its source, and no
secret shows its actual value.

### TC-SET-4: Test the Anthropic key
Steps:
1. Click "Test" next to the Anthropic key.
Expected: shows "Testing" then a toast with the connection result (OK, given
9router is live). This is a token-count check that spends no generation quota.

### TC-SET-5: Local binaries
Steps:
1. Read the Local binaries section.
Expected: yt-dlp and whisper-cli each show a real found or not-found status.

### TC-SET-6: Graph API status
Steps:
1. Read the Graph API section.
Expected: a plain "not configured" state (no IG_GRAPH_TOKEN), never fabricated
zeros or a stuck spinner.
