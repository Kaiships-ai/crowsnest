# feed: concept brief

The outlier feed: cards, filters, saved views, quick preview, keep and save actions.

## What it is

The feed is the front door of the core loop and the app's landing page (`/feed`): a
ranked page of outlier posts pulled from tracked channels, scanned to find something worth
remixing. It is a [direct server read](../../shared/interaction-model.md#how-an-action-reaches-the-server) —
the page queries the local SQLite database as it renders and shows either a page of cards
or one of four empty states. Everything the user changes about the view — the filters, the
slice, the sort, grid or list, how many posts — is carried in the URL, so a filter change
or a Load more is a fresh read of a different slice, not a form submit. There is no server
action on the page itself and nothing to submit, so the browse surface cannot fail as an
action; its only "failure" surface is its empty states.

Around that grid sits the rest of the component: the filter bar that rewrites the URL, the
saved views (named filter sets, plus two seeded built-ins), the quick preview sheet that
opens one video over the feed, and the video detail page reached by opening a card, where
the keep-this-post and save-to-vault actions live. The full behavior of each is the
authoritative spec in [feature description](03-feature-description.md); the test cases are
in [test cases](04-test-cases.md). This brief does not restate them.

Because it needs nothing but the local database, the feed works in every restricted state:
the LLM proxy being down, the Graph token being invalid, and the sidecar not running change
nothing about whether it renders. The one thing the sidecar controls is whether new
[videos](../../shared/data-model.md#video) arrive at all — with the sidecar stopped the feed
still reads, it just goes stale.

## Why it exists

crowsnest's whole point is surfacing the outliers, not archiving a library, so the feed is
built to rank the strongest recent performers first and put the outlier score — a multiple
of a channel's own baseline — as the largest number on every card. A bare `/feed` visit
therefore opens not on the whole library but on the seeded High Conviction saved view, so
the user lands on the strongest posts rather than a wall of everything. The score, the
follower-band counts, and the filters are all there to answer one question fast: which of
these is worth a closer look.

The URL-as-state decision follows from that: a slice is a link. A shared or bookmarked
`/feed?...` reopens the exact same slice, browser back and forward walk the slices visited,
and nothing on the page needs saving because the URL already holds it.

## Boundaries

The feed owns the browse-and-preview surface: the grid and list presentations, the outlier
cards and their scores and metrics, the follower-band counts, Load more, the empty states,
the filter bar and saved views, the quick preview sheet, and the video detail page with its
keep and save actions. It does not own the data it shows: videos, channels, scores, and
transcripts are written by the [sidecar sync](../ig-sync/01-concept-brief.md) and the
[analyze](../analyze/03-feature-description.md) flow; the feed only reads them. It does not
own the remix studio or the vault it links into, and the one write reachable from the bar —
the manual "Add post URL" import — is a foreground call into the same post-fetch path the
sidecar uses, not a feed-owned pipeline.
