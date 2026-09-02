# ig-sync: concept brief

The Instagram sync sidecar (instagrapi): pulling posts and counters for tracked channels.

## What it is

ig-sync is a localhost-only Python service (`services/ig/`) built on `instagrapi`, holding
one long-lived authenticated Instagram session that the Next.js app talks to over HTTP,
authenticated with a shared secret (`IG_SERVICE_TOKEN`). It is the only thing in crowsnest
that ever logs in to Instagram or sees an Instagram CDN URL. For each tracked channel it
syncs the profile plus every post from the last 30 days (`LOOKBACK_DAYS`, a hard cap of
`MAX_ITEMS_PER_SYNC` per run), downloads thumbnails and, on demand, video, and writes them
into the app's own storage so the app never renders a signed Instagram URL that will expire
within hours. Carousels are stored as one video row with child rows, not as separate posts.
A sync that finds a post no longer on the source soft-marks it deleted rather than removing
the row, so anything built on top of it (a saved post, a planned post) degrades gracefully
instead of losing its link outright.

## Why it exists

crowsnest's whole purpose is analyzing other creators' reels, accounts crowsnest does not
own and cannot get authorized for. Instagram's official Graph API only exposes another
account's coarse public counters, not the view and play counts the product is built
around, and the Basic Display API that once served this need was shut down in 2024.
instagrapi, which drives Instagram's private mobile API, is therefore the only path that
can enumerate an arbitrary creator's media at all, chosen with the trade-off stated
plainly rather than hidden: it is against Instagram's Terms of Service, and the logged-in
account can be rate-limited, challenged, or permanently banned, which is why it is meant to
run against a throwaway account, not one the user cares about. A previous provider
(Apify) was replaced entirely by this sidecar so the product does not depend on a paid
third-party scraping vendor either.

Being Python while the app is Node is a real service boundary decision, not an accident: a
long-lived sidecar process is the only shape where one warm authenticated session,
request pacing, and "recover from an invalidated session" are real code paths, rather than
every call paying a fresh login's risk of getting the account flagged.

## Boundaries

ig-sync owns Instagram authentication (including two-factor and challenge handling),
fetching a channel's profile and recent media, downloading the assets it needs into the
app's own media storage, and reporting a typed error (never a silent empty result) when it
cannot reach Instagram or its own session has gone stale. It does not own the burner
account's credentials reaching the app: `IG_USERNAME` and `IG_PASSWORD` are read by the
sidecar process only and are never sent to or rendered by the Next.js app. It does not
cover the user's own channel: a separate, proposed Graph API path for that account was
designed but never built, is a different identity entirely, and by design must never share
code or an environment variable prefix with this sidecar. Whether a given sync run
actually completes against a live Instagram account with real credentials is called out as
unverified in [packaging and release](../../shared/packaging-and-release.md); the buyer
test that exercised the Kit installer left the Instagram fields blank.
