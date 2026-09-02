# Reel view count spike: where the number actually lives

Date: 2026-08-03
Status: resolved, implementation pending
Supersedes the root cause recorded in docs/superpowers/specs/2026-08-03-ui-polish-and-view-counts.md item 1.

## Verdict

Instagram does give us a real play count for reels the burner does not own. We never ask for it.

The listing call the sync uses, `user_medias_paginated_v1`, returns `play_count: 0` on every row.
The single media call, `media_info_v1`, returns the real number for those same reels. Same account,
same session, same private API, different endpoint.

Measured on four reels across four channels, all stored in our database with a null view count:

| channel | media pk | play_count from media_info_v1 | view_count |
| --- | --- | --- | --- |
| @hormozi | 3947428541755620601 | 371200 | 0 |
| @chase.h.ai | 3953680588034512478 | 19358 | 0 |
| @jun_yuh | 3953894690809843161 | 1212937 | 0 |
| @nick_saraev | 3954232570840851618 | 94988 | 0 |

Four for four. Every one of those rows renders a dash today.

## What this corrects

The earlier finding said instagrapi returns zero view counts for every reel it syncs, and treated
that as a property of instagrapi or of non-ownership. It is neither. It is a property of the
listing response. The stored evidence agrees: `json_extract(raw_payload, '$.play_count')` is 0
across all 299 video rows, and all 299 payloads came from the listing call.

## Which field carries the signal

`play_count`, not `view_count`. `view_count` came back as 0 on the detail call too, on all four
reels. The mapper at `src/server/ig/client.ts:215` already prefers `play_count`:

```ts
viewCount: nonZero(m.play_count) ?? nonZero(m.view_count),
```

So no mapper change is needed. Get the detail payload to that function and the existing code
renders the number.

## Paths that were tried and rejected

`media_info_gql`, the public GraphQL variant. The instagrapi docs suggest the public GraphQL path
can expose play and view counts where Instagram hides them. Tested anonymously on the @hormozi
reel: it reached Instagram and returned real like and comment counts, so the call worked, but
`view_count` came back as `None` and `play_count` as 0. Not the answer.

Session authenticated GraphQL calls returned HTML instead of JSON, raising
`ClientJSONDecodeError`. That reads as anti bot behavior on those endpoints rather than an account
problem. The account kept working afterwards.

`media_info`, the dispatcher, does not help on its own. In the pinned instagrapi it calls
`media_info_v1` first whenever private auth is present (`mixins/media.py:690`), falling back to the
public path only on an exception. Since we are always logged in, it already takes the v1 route.
That is fine, because v1 is the route that works.

Graph API business discovery stays ruled out for tracked channels, per docs/research/DATA.md. It
returns likes and comments for another creator's media, never view or play counts. The own account
Graph client at `src/server/graph/client.ts` is unrelated to this and untouched.

yt-dlp is not needed. It reads `view_count` from the public web page and already exists at
`src/server/providers/ytdlp.ts:33`, deliberately outside the sync chain. Three reasons it lost:
the sidecar can get the number without it, it costs a subprocess per reel where the sidecar costs
one request, and it reports a different metric than `play_count`. With no provenance column, mixing
the two would leave the outlier maths comparing numbers that do not mean the same thing.

It stays documented here as the fallback if Instagram ever starts throttling the burner, since it
is the one path that costs zero burner traffic.

## Constraints the implementation has to respect

One request per reel. The listing call brings back 33 reels at a time. Play counts do not come
free with it. Enriching all 290 live blank rows is at least 290 requests from the burner.

Request amplification is real. instagrapi retries public requests up to three times
(`mixins/public.py`, `public_request_retries_count = 3`) and some calls fetch a token first. During
the spike, four logical calls produced at least eight actual HTTP requests. Pacing has to count
real requests, not function calls.

Soft deleted rows raise `MediaNotFound`, correctly. One of the 299 video rows has `deleted_at` set
because a prior sync saw it removed from Instagram. The first confirmation attempt picked it and
read the error as a possible block, which it was not. The enrichment job should filter on
`deleted_at is null`, treat `MediaNotFound` as skip and continue, and treat any other error as
stop.

Only reels are proven. All four confirmations were `product_type: clips`. Behavior on plain videos
that are not reels is untested.

## Decisions taken

Kai's calls during the spike:

- Enrich recent reels per channel, not all 290 rows. This is what caps burner traffic.
- No `view_count_source` provenance column.
- No backfill of the existing blank rows as part of this work.
- Leave the 8 stale @kallaway numbers alone.
- No Graph API tokens. The own channel stays out of scope.
- Drop yt-dlp from the build, keep it here as the fallback.

## How the spike was run

Read only throughout. No repo file was modified, no database write, no git operation, and the
sidecar was never started. Session reuse only, through `cl.load_settings` on the existing session
blob, never a fresh login. Probe scripts were written to the session scratchpad, not the repo.
