# UI polish and view counts

Date: 2026-08-03
Status: draft, needs a plan
Source: five issues Kai reported from dogfooding, with screenshots.

This spec covers three buildable UI fixes (video detail, logs filter, vault detail) and records two items as backlog with findings (view counts, frame pass).

## Item 1: missing view counts (spike resolved 2026-08-03, superseded below)

Not a UI bug. The root cause recorded here on 2026-08-03 was wrong and is corrected in
docs/product/reel-view-count-spike.md. Read that file, not this section.

What this section originally claimed: that instagrapi returns `play_count: 0` and `view_count: 0`
for a reel owned by someone else, full stop, so the number was simply not available to a non-owner.

What the spike measured: that is true only of the listing call. `user_medias_paginated_v1`, which
the sync uses, returns `play_count: 0` on every row. The single media call `media_info_v1` returns
the real number for those same reels. Confirmed on four reels across four channels, all of which
render a dash today: 371200 for @hormozi, 19358 for @chase.h.ai, 1212937 for @jun_yuh, 94988 for
@nick_saraev.

Of the three options listed here, the middle one won: a different instagrapi call does return a
non-zero play count for non-owned reels. The public web scrape is unnecessary. The "accept N/A and
lean on Graph" option is off the table.

The mapping at src/server/ig/client.ts:215 already prefers `play_count`, so no mapper change is
needed. The work is a paced enrichment pass that calls the detail endpoint per reel.

Still accurate from the original finding: the feed math is correct, and photos and non-reel posts
are unaffected. Note that only reels (`product_type: clips`) were confirmed.

## Item 2: video detail screen (buildable)

File: src/components/video/video-detail.tsx. Two problems.

### 2a. Action bar overlaps the story beats

In the Hook and Structure tab, the end-of-path action bar (Remix this, Keep this post, Save to Vault, Copy as prompt, lines around 521 to 550) renders on top of the beats list. Kai's screenshot shows the Payoff beat hidden behind the buttons.

The action bar is a static flex row placed after the Tabs block, so the overlap is a layout or stacking problem in that tab's content region, not intended positioning. The beats list and the action bar end up occupying the same vertical space.

Desired: the action bar sits cleanly below the full beats list at every viewport height, with normal flow spacing, no element drawn over another. The beats (Hook, Build, Build, Payoff, CTA) are all fully visible above it.

Acceptance: on /feed/<id> Hook and Structure tab, no button overlaps any beat text at 1280px, 1440px, and a tall window. The last beat (CTA) and the action bar both read in full.

### 2b. Left video card needs scrolling to see stats

File: same component, the left column around lines 366 to 445. The video card's stats (views, age, followers, likes, comments, engagement) sit below the media and require scrolling the card to see them.

Desired: the card shows the media and the stats together without a scroll, keeping the card's purpose (identify the video and its numbers at a glance). Recommended approach: shrink the media to leave room, or move the stats into a compact meta row or two-column block beside or under a smaller media frame. Pick whichever keeps the 9:16 media recognizable while fitting all stats in the visible card.

Acceptance: on a standard 900px tall window, the media plus all six stats are visible in the left card with no scroll.

## Item 3: frame pass (backlog, separate session)

The "run frame pass" feature needs a Claude Code session with the /watch skill (see project memory frame-pass-via-watch, scripts/frame-pass.ts writes to video_analyses). Not part of this spec. Backlog as its own workstream in a separate session.

## Item 4: logs filter (buildable)

File: src/components/logs/logs-view.tsx.

### 4a. Since and Until are raw timestamp text boxes

Today Since and Until are plain text inputs that force typing an ISO timestamp like 2026-07-31T00:00:00Z. Replace them with a date (and time) picker so a date is chosen from a calendar, not typed.

Check whether the UI kit under src/components/ui already has a calendar or date-picker primitive. If it does, use it. If not, add one (a popover with a calendar), matching the app's flat, radius-0, token-based style. Keep the underlying filter contract the same (the store's since and until still receive ISO strings), only the input control changes.

### 4b. Default should show everything

Today the logs default to warn and error only. Flip the default to show all three levels (info, warn, error), so a bare visit to /logs shows everything and the user filters down to narrow the scope. The "Show everything" switch and the level checkboxes stay; only the default changes. This touches both the page's server-side default (src/app/(shell)/logs/page.tsx, the levels fallback) and the client default in logs-view.tsx, which must agree.

Acceptance: a bare /logs visit shows info, warn, and error rows. Since and Until open a calendar. The existing search, level, and source filters still work.

## Item 5: vault, compact cards with a detail popup (buildable)

Files: src/app/(shell)/vault/page.tsx and the per-type components under src/components/vault (script-card.tsx, template-card.tsx, saved-post-row.tsx).

Problem: the Scripts tab renders the full script text in each card, so cards are walls of text (Kai's screenshot). The four tabs (Saved posts, Scripts, Hooks, Styles) also do not share one interaction.

Desired, uniform across all four tabs:
- The grid or list shows a compact card with only a few fields (for a script: title, status badge, source channel, and a short one or two line preview, never the full body). Saved posts already read as compact rows, keep that density.
- Clicking a card opens a popup panel (a dialog or a right-side panel) showing the item's full detail: for a script, the full content plus its hook and style links and source video and the Create Prompt action; for a saved post, the full note and the video; for a hook or style, the full template body. Move the heavy content and the per-item actions into that panel.
- Use the existing Dialog component (src/components/ui/dialog.tsx) unless a side panel reads better for long script bodies.

Open choice for the plan: center dialog versus right side panel. Recommendation: a dialog for hooks, styles, and saved posts (short content), and either a dialog or a wider side panel for scripts (long bodies). Decide during planning.

Acceptance: no vault card shows a full script body. Clicking any card in any of the four tabs opens a panel with that item's full detail and its actions. The compact card carries enough to identify the item without opening it.

## Not in this spec

- Item 1 real fix (view-count data source): spike done, see docs/product/reel-view-count-spike.md. Implementation is a paced enrichment pass, tracked separately.
- Item 3 frame pass: separate session with /watch.
- The header "N runs" count lag on the Runs screen (noted during logs observability QA): cosmetic, separate.
