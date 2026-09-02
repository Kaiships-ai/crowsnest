# mine: concept brief

My channel: posts, metrics, the calendar, and planned posts.

## What it is

mine is the my channel page at `/mine`: the one screen for the buyer's own Instagram
channel, as opposed to the tracked competitors that fill the feed. It shows a header
naming which channel is theirs, a band of Graph API metrics (followers, reach, saves,
shares, median reach, posts measured) with a progress bar toward a usable median, a
reach-by-post strip, and a tab strip that switches between a Month planner calendar, a
Posts list, and a weekday Metrics chart. Below the metrics it owns the planner: a
seven-column month grid of planned and published days, and the plan dialog that creates
or edits a planned post (a dated intention to publish, optionally carrying a script).
Every planned post can be opened in the studio to cook it (`/mine/{postId}/studio`).
The full behaviour is in [03-feature-description](03-feature-description.md) and
[04-test-cases](04-test-cases.md).

## Why it exists

The rest of crowsnest is about other people's channels — analyzing competitor reels and
mining outliers. mine is the one place turned inward: it answers "how is my own account
doing, and what am I planning to post". It exists so the buyer can (1) see their real
published performance measured through the Instagram Graph API (a separate identity and
code path from the instagrapi sidecar, which never touches the own channel), and (2) keep
a lightweight, honest plan of what to publish, without any auto-publish machinery. A
planned post is inert: nothing here publishes or reminds; a plan becomes published only
when the buyer marks it so by hand. The planner and the metrics deliberately do not need
each other — plans need no Graph connection, so the calendar renders even on a fresh
machine with no token, while the metrics band gates on a live measurement.

## Boundaries

mine owns the my channel page frame, the two gates that decide what it can show (whether
a channel is marked own, and whether the Graph token is usable), the planner calendar,
the plan dialog, and the read-only posts/metrics displays. It does not own the studio
(the `[postId]/studio` route hands off to the [studio](../studio/01-concept-brief.md)
component) or the remix flow that produces a script. It does not own the vault at
`/vault` (saved posts, scripts, hook/style templates), the ideas inbox at `/ideas`, or
the persona at `/persona` — each is a separate route and component; mine only reads the
vault's scripts to offer them in the plan dialog. Own posts are read-only here: the only
writer is a Graph measurement (`measureOwnChannelAction`); the instagrapi sidecar writes
tracked videos, never own posts, so a sync never changes this page. Marking a channel own
is a single durable flag (`channels.isOwn`); there is no control on this page to clear it
(`unsetOwnChannelAction` exists but the page never calls it — see B-15 in
[05-backlog-to-enhance](05-backlog-to-enhance.md)).
