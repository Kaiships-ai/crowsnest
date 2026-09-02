# Crowsnest performance review, runtime half

Written at `main` / `8909788`. Report only. No code changed, no commits, no branch switched.
HEAD was verified unchanged at the end of the pass.

Companion to `docs/reviews/2026-08-04-perf-static.md`, which measured SQLite in isolation
and handed two caveats to this pass. This pass measured the running app in a real browser
and answers both. It also contradicts one of them.

## How the numbers were produced

Chromium 1234 from the local Playwright cache, headless, 1440x900, driven against the dev
server already running on `http://localhost:3000`. No production build was run, per the
constraint: `next.config.ts` sets no `distDir` and a build would have clobbered `.next`
under the live server.

Every route was requested twice before measuring so that dev-server compile time is never
billed to a page. Cold means a brand new browser context with an empty HTTP cache. Warm
means three reloads in a context that already holds the bundle, reporting the median.

Timings come from the Navigation Timing and Resource Timing buffers inside the page, long
tasks from a `PerformanceObserver` on `longtask`, and payload sizes from response bodies
observed on the wire. Server response times come from `curl` and from `fetch` against the
same dev server.

Two warnings about what these numbers are not:

- **This is a dev server.** JavaScript is unminified and carries HMR. Every JS figure below
  is a dev figure and says nothing about production bundle size.
- **This is one machine with a 449 video library.** Growth behaviour is the static pass's
  department, not this one's.

Anything marked **derived** was computed from a curve this pass measured, not read off a
single measurement.

## The one-line summary

Nothing in this app is slow today. The two caveats handed over were both worth checking and
both came back different from the prediction: the dashboard pings are real but cost about
10 ms, not 6 seconds, and repeated load-more produces exactly zero long tasks.

The one thing that is genuinely and measurably expensive right now is the dashboard payload.
It ships the entire 449 video library, 508 KB of it, on the first load and again on every
single client-side navigation back to the dashboard.

---

## The two caveats

### Caveat 1: the dashboard's two network pings. Mechanism confirmed, cost refuted.

The static pass predicted a worst case time to first byte of about 6 seconds and asked this
pass to confirm by loading `/` with the proxy stopped.

**The mechanism is confirmed.** The dashboard really does not stream around those awaits.
Measured on the emitted HTML for `/`:

| Signal | Count |
| --- | --- |
| Pending Suspense boundaries (`<!--$?-->`) | 0 |
| Late-stream templates (`<template id="B:`) | 0 |
| Offset of the dependency panel text in the document | 3.2 percent |

There is no Suspense boundary anywhere in that page, and the panel's rendered text
("Instagram sidecar is up") sits near the top of the first and only flush. Nothing about
that page streams progressively.

**The cost is refuted, by two orders of magnitude.** The LLM check is not a model call.
`CompatLlmClient.ping()` at `src/server/llm/client.ts:183` calls `messages.countTokens`, not
`messages.create`. Measured through the 9router proxy on localhost:

| Call | Samples | Measured |
| --- | --- | --- |
| `count_tokens`, what the ping actually sends | 8 | 3.8 to 7.4 ms, median about 6 ms |
| `/v1/messages`, a real generation the ping never sends | 3 | 1.21, 1.52, 2.98 s |
| Sidecar `/health` | 6 | 10.3 to 11.9 ms after the first |
| A refused TCP connection to a dead port | 3 | 0.12 ms |

Attribution for the dashboard, measured:

| Layer | Measured |
| --- | --- |
| Whole dashboard RSC render, all queries plus both pings plus serializing 508 KB | 14 to 16 ms TTFB |
| Whole dashboard HTML document | 60 to 116 ms TTFB |
| SQL and hydration for the same queries (static pass) | 0.13 ms |

Since the entire server render finishes in 14 ms, neither ping can be costing more than
14 ms. Proportionally the pings are the largest single component of dashboard server time,
roughly 10 of those 14 ms, because the SQL is essentially free. In absolute terms they are
noise next to the 508 KB the page then has to serialize and send.

