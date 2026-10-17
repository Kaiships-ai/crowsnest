# Feed

Over-performing posts from tracked channels, scored against each creator's median, with filters, a preview panel, a full detail page, and "keep this post".

## Sub-features

- Filter bar: score, views, engagement, analyzed, timeframe, followers (`src/components/feed/filter-bar.tsx`), reflected in the URL (`minScore=5`).
- Card preview panel with "Open full page".
- Saved views ("Balanced", "High Conviction" presets, `manage-saved-views-dialog.tsx`) and a list-row layout (`feed-list-row.tsx`).
- Detail page `/feed/<id>`: keep the post (`saved_posts`), un-keep with an undo toast ("Removed from saved posts"), "Save template" (`save-to-vault-trigger`; the Vault page is gone, so nothing lists what it saves), "Remix this" (the Remix studio at `/feed/<id>/remix`), "Copy as prompt".

## How to get to it (user POV)

Sidebar, Nguồn, which lands on `/feed`. The Nguồn tabs are `sources-tab-feed` Feed, `sources-tab-channels` Kênh, `sources-tab-discover` Khám phá. A bare `/feed` applies the High Conviction preset (minScore 10, last 14 days, 500K+ views); `?all=1` turns the preset off. The seed's one outlier is 6.4x, so the first view is the empty state "No post clears the High Conviction bar yet."

## Driving it with browse

`drive.sh feed-e2e-01`. Selectors: `feed-filter-min-score`, option text `5×+ score`, `outlier-card`, `preview-open-full-page`, `save-post-button`, `save-post-confirm`. Proof: toast "Saved for Remix research", button reads "Kept", URL keeps `minScore=5`, and `select count(*) from saved_posts` is 1 on a fresh seed.

## Gotchas

- Option labels carry a suffix ("5×+ score", not "5×+"). The journey matched the old label until it was fixed alongside this skill.
- With a failed Graph check in this server process, `graph-token-line` shows above the feed (see [week.md](week.md)).
- Re-running without a fresh `up.sh` starts from an already-kept post.
