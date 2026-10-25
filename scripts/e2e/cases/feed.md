# Feed cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Outlier feed read | Ranked, filtered, paged outlier posts with follower-band counts | ● | `src/server/queries/feed.ts` (`getOutlierFeed`, `getFeedBandCounts`) | none |
| 3 | Saved views and Add post URL | Saved view create, rename, delete (system views refused), and one-post import by URL | ● | `src/server/actions/saved-view-actions.ts`, `src/server/actions/sync-actions.ts` (`importReelAction`) | none |
| 5 | Keep this post | One-row-per-video shortlist with an optional note | ● | `src/server/actions/saved-post-actions.ts` | none |
| 6 | Save to vault | Hook or style templates lifted from an analysis into vault items, in one transaction | ● | `src/server/actions/vault-actions.ts` (`saveToVaultAction`) | none |
| 7 | Video detail and preview reads | One video's detail and a one-video preview | ● | `src/server/queries/video.ts` (`getVideoDetail`), `src/server/queries/preview-action.ts` (`getVideoPreviewAction`) | none |

Retired with the web app: the feed page, filter bar, quick preview sheet, keep and vault buttons, video detail page, and the Nguồn tabs (former feature 4, the screens of 2, 3, 5, 6, 7, and 8). A Lead Studio board replaces them.

## Behavior notes

- Reads need no external service. Only `importReelAction` reaches yt-dlp.
- Edge cases: two callers racing a keep or a saved view change are refused, not duplicated; re-importing a post updates it in place.

## feed: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run this file: the route and action rows run offline with `pnpm test --project crowsnest` (vitest) against a temporary SQLite database, no external service needed. The web app's browser journeys and its :3001 dev server are retired with the web app; a UI case returns when its Lead Studio board is built.

## 1. behavior

