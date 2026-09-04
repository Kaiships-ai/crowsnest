# feed: backlog to enhance

Bugs and enhancements for feed. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| B-05 | Save to Vault both can half-write and a retry duplicates the row that landed | medium | bug | bug-triage | done |
| B-10 | The video analysis summary field is rendered but never written | low | bug | bug-triage | open |
| B-12 | Generate idea does not gate on a key or reflect an existing idea | low | bug | bug-triage | open |
| B-14 | notFound on the video detail route returns HTTP 200 instead of 404 | low | bug | bug-triage | done |
| B-16 | Quick preview shows a soft-removed video with no removed marker | low | bug | bug-triage | open |
| OBS-1 | Feed caption overlay unreadable (white text on a scrim that fades under it) | medium | bug | observed-bugs | open |
| OBS-2 | 1 results hardcoded plural on the feed count | low | bug | observed-bugs | open |
| FEED-Q1 | Default-view logic for a bare /feed visit is conflicting: page.tsx applies High Conviction, but code comments in feed-filters.ts and resolve-feed-nav.ts still describe the full library as the default | medium | bug | product-description open question | open |
| FEED-Q2 | Two tabs can save a view under the same name with no deduplication | low | enhancement | product-description open question | open |
| FEED-Q3 | The quick preview sheet has no error branch on a failed server read, so a rejected fetch leaves it stuck on its placeholder bars instead of showing an error or the not-found state | medium | bug | product-description open question | open |
| B-17 | A missing videoId on /feed/[videoId] renders the not-found page but returns HTTP 200 instead of 404 (confirmed in a production build, not only dev). Root cause is the shell ancestor loading boundary src/app/(shell)/loading.tsx: the page suspends on its first await (getCachedVideoDetail), the shell flushes a 200 before notFound() throws, so the status is already committed. The B-14 fix (moving the feed list into (list)/ so no sibling loading boundary wraps [videoId]) addressed the sibling but not this (shell) ancestor. The page-level code order is correct (getCachedVideoDetail then notFound() then the in-page Suspense); fixing the status needs the [videoId] route to sit outside the (shell) loading boundary or that boundary to be scoped differently. Pre-existing since the Wave 1 shell loading skeleton landed, not introduced by the Wave 3 streaming change. Fixed in PR #53: the generic loading and every non-feed route moved into a (shell)/(loaded) route group, leaving /feed outside it, so notFound() now returns a real 404 (verified in a prod build). | medium | bug | ui-wave3-round1 | shipped |