**The proposed experiment would have refuted itself.** Loading `/` with the proxy stopped
shows no slowdown at all, because a stopped proxy refuses the connection in 0.12 ms. The
5 and 6 second timeouts only fire against a dependency that accepts a TCP connection and
then never answers. That is a real failure mode for a wedged sidecar or a proxy stuck on a
model call, but it is not what "the proxy is down" looks like.

**Verdict.** The Suspense fix (static M8) is still correct and still cheap, but it buys
about 10 ms today, not seconds. It should be ranked as insurance against a hung dependency,
not as "probably the largest wall-clock win of anything here". On measured evidence it is
not close to the largest win.

### Caveat 2: load-more long tasks. Refuted. The cost is memory and images instead.

The static pass flagged repeated load-more as "the most likely place to find a long task".
Measured: 18 clicks on `/feed`, growing the grid from 24 cards to all 452, watching every
click.

| Click | Cards | Wall time | Long tasks this click | DOM nodes | JS heap |
| --- | --- | --- | --- | --- | --- |
| 1 | 24 to 48 | 191 ms | 0 | 1,521 | 35 MB |
| 5 | 120 to 144 | 209 ms | 0 | 4,007 | 62 MB |
| 10 | 240 to 264 | 239 ms | 0 | 7,113 | 123 MB |
| 14 | 336 to 360 | 231 ms | 0 | 9,593 | 84 MB |
| 18 | 432 to 452 | 264 ms | 0 | 11,964 | 158 MB |

**Zero long tasks across all 18 clicks.** Wall time grew 38 percent while the card count
grew 18 fold. The prediction that "click N mounts a growing card count" is wrong at the DOM
level: these are App Router client navigations, and React reconciles the identical leading
cards rather than re-creating them, so each click mounts roughly 24 new cards no matter how
long the list already is.

The server still re-renders everything, though, and that part of the prediction holds.
Measured RSC payload per request:

| `?limit=` | RSC bytes | Server time |
| --- | --- | --- |
| 24 | 61 KB | 23 ms |
| 96 | 129 KB | 22 ms |
| 192 | 236 KB | 24 ms |
| 288 | 298 KB | 24 ms |
| 456 | 435 KB | 27 ms |

Payload grows linearly at about 0.86 KB per item while server time stays flat, which is the
static pass's point that the H1 scan dominates either way.

**Derived** from that curve: reaching 452 cards through 18 clicks transfers about 4.6 MB of
RSC, roughly 11 times the 435 KB that a single `?limit=456` request costs. On the wire,
compressed, this pass measured 457 KB total across the 18 clicks, which is consistent with
that figure at the compression ratio repetitive flight data gets.

The costs that are real, all measured at full expansion:

- 11,964 DOM nodes.
- 158 MB JS heap.
- 5.79 MB of thumbnails across 250 resources.

**Verdict.** No long task, so this is not an interaction-latency problem. It is a memory and
bandwidth problem, and it would bite a laptop long before it bit a frame budget.

---

## High impact

### R1. The dashboard ships the whole library, and re-ships it on every visit

Screen: `/`.

The static pass predicted 403 KB from a 913 byte per item estimate. Measured, it is worse,
because the cost repeats.

| Measurement | Value |
| --- | --- |
| Dashboard RSC payload | 508,554 bytes |
| Dashboard HTML document, uncompressed | 652,198 bytes |
| Dashboard HTML document, compressed on the wire | 162,210 bytes |
| Distinct `outlierScore` occurrences in the payload | 462 |
| Non-deleted videos in the database | 449 |
| `/feed` document for comparison | 40,694 bytes |
| Video detail document for comparison | 21,097 bytes |

So the whole library is in there, confirming static H2 at runtime. The dashboard document is
16 times the size of a feed document and 31 times a video detail document.

The part the static pass did not catch: **it is not a per-page-load cost, it is a
per-navigation cost.** Measured on client-side navigation inside the shell:

