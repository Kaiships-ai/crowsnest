# Feed

The feed is the front door of the core loop: a ranked list of outlier posts from tracked channels, scanned to find something worth remixing. It is a direct server read of the local database, so it works even when the Graph token or the sidecar are down. Around it sit saved views, a one-video preview read, video detail, keep this post, and save to vault. The web app's feed, filter bar, preview sheet, and detail screens are retired with the web app; a Lead Studio board replaces them.

## Data it holds

Tables are defined in `src/server/db/schema.ts`.

- Reads: `videos` (with `outlier_score`, written by the sync rescoring pass, never by the feed), `channels`, `media_assets`, `fleets`, `fleet_channels`, and `video_analyses` (existence and tags only).
- Writes: `saved_filters` (saved views), `saved_posts` (keep this post, unique on `video_id`), `vault_items` (save to vault), and `videos` through the Add post URL import. It also writes the recently viewed id list in `app_settings`.
- Two system saved views, Balanced (`minScore: 5, sinceDays: 30`) and High Conviction (`minScore: 10, sinceDays: 14, minViews: 500000`), are seeded once by `src/server/db/bootstrap.ts` and marked `is_system`.
- The slice (filters, sort, limit, offset) is not stored. The caller passes it to `getOutlierFeed` as `FeedFilters`.
- The `videos` indexes `videos_outlier_score`, `videos_view_count`, `videos_posted_at`, and `videos_channel_posted` back the sort and filter options.

## Boundaries

- Owns: `src/server/queries/feed.ts`, `src/server/queries/video.ts`, `src/server/queries/preview-action.ts`, and the saved view, saved post, and vault actions in `src/server/actions/`.
- Called by: no screen while the Lead Studio boards are not built; `getVideoDetail` also backs remix and MCP reads.
- Calls: the analyze part's output (`rowToAnalysis`) and `importReelByUrl` in `src/server/services/sync-engine.ts` (yt-dlp provider) for Add post URL.

## Invariants

- Soft-removed posts (`deleted_at` set) stay in results with `deleted: true`, and `getVideoDetail` still resolves them. `buildWhere` in `src/server/queries/feed.ts` does not exclude them.
- Derived numbers have one owner. `toFeedItem` computes engagement (likes plus comments over views) and the `deleted` flag; the engagement filter uses the same SQL formula, and a null count is excluded rather than treated as zero.
- Follower bands are nano under 10k, mid 100k to 1M, macro 1M and up. Each band count is computed under every other active filter, so the three need not sum to the total, and a channel between 10k and 100k matches none.
- Saved views restore only minimum score, minimum views, and timeframe. Every mutating saved view action refuses a system row (`SAVED_VIEW_IS_SYSTEM`), and a stale rename or delete returns `SAVED_VIEW_NOT_FOUND`.
- Keep this post is one row per video. A second keep returns `SAVED_POST_ALREADY_SAVED`, a vanished video returns `SAVED_POST_VIDEO_NOT_FOUND`, and removing an already-gone row is a no-op success so a stale Undo does not error.
- `saveToVaultAction` writes every chosen item in one `db.transaction`, and each insert reuses an existing row with the same type, source video, title, and template text. A retry never duplicates, and a failure on one item rolls back the rest.
- `getVideoPreviewAction` reads one video and does not record it as recently viewed. `recordRecentlyViewed` is the write, fire-and-forget, capped at `RECENTLY_VIEWED_MAX` (8).
- Add post URL is a foreground call to `importReelByUrl`, upserting on `(platform, external_id)` like a sync, so re-importing updates in place.
- Saved view names are not deduplicated except the two reserved built-in names.

## Where to look

- `src/server/queries/feed.ts`
- `src/server/actions/saved-post-actions.ts`
- `src/server/actions/vault-actions.ts`