Retired with the web app (the feed, filter bar, preview, keep, vault, detail, and Nguồn screens no longer exist): FEED-01 through FEED-17, FILTER-01 through FILTER-16, PREVIEW-01 through PREVIEW-12, KEEP-01 through KEEP-10, VAULT-01 through VAULT-12, DETAIL-01 through DETAIL-17, SRC-01 through SRC-04.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-01 | P1 | drizzle query (`src/server/queries/feed.ts :: getOutlierFeed`) | `total` is the true count of the filtered slice before paging, computed alongside the page of items, not derived from the page length. | Temp SQLite db seeded with more than 24 matching videos. | `getOutlierFeed({ ...filters, limit: 24, offset: 0 })`. | `items.length` is at most 24; `total` is the full matching count, larger than `items.length` when the slice exceeds 24. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | drizzle query (`src/server/queries/feed.ts :: getOutlierFeed`) | Soft-removed videos (`deleted_at` set) are not excluded from `buildWhere`; they come back in `items` with `deleted: true`. | A matching video with `deletedAt` set to a past timestamp. | `getOutlierFeed(filters)` on a slice that includes it. | The removed video is present in `items`, and its `FeedItem.deleted` reads `true`. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | drizzle query (`src/server/queries/feed.ts :: toFeedItem`) | `engagementRate` is `(likeCount + commentCount) / viewCount`, and is `null`, never a fabricated `0`, when `viewCount` is `0`/`null` or either count is `null`. | Three videos: one with all three counts present and `viewCount > 0`, one with `viewCount: 0`, one with `likeCount: null`. | `toFeedItem` on each row. | First video: a real ratio. Second and third: `engagementRate` is `null`. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | drizzle query (`src/server/queries/feed.ts :: getFeedBandCounts`) | Each band count is computed under every other active filter with the band itself excluded; the three band counts need not sum to the slice total. | Channels seeded across nano, mid, macro, and one channel with `followerCount: null`. | `getFeedBandCounts(filters)`. | `nano + mid + macro` is less than or equal to the total matching row count; the null-follower channel's videos count toward none of the three bands. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/actions/saved-view-actions.ts :: createSavedViewAction`) | A blank or whitespace-only name is refused with `SAVED_VIEW_NAME_REQUIRED`; no row is written. | Temp SQLite db, no seed needed. | `createSavedViewAction({ name: "   ", criteria: {} })`. | Returns `{ ok: false, code: "SAVED_VIEW_NAME_REQUIRED" }`; `saved_filters` gains no new row. | 🟢 covered by vitest (green) |
| ACTION-06 | P1 | server action (`src/server/actions/saved-view-actions.ts :: renameSavedViewAction`, `deleteSavedViewAction`) | Renaming or deleting a row with `isSystem: true` is refused with `SAVED_VIEW_IS_SYSTEM`; the row is unchanged. | The seeded High Conviction row (`isSystem: true`). | `renameSavedViewAction(id, "New name")`, then `deleteSavedViewAction(id)`. | Both return `{ ok: false, code: "SAVED_VIEW_IS_SYSTEM" }`; the row's name and presence are unchanged. | 🟢 covered by vitest (green) |
| ACTION-07 | P1 | server action (`src/server/actions/saved-view-actions.ts :: renameSavedViewAction`, `deleteSavedViewAction`) | Acting on an id that does not exist returns `SAVED_VIEW_NOT_FOUND`. | Temp SQLite db. | `renameSavedViewAction("does-not-exist", "X")`. | Returns `{ ok: false, code: "SAVED_VIEW_NOT_FOUND" }`. | 🟢 covered by vitest (green) |
| ACTION-08 | P1 | server action (`src/server/actions/saved-post-actions.ts :: createSavedPostAction`) | Saving a video whose row does not exist is refused with `SAVED_POST_VIDEO_NOT_FOUND`; saving twice on the same video is refused with `SAVED_POST_ALREADY_SAVED`. | A real video with no existing saved post. | `createSavedPostAction({ videoId })` twice in a row; separately, `createSavedPostAction({ videoId: "does-not-exist" })`. | First call: `{ ok: true, id }`. Second call on the same video: `{ ok: false, code: "SAVED_POST_ALREADY_SAVED" }`. Nonexistent video: `{ ok: false, code: "SAVED_POST_VIDEO_NOT_FOUND" }`. | 🟢 covered by vitest (green) |
| ACTION-09 | P1 | server action (`src/server/actions/saved-post-actions.ts :: createSavedPostAction`) | A blank or whitespace-only note is stored as `null`, not an empty string. | A real video. | `createSavedPostAction({ videoId, note: "   " })`, then read the row. | The inserted `saved_posts` row's `note` column reads `null`. | 🟢 covered by vitest (green) |
| ACTION-10 | P1 | server action (`src/server/actions/saved-post-actions.ts :: deleteSavedPostAction`) | Deleting an id that no longer exists is a no-op success, not an error. | A `saved_posts` id already deleted. | `deleteSavedPostAction(id)`. | Returns `{ ok: true }`; no error is thrown. | 🟢 covered by vitest (green) |
| ACTION-11 | P1 | server action (`src/server/actions/vault-actions.ts :: createVaultItemAction`) | Saving the same video and type twice creates two independent rows; there is no per-video or per-type uniqueness constraint. | An analyzed video. | `createVaultItemAction({ type: "hook", ... })` twice with the same `sourceVideoId`. | Two `vault_items` rows exist for the same `sourceVideoId` and `type`. | 🟢 covered by vitest (green) |
| ACTION-12 | P2 | server action (`src/server/actions/vault-actions.ts :: createVaultItemAction`) | An empty `title` or `templateText` writes an empty vault item; there is no server-side validation rejecting it. | Any state. | `createVaultItemAction({ type: "hook", title: "", templateText: "", tags: [], sourceVideoId })`. | Returns `{ ok: true }`; the row is written with empty `title` and `templateText`. | 🟢 covered by vitest (green) |
| ACTION-13 | P2 | server action (`src/server/actions/vault-actions.ts :: deleteVaultItemAction`) | Deleting a vault item's row does not touch the source video; deleting the source video instead clears `sourceVideoId` to null on the vault item rather than removing it. | A vault item with a live `sourceVideoId`. | Soft-remove or hard-delete the source `videos` row (`onDelete: "set null"` on `vault_items.source_video_id`), then read the vault item. | The vault item row still exists with its content intact; `sourceVideoId` reads `null`. | 🟢 covered by vitest (green) |
| ACTION-14 | P2 | server action (`src/server/actions/sync-actions.ts :: importReelAction`) | Importing a URL already present upserts the existing `videos` row (keyed on `platform, external_id`) rather than inserting a duplicate. | A video already present with a known `externalId`. | `importReelAction(url)` for that same post. | Returns `{ ok: true, videoId, channelId }` with the existing video's id; `videos` still has exactly one row for that `(platform, external_id)`. | 🟢 covered by vitest (green) |

Not checkable by hand:

- The real fetch and parse behavior of `importReelByUrl` against a live yt-dlp provider call: the route and action lens above exercises the upsert shape once a payload is in hand, not the provider round trip itself.

## 3. browse-e2e

Retired with the web app: E2E-01 through E2E-09. No browser journey exists until a Lead Studio board is built.

## 4. security-lite

The feed reaches no external service of its own and gates nothing behind a license or a role; its only outbound call is the `importReelAction` import's post-fetch provider request, which sends only the pasted URL, no buyer or channel data of its own. The feed has no secret to handle and no sidecar token to check.

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P2 | No buyer data leaving the box | The "Add post URL" import sends only the pasted URL to the post-fetch provider; it never sends caption text, channel handles, or any other stored row content as part of the fetch request. | A post URL to import. | 1. Import a post through `importReelAction` while inspecting the outbound request the yt-dlp provider call makes. | The outbound call carries only the URL; no other stored database content is included in the request. | 🟢 pass (browser): the failed-import output showed the exact invocation, `yt-dlp -J --no-warnings -- <url>`; no caption, handle, or other row content included (see test-shots/feed/SEC-01.png) |

Security-lite has no rows for secret handling, a license gate, or the sidecar shared token: the feed reads and writes only the local database, needs no key of its own to render or to filter, and calls the sidecar for nothing. The one outbound call, the post-fetch import, is covered by `SEC-01` above.