| Navigation | RSC transferred |
| --- | --- |
| feed to dashboard | 492 KB |
| dashboard to feed | 50 KB |
| feed to dashboard, second time | 492 KB |

The second trip back to the dashboard costs the same 492 KB as the first. Nothing is cached,
so every time the user clicks back to the dashboard they re-download all 449 posts to render
8 ranking rows.

**Fix.** Unchanged from static H2, but the case is stronger. Shape the data on the server and
pass `ScoreRankingList` only the rows it renders plus a count. At 8 collapsed rows and, say,
a 200 row expansion cap, this drops from 492 KB to something in the low tens of KB per
navigation.

### R2. `/feed` fully expanded costs 158 MB of heap and 5.8 MB of images

Screen: `/feed` after using load-more to the end.

Numbers in caveat 2 above. Measured: 11,964 DOM nodes, 158 MB JS heap, 5.79 MB of thumbnails
over 250 resources, and about 4.6 MB of cumulative RSC (**derived**) to get there.

This is ranked high on memory rather than on latency, since the measured long-task count is
zero. A user who reaches the end of a 449 post feed is holding a browser tab about the weight
of a heavy web app, for a screen that is a grid of thumbnails.

**Fix.** As static M2 says, fix H1 first so offset paging is cheap, then append on scroll with
a real offset. Two things this pass would add: the thumbnails want `loading="lazy"` so that
5.8 MB is only paid for what is scrolled to, and past a few hundred cards the grid wants
windowing rather than a growing DOM.

---

## Medium impact

### R3. The Runs SSE stream sends the same 18.7 KB every 2 seconds forever

Screen: `/runs` and `/runs/[runId]`.

The static pass estimated this against `scale.db`. Measured here at today's scale, 40 sync
jobs and 11 remix runs, over a 16 second window with the app idle:

| Measurement | Value |
| --- | --- |
| Ticks received | 8 |
| Average gap | 2,001 ms |
| Payload per tick | 18.7 KB |
| **Distinct payloads across all 8 ticks** | **1** |
| Throughput | 9,592 bytes/s |
| Projected per open tab per hour | 32.9 MB |

Every tick after the first was byte-identical. 100 percent of the traffic on an idle Runs tab
is redundant.

One correction to the static pass's model: the wire cost does **not** grow with library size,
because `slice(0, 50)` at `runs.ts:116` caps the payload. What grows is the read cost, since
the two queries still select every row before slicing. So the static fix is right for the
wrong metric: pushing `LIMIT 50` into SQL fixes the read, and it is the change detection that
fixes the 32.9 MB.

**Fix.** Hold the last serialized payload and only enqueue when it differs. On this
measurement that turns 32.9 MB/hour into approximately zero, and it is a smaller change than
the SQL one. Add a comment-only heartbeat every 15 s to keep the connection alive.

### R4. Dashboard TTFB is twice every other screen, and the payload is why

Warm medians, three reloads each:

| Screen | Warm TTFB | Cold TTFB | Cold FCP | Cold LCP | Warm LCP |
| --- | --- | --- | --- | --- | --- |
| `/` dashboard | 73.6 ms | 83.9 ms | 436 ms | 936 ms | 228 ms |
| `/feed` | 37.9 ms | 35.2 ms | 500 ms | 664 ms | 164 ms |
| video detail | 35.3 ms | 35.2 ms | 332 ms | 480 ms | 204 ms |

The dashboard is about 2x the other two on TTFB and has the worst cold LCP at 936 ms. Given
that its server render is 14 ms and its pings are about 10 ms of that, the extra time is
serializing and shipping the 508 KB from R1, not query work and not the pings.

Every number here is comfortable in absolute terms on localhost. This is ranked medium
because it is the one screen where a real regression would show up first, and R1 is the
lever.

### R5. The frame pass ran for 64 seconds, well past the 22 to 40 second working estimate

Screen: video detail, `Re-run frame pass`.

Measured on video `a0ed7179`, which already had two successful passes:

| Measurement | Value |
| --- | --- |
| Wall clock, DB `started_at` to `finished_at` | 64.2 s |
| Frames sampled | 58 |
| Outcome | success |

