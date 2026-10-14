# Feed

The feed is the front door of the core loop and the app's landing page at `/feed`: a ranked page of outlier posts from tracked channels, scanned to find something worth remixing. It is a direct server read of the local database, so it renders even when the LLM proxy, the Graph token, or the sidecar are down. Around the grid sit the filter bar with saved views, the quick preview sheet, and the video detail page at `/feed/[videoId]`, where the keep-this-post and save-to-vault actions live.

## Data it holds

Tables are defined in `src/server/db/schema.ts`.

- Reads: `videos` (with `outlier_score`, written by the sync rescoring pass, never by the feed), `channels`, `media_assets`, `fleets`, `fleet_channels`, and `video_analyses` (existence and tags only).
- Writes: `saved_filters` (saved views), `saved_posts` (keep this post, unique on `video_id`), `vault_items` (save to vault), and `videos` through the Add post URL import. It also writes the recently viewed id list in `app_settings`.
- Two system saved views, Balanced (`minScore: 5, sinceDays: 30`) and High Conviction (`minScore: 10, sinceDays: 14, minViews: 500000`), are seeded once by `src/server/db/bootstrap.ts` and marked `is_system`.
- The slice (filters, sort, view, limit) is not stored. It lives only in the URL query string.
- The `videos` indexes `videos_outlier_score`, `videos_view_count`, `videos_posted_at`, and `videos_channel_posted` back the sort and filter options.

## Boundaries

- Owns: `src/app/(shell)/feed/` (list page and detail page), `src/lib/feed-filters.ts`, `src/server/queries/feed.ts`, `src/server/queries/video.ts`, `src/server/queries/preview-action.ts`, `src/components/feed/`, `src/components/video/`, and the saved view, saved post, and vault actions in `src/server/actions/`.
- Called by: the app shell (landing route), dashboard recently viewed links, channel grids, similar-outlier cards, and vault cards linking to a detail page.
- Calls: the remix studio and vault (links only), the analyze part's output (`rowToAnalysis`), and `importReelByUrl` in `src/server/services/sync-engine.ts` (yt-dlp provider) for Add post URL. The remix route under `feed/[videoId]/remix/` shares the prefix but belongs to remix.

## Invariants

- The slice lives in the URL, never in React state. Filter changes, sort, density, and Load more are `router.replace` or navigations. `FILTER_PARAM_KEYS` in `src/lib/feed-filters.ts` is the single definition of what counts as a filter, shared by the server page and the client bar. `sort` is an order param, and `all` an escape param, so neither counts as a filter.
- A bare `/feed` applies the seeded High Conviction view; `?all=1` escapes it. `resolveFeedCriteria` is the one function that applies the default, and both `feed/(list)/page.tsx` and `resolve-feed-nav.ts` call it, so the list and the detail page's prev and next resolve the same slice. Cosmetic params (density, view, sort, limit) still count as bare.
- `key=any` is an explicit "no condition" token, distinct from an unset key, so a cleared control does not re-trigger the default view. Using any filter drops `limit`.
- Soft-removed posts (`deleted_at` set) stay in results, flagged "No longer on Instagram", and the detail page still resolves them. `buildWhere` in `src/server/queries/feed.ts` does not exclude them.
- Derived numbers have one owner. `toFeedItem` computes engagement (likes plus comments over views) and the `deleted` flag; the engagement filter uses the same SQL formula, and a null count is excluded rather than treated as zero.
- Follower bands are nano under 10k, mid 100k to 1M, macro 1M and up. Each band count is computed under every other active filter, so the three need not sum to the total, and a channel between 10k and 100k matches none.
- Page size is 24 and Load more adds 24. The results count is the true slice size before paging.
- The feed has four distinct empty states (no channels, never synced, search matched nothing, slice empty). The default-view empty state escapes through `?all=1`, not a bare `/feed`.
- Saved views restore only minimum score, minimum views, and timeframe. Every mutating saved view action refuses a system row (`SAVED_VIEW_IS_SYSTEM`), and a stale rename or delete returns `SAVED_VIEW_NOT_FOUND`.
- Keep this post is one row per video. A second keep returns `SAVED_POST_ALREADY_SAVED`, a vanished video returns `SAVED_POST_VIDEO_NOT_FOUND`, and removing an already-gone row is a no-op success so a stale Undo does not error.
- `saveToVaultAction` writes every chosen item in one `db.transaction`, and each insert reuses an existing row with the same type, source video, title, and template text. A retry never duplicates, and a failure on one item rolls back the rest. Save to vault is disabled until the video has an analysis.
- The quick preview loads one video lazily, keyed to the clicked card, through `getVideoPreviewAction`. It does not record the video as recently viewed; only the detail page does, fire-and-forget, capped at `RECENTLY_VIEWED_MAX` (8). The sheet has no error branch for a failed read.
- The list route sits in its own `(list)` group so its loading Suspense boundary cannot swallow the sibling `[videoId]` route's `notFound()`. On the detail page, `getCachedVideoDetail` and `notFound()` run first. The in-page Suspense around `SimilarSection` comes after that gate, and `SimilarSection` catches its own failure so it cannot trip the shell error boundary.
- Prev and next on the detail page resolve against the same filtered, ordered slice, capped at `FEED_ORDER_LIMIT` (5000). Past the cap or outside the slice the position label and controls are absent, not wrong.
- Add post URL is a foreground call to `importReelByUrl`, upserting on `(platform, external_id)` like a sync, so re-importing updates in place. A reload during it loses the in-page result, and a failure shows as an inline alert in the dialog, not a toast.
- Saved view names are not deduplicated except the two reserved built-in names.

## Where to look

- `src/lib/feed-filters.ts`
- `src/server/queries/feed.ts`
- `src/app/(shell)/feed/(list)/page.tsx`
- `src/app/(shell)/feed/[videoId]/page.tsx`
- `src/app/(shell)/feed/[videoId]/resolve-feed-nav.ts`
- `src/components/feed/filter-bar.tsx`
- `src/server/actions/saved-post-actions.ts`
- `src/server/actions/vault-actions.ts`
