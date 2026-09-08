# feed: concept brief

`documents/architect/core-components/feed/`

Status: shipped and in daily use.

## 1. What it is

The feed is the front door of the core loop and the app's landing page (`src/app/(shell)/feed/(list)/page.tsx`, route `/feed`): a ranked page of outlier posts pulled from tracked channels, scanned to find something worth remixing. It is a direct server read, not a form: the page queries the local SQLite database as it renders and shows either a page of cards or one of four empty states. Everything the user changes about the view, the filters, the slice, the sort, grid or list, how many posts, is carried in the URL (`src/lib/feed-filters.ts`), so a filter change or a Load more is a fresh read of a different slice, not a submit. There is no server action on the feed page itself, so its only failure surface is its empty states.

Around that grid sits the rest of the component: the filter bar that rewrites the URL, saved views (named filter sets, plus two seeded built-ins, Balanced and High Conviction), the quick preview sheet that opens one video over the feed, and the video detail page reached by opening a card, where the keep-this-post and save-to-vault actions live.

Because it needs nothing but the local database, the feed works in every restricted state: the LLM proxy being down, the Graph token being invalid, and the sidecar not running change nothing about whether it renders. The one thing the sidecar controls is whether new videos arrive at all; with the sidecar stopped the feed still reads, it just goes stale.

## 2. Why it exists

crowsnest's whole point is surfacing the outliers, not archiving a library, so the feed is built to rank the strongest recent performers first and put the outlier score, a multiple of a channel's own baseline, as the largest number on every card. The score, the follower-band counts, and the filters all answer one question fast: which of these is worth a closer look.

The URL-as-state decision follows from that: a slice is a link. A shared or bookmarked `/feed?...` reopens the exact same slice, browser back and forward walk the slices visited, and nothing on the page needs saving because the URL already holds it. `src/lib/feed-filters.ts` is the one shared definition of what counts as a filter, imported by both the server page and the client filter bar, so the two can never disagree about it.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Slice | The set of videos a given `/feed` URL resolves to: a filter combination, a sort, and a limit, entirely described by the query string. Nothing about a slice lives in React state. |
| Filter param | One of the nine URL keys `FILTER_PARAM_KEYS` (`src/lib/feed-filters.ts`) lists: `fleet`, `platform`, `minScore`, `minViews`, `since`, `band`, `q`, `minEng`, `analyzed`. Whether any of these is present is what decides a bare visit from a filtered one. `sort` is deliberately not a filter param, it is an order param (`ORDER_PARAM_KEYS`), because it picks an ordering, not a slice. |
| Saved view | A named row in the `saved_filters` table restoring three criteria only, minimum score, minimum views, and timeframe. Two rows, Balanced and High Conviction, are seeded once at install (`src/server/db/bootstrap.ts`) and marked `isSystem`, so they cannot be renamed or deleted. |
| Follower band | One of three fixed ranges a channel's follower count can fall in: nano under 10k, mid 100k to 1M, macro 1M and up. A channel between 10k and 100k, or with an unknown follower count, matches no band. |
| Outlier score | `videos.outlier_score`, a multiple of a channel's own baseline, written by the sidecar sync's rescoring pass, not computed by the feed. The feed only reads and sorts by it. |
| Deleted flag | `FeedItem.deleted`, derived from `videos.deleted_at` in `toFeedItem` (`src/server/queries/feed.ts`). A soft-removed post stays in the feed's results rather than being excluded, and is marked "No longer on Instagram" instead of hidden. |
| Quick preview | The read-only sheet that slides in over the feed when a card is clicked, fetching one video's detail lazily and keyed to that video's id, so scrolling the feed with the sheet closed costs nothing. |

## 4. How it fits in the system

The feed sits downstream of everything that writes a `videos` row. The sidecar sync (`ig-sync`) is the primary writer; the feed's manual "Add post URL" import is the one write reachable from the feed's own filter bar, a foreground call into the same `importReelByUrl` path the sidecar's single-reel import uses (`src/server/services/sync-engine.ts`), not a feed-owned pipeline. The feed reads channels, videos, and whether a video has an analysis; it writes only through the saved-view, saved-post, and vault actions, each a small, targeted insert or delete, never a bulk mutation of the videos or channels tables themselves.

Opening a card leaves the feed for the video detail page (`src/app/(shell)/feed/[videoId]/page.tsx`), which resolves its previous and next neighbours against the same filtered, ordered slice the card was clicked from (`resolve-feed-nav.ts`). From the detail page a user can jump into the remix studio or the vault, both of which are separate components that read what the feed and the sidecar wrote.

## 5. Dependency map

### Upstream (what the feed depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | Every table the feed reads: `videos`, `channels`, `media_assets`, `video_analyses` (existence only), `fleets`, `fleet_channels`, `saved_filters`, `saved_posts`, `vault_items`. |
| `src/lib/feed-filters.ts` | The pure `searchParams` to criteria mapping shared by the server page and the client filter bar, so "a filter param is present" has one definition. |
| `src/server/db/bootstrap.ts` | Seeds the two built-in saved views, Balanced and High Conviction, once at install; the feed's default-view logic reads the seeded row rather than a hardcoded literal. |
| Next.js server components and `router.replace`/`router.refresh` | The URL-driven navigation model every filter change, Load more, and saved-view write depends on. |
| `src/server/providers/ytdlp.ts`, via `importReelByUrl` | The single-reel fetch the "Add post URL" import calls; not owned by the feed, but the feed's only write path into `videos`. |

### Downstream (what depends on the feed)

| Consumer | What it reads or uses |
| --- | --- |
| Video detail page | Resolves its previous/next neighbours and its "N of Total" label against the same filtered feed order (`resolve-feed-nav.ts`). |
| Remix studio | Reached from a feed card's Remix link or the quick preview sheet; reads the source video the feed pointed at. |
| Vault | Reads `vault_items` rows written by the save-to-vault dialog on the video detail page, and `saved_posts` rows written by the keep-this-post button. |
| Dashboard's recently viewed row | Reads the `app_settings` list the video detail page writes on arrival, not the feed page itself. |

### External

| Dependency | Role |
| --- | --- |
| None directly | The feed page and its filter bar reach no external service; they read and write the local database only. |
| The post-fetch provider (`yt-dlp`, via `ytdlp.ts`) | Reached only by the "Add post URL" import, the one control on the feed that can fail on a service being unreachable. |

## 6. Boundaries

The feed owns the browse-and-preview surface: the grid and list presentations, the outlier cards and their scores and metrics, the follower-band counts, Load more, the empty states, the filter bar and saved views, the quick preview sheet, and the video detail page with its keep and save actions. It does not own the data it shows: videos, channels, scores, and transcripts are written by the sidecar sync and the analyze flow; the feed only reads them. It does not own the remix studio or the vault it links into, and the one write reachable from the bar, the manual "Add post URL" import, is a foreground call into the same post-fetch path the sidecar uses, not a feed-owned pipeline.