The pass is a model call and slowness is by design, so this is not a perf bug. It is an
expectations problem: 64 s is 1.6x the top of the range this swarm was working from, and the
only feedback during it is a button reading "Running...". A user with no progress signal for
over a minute has no way to tell a working pass from a wedged one.

**Fix.** Not the duration. Surface the frames-sampled progress that the job row already
tracks, or at minimum state the expected duration next to the button.

---

## Low impact

### R6. `/feed` has the only long task on any screen, at hydration

Measured on `/feed`: one long task, 104 ms cold and 83 ms warm. Dashboard and video detail
recorded zero long tasks on both cold and warm loads.

It fires once, during hydration, not on interaction. At 104 ms it is over the 50 ms long-task
threshold but nowhere near a user-visible stall. Recording it because it is the only one in
the app and would be the first thing to watch if feed hydration grows.

### R7. Verified as fine: the frame pass does not block the UI

The lead asked specifically whether the page blocks during a frame pass. It does not.
Measured across the full 67 second run, sampling every 2 seconds:

| Measurement | Value |
| --- | --- |
| Long tasks during the entire run | 0 |
| Worst animation frame gap | 22.9 ms |
| Typical animation frame gap | 17.7 ms |
| Navigation away after the run | works |

17.7 ms is a clean 60 Hz. The single worst frame in 67 seconds was 22.9 ms, which is one
dropped frame. The work is out of process, and the page is doing nothing but polling.
Recording this so nobody goes looking for a main-thread problem here.

### R8. Dev-mode JavaScript is about 1.1 MB per route, and this number means nothing

Cold JS transferred: 1,095 KB on `/`, 1,142 KB on `/feed`, 1,145 KB on video detail. Warm,
after caching: 7.5 KB.

This is unminified dev output with HMR attached. It is recorded only so that nobody mistakes
it for a production figure, and so the next pass has a before number if the dev bundle ever
doubles.

---

## Not measured

**Production bundle sizes.** Same reason as the static pass: no `distDir`, live dev server,
a build would have clobbered it. The static pass expected this to be unremarkable and
nothing measured here contradicts that, since the RSC payloads in R1 and R2 dwarf any
plausible JS bundle.

**Behaviour against a hung dependency.** Confirming the 5 and 6 second timeouts needs a
dependency that accepts a connection and never answers. Producing one means either editing
config to repoint a URL or interfering with the user's running sidecar and 9router, and this
pass is report-only. What is measured instead is the ping's real cost when healthy (about
10 ms) and the refused-connection cost when dead (0.12 ms), which together bound the problem:
the timeouts are unreachable except in the hung case.

**Growth.** Everything here is at 449 videos on one machine. Scaling behaviour is the static
pass's measurements on `scale.db`, not this one's.

---

## What this pass changes about the static pass's order of work

The static pass ranked M8, the Suspense wrap, as item 4 and called it "probably the largest
wall-clock win of anything here". Measured, it is worth about 10 ms today. It is still worth
doing as insurance against a hung dependency, but it should drop down the list.

What moves up is static H2, which this pass measured as R1. It is not a 403 KB one-time cost,
it is a 492 KB cost repeated on every navigation back to the dashboard, and it is the largest
measured number in either half of this review.

Suggested revision, measured benefit first:

1. **H1**, the `IS NULL` sort key and the `outlier_score` index. Unchanged at the top: 241x,
   two lines, and it unblocks H3 and M2.
2. **H2 / R1**, stop shipping 449 posts to a client component. 492 KB per dashboard
   navigation, measured, today.
3. **M5 / R3**, skip unchanged SSE payloads. 32.9 MB/hour per idle tab, measured, and the
   change-detection half is smaller than the SQL half.
4. **H4**, the `posted_at` index and the SQL sparkline.
5. **M8**, the Suspense wrap, demoted. Correct, cheap, worth about 10 ms.
6. **H3**, then **M1**, **M3**, **M4**.
