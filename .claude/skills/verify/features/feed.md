# Feed

Over-performing posts from tracked channels, scored against each creator's median, with filters, a preview panel, a full detail page, and "keep this post".

## Sub-features

- Filter bar: score, views, engagement, analyzed, timeframe, followers (`src/components/feed/filter-bar.tsx`), reflected in the URL (`minScore=5`).
- Card preview panel with "Open full page".
- Detail page `/feed/<id>`: keep the post (saved_posts), save to vault, remix, copy as prompt.

## How to get to it (user POV)

Sidebar, Create, Feed. A bare `/feed` applies the High Conviction default (minScore 10). The seed's one outlier is 6.4x, so the first view can be the empty "clears no bar yet" state.

## Driving it with browse

`drive.sh feed-e2e-01`. Selectors: `feed-filter-min-score`, option text `5×+ score`, `outlier-card`, `preview-open-full-page`, `save-post-button`, `save-post-confirm`. Proof: toast "Kept in the vault", button reads "Kept", URL keeps `minScore=5`, and `select count(*) from saved_posts` is 1 on a fresh seed.

## Gotchas

- Option labels carry a suffix ("5×+ score", not "5×+"). The journey matched the old label until it was fixed alongside this skill.
- Re-running without a fresh `up.sh` starts from an already-kept post.
