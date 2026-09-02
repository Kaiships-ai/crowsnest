# UX flows 04: own channel and system

Scope: nine flows in two groups. Group G is Kai's own Instagram channel inside Crowsnest
(dashboard, comparison against competitor outliers, and three deferred analysis
prototypes). Group H is the system surface (settings, command palette, a Claude Code pane
docked in the app, and the MCP tool surface Crowsnest would expose to Claude Code).

Almost none of group G exists in code. Nothing in H3 or H4 exists. This document designs
those flows rather than describing them, and every block says which it is doing. Where a
real function, table or file already exists it is named. Where something is invented it is
marked "new".

Three facts shape every screen below and are worth stating once:

1. The account is tiny. kaiships.ai has 8 posts and about 5 followers, and carousels have
   been reaching about 9 people each. Every number in group G is a small integer. A change
   of one person is a 10 percent swing. No screen in group G may render a trend line, a
   percentage change, or the word "up" without also rendering the sample size next to it.
2. Two Instagram identities exist and must never touch. Own channel data comes from the
   Instagram Graph API using a long lived token in Crowsnest's own `.env.local`.
   Competitor data comes from a burner account through the Python `instagrapi` sidecar
   (`IG_SERVICE_URL`, see `src/components/settings/instagram-section.tsx`). These are
   separate credentials, separate transports, separate tables, separate code paths.
3. The unit of measurement differs between the two sides. Own posts report reach (unique
   accounts). Competitor posts report a view or play count scraped by instagrapi and
   stored as `videos.viewCount`. Reach and views are not the same quantity and must never
   be put in the same column as if they were. This is the central design problem of G2.

## Notation

- **Status** is one of: built, partly built, not built.
- "new" after a function or table name means it does not exist and would have to be
  written.
- A metric named in prose without a Graph API string next to it means the exact API metric
  name is unknown and needs verification. See the metric coverage note below.

## Metric coverage: what the working client actually pulls

`Kai-Official-OS/.claude/commands/ksa/serve/ig_stats.py` is the proven Graph API client.
Reading it, `fetch_posts` requests exactly this metric string per post:

```
reach,saved,shares,total_interactions,comments,likes
```

plus `views` when `media_product_type == "REELS"`. Media fields requested alongside are
`id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,caption`.
Account level, `fetch_account` requests `id,username,followers_count,follows_count,media_count`.

The brief for G1 asks for reach, saves, shares, profile visits, follows from post, and
reel watch time. The first three are covered. **Profile visits, follows from post, and
reel watch time are not requested by `ig_stats.py` today, and the exact Graph API metric
names for them at the API version in use are unknown.** They are not in the code, so they
cannot be copied out of it. G1 below designs the tiles for them and marks them unverified.
Do not ship a tile for a metric until a real API call has returned it once.

`ig_stats.py` also carries a comment classifier (`classify_comment`) that buckets comments
into organic, self-test, bot-reply, and own-comment, using two hardcoded string sets
(`SELF_TEST_TEXT`, `BOT_REPLY_TEXT`). Its own report file says plainly that this is a text
match and will silently miscount if the auto-reply copy changes. Any Crowsnest screen that
shows an organic comment count inherits that caveat and must show it.

---

## Group G: own channel

### G1. Own channel dashboard

**Status.** Not built. Nothing in `src/` reads the Graph API. There is no own-channel
route, no nav item, no table. The existing dashboard at `src/app/(shell)/page.tsx` and
`src/server/queries/dashboard.ts` covers tracked competitor channels only. This block is a
design.

**Entry.**
- New sidebar nav item, proposed label "My channel", proposed route `/me`. Added to
  `NAV_ITEMS` in `src/components/layout/nav-items.ts`, which the sidebar and the command
  palette both read, so one edit puts it in both.
- Command palette: typing "my channel", "reach", or "my posts" jumps here.
- From Settings, the own channel section has a "View my channel" link.
- From a competitor outlier's detail page, a "Compare with my post" action lands on G2,
  which shares this data.

**Screen.** Top to bottom.

1. **Header row.** `@kaiships.ai`, followers, following, posts published. These come from
   the account call and are four small integers. Next to them, the timestamp of the last
   successful pull, in the form "measured 2 hours ago". If the pull is older than 24 hours
   the timestamp turns amber. Nothing on this page is live; it is a snapshot with a date,
   and the date is part of the number.
2. **Token status strip.** Always rendered, never hidden when healthy. Three states:
   healthy (green dot, "token valid, expires in N days"), expiring (amber, N days less
   than 14), dead (red, with the error and the refresh instruction). Detailed in the
   Failure section.
3. **Sample size banner.** A single line above the tiles: "8 posts measured. At this size a
   single person moves a number by more than 10 percent. Treat everything below as a
   reading, not a trend." This banner is unconditional until the post count passes a
   threshold (proposed 30, matching the G3 gate). It is not dismissible.
4. **Metric tiles.** One row, reusing `StatTile` from `src/components/dashboard/stat-tile.tsx`
   for visual consistency with the competitor dashboard. Proposed tiles:
   - Reach, last 30 days (sum across posts in window)
   - Saves, last 30 days
   - Shares, last 30 days
   - Profile visits, last 30 days (unverified metric, see below)
   - Follows from post, last 30 days (unverified metric)
   - Reel watch time (unverified metric, reels only)

   The `StatTile` component supports a sparkline. **Do not pass one here.** A 12 bucket
   sparkline over 8 data points where each point is a single digit draws a shape that
   reads as a trend and is noise. The sparkline slot stays empty for group G until the
   sample size banner comes down.

   Any unverified tile renders in a distinct "not wired" state: the label, a dash instead
   of a number, and the text "not requested by the API client yet". It is visible so the
   gap is visible, and it never shows a zero, because a zero would be read as a
   measurement.
5. **Post table.** One row per post, newest first, mirroring the columns `build_report` in
   `ig_stats.py` already produces so the two surfaces agree: published time, format (Reel,
   Carousel, or the raw media type), reach, views (reels only, "n/a" otherwise), likes,
   saves, shares, permalink. Plus two Crowsnest additions: a reach index column (this
   post's reach divided by the account median reach, rendered as "1.4x" or "below median")
   and a "Compare" button that opens G2 for that post.
6. **Format comparison block.** Reel versus carousel or image: post count, total reach,
   mean reach, total saves. Same aggregation as `build_report`'s format table. Each row
   shows its own n. A format with fewer than 5 posts is labelled "n too small to compare"
   next to its mean rather than being hidden, because hiding it would suggest the format
   was never tried.
7. **Comments block.** Counts per comment kind from the classifier, then the organic count
   on its own line, then every organic comment verbatim with author, timestamp and
   permalink. When there are none, the copy is the one `ig_stats.py` already uses in
   spirit: no stranger has commented yet, so do not read the comment count on a post as
   demand. Below the block, the classifier caveat, always shown.

**Actions.**
- **Measure now.** Triggers a fresh Graph API pull for account, posts and comments. Button
  disables while running and shows a spinner. On success the page revalidates and the
  measured timestamp updates.
- **Compare** (per post row). Opens G2 with that post preselected.
- **Open on Instagram** (per post row). Opens `permalink` in a new tab.
- **Copy report to clipboard.** Renders the current snapshot as the same markdown
  `build_report` emits, for pasting into the vault or a chat.
- **Export snapshot to file.** Writes the markdown to a chosen path. Whether this should
  write into the Kai-Official-OS vault path is an open question below.
- **Re-check token.** In the token strip. Makes the cheapest possible authenticated call
  (the account fields call) and re-renders the strip from the result.

**System.**
- New route `src/app/(shell)/me/page.tsx`, `dynamic = "force-dynamic"` for the same reason
  the existing dashboard and settings pages set it: this reads live state on every load
  and must not be frozen at build time.
- New server module `src/server/graph/client.ts` (new): a TypeScript port of
  `ig_stats.py`'s three fetch functions. It must reuse the same metric strings verbatim so
  the two clients cannot drift. It must redact the token from any error body before the
  error leaves the module, exactly as `_get` in `ig_stats.py` does.
- New tables (new), deliberately separate from `videos` and `channels`:
  - `own_account_snapshots`: id, capturedAt, username, followerCount, followsCount,
    mediaCount.
  - `own_posts`: id, externalId (Instagram media id), permalink, mediaType,
    productType, format, caption, postedAt, firstSeenAt, lastMeasuredAt.
  - `own_post_insights`: id, ownPostId, capturedAt, reach, saved, shares,
    totalInteractions, comments, likes, views, plus nullable columns for the three
    unverified metrics. One row per measurement, not one row per post, so the history of a
    post's reach is preserved and a later diff (G4) has something to diff.
  - `own_comments`: id, ownPostId, externalId, author, text, postedAt, kind. `kind` is the
    classifier output.

  Why separate tables rather than a row in `channels` with a flag: a flag would put own
  posts inside `getOutlierFeed`, `getDashboardStats`, `scoreVideos` and every other query
  in `src/server/queries/` by default, and each of those would then need an exclusion
  clause that someone will forget. Separation makes the identity rule structural instead
  of a convention.
- New `computeOwnMedianReach` (new) in a new `src/server/services/own-metrics.ts`. It
  mirrors `computeChannelMedian` in `src/server/services/outlier-calc.ts` (trailing window,
  `MIN_USABLE = 5`, returns null when the median is zero) but takes reach instead of view
  count. It must be a separate function, not a reuse with a swapped field, because the two
  quantities are not interchangeable and a shared function invites exactly that mistake.
- Measure now runs as a server action (new, `src/server/actions/graph-actions.ts`)
  following the shape of the existing `src/server/actions/ig-actions.ts`: it never throws,
  it returns a discriminated result with an error code, and the UI renders every code as a
  distinct state.

**Failure.**
- **Token missing.** `.env.local` has no Graph token. The page renders the header shell and
  a single panel: "No Instagram Graph token configured", the env var name, and the
  instruction to paste a long lived token into `.env.local` and restart the dev server.
  No tiles, no zeros. This is the same discipline the API keys section already follows in
  `src/components/settings/api-key-status-card.tsx`.
- **Token expired or revoked.** The API returns an auth error. Token strip goes red with
  the API's own message (token redacted), and the page keeps rendering the last stored
  snapshot with a banner reading "showing the snapshot from <date>, live pull failed".
  Stale data with a date on it is more useful than a blank page, but it must be labelled.
  The refresh instruction points at the existing refresh path that measure.md documents:
  `ig_publish.py refresh`, run before the 60 day expiry.
- **Token near expiry.** Amber strip at fewer than 14 days remaining. See the open question
  on how expiry is computed.
- **Rate limited.** The Graph API returns a rate limit error. Strip shows "rate limited,
  try again later", Measure now disables for a cooldown, and the stored snapshot stays on
  screen.
- **Network unreachable.** Same treatment as rate limited but with the network message.
  Distinguishable in the copy, because the fixes differ.
- **Partial pull.** `fetch_posts` in `ig_stats.py` attaches `_error` to a single post's
  insights when that post's insights call fails while the rest succeed. Crowsnest must
  keep that granularity: the failed post's metric cells render "failed" rather than zero,
  and the aggregate tiles show "n of 8 posts measured" so a sum that is low because a pull
  failed cannot be mistaken for a sum that is low because reach was low.
- **Insights unavailable for old posts.** Instagram does not serve insights for every post
  forever. A post with no insights renders as "no insights available" rather than zero.
- **Comment fetch fails while posts succeed.** Comments block shows its own error, the rest
  of the page renders normally.

**Empty.** The normal case right now. Two distinct empties:
- Token configured, no measurement ever taken: "No measurement yet" plus a primary
  "Measure now" button. No tiles.
- Token configured, measurement taken, account has zero posts: header renders real zeros
  (they are measured), post table shows "no posts published yet", format and comment blocks
  are hidden entirely rather than shown empty.

**Open question.**
- How is token expiry computed? The token string does not carry a readable expiry, and
  whether the Graph API host in use exposes a token debug endpoint is unknown. Options:
  (a) store the issue date manually in `.env.local` as a second variable and count 60 days
  from it, which is simple and drifts if Kai refreshes without updating it; (b) call a
  debug endpoint if one exists; (c) show only "last successful call" and no countdown,
  which is honest but gives no warning. Kai's call.
- Should "Measure now" also write the markdown report into the Kai-Official-OS vault path
  that `/ksa:measure` uses, or does Crowsnest keep its own history and leave the vault to
  the slash command? Writing to both risks two sources of truth. Not writing means running
  the measurement twice.
- Route and label: `/me` and "My channel", or something else. The word "channel" already
  means competitor in this app's vocabulary.
- Which of the three unverified metrics matter enough to spend an API investigation on
  first? Follows from post is arguably the only one tied to the follower goal.

---

### G2. Your post against competitor outliers, side by side

**Status.** Not built. This is the centrepiece of the group and the one thing Crowsnest can
do that Kai's existing tooling cannot: Kai-Official-OS measures the own account and knows
nothing about competitors, and the competitor side of Crowsnest knows nothing about the own
account. This flow is the join. Everything below is a design.

**Entry.**
- From G1's post table, the "Compare" button on a row.
- From a competitor video detail page, a "Compare with my post" action that opens this
  screen with the competitor post preselected and an own-post picker open.
- Command palette: "compare".
- Direct route, proposed `/me/compare?mine=<ownPostId>&against=<videoId>,<videoId>`.

**Screen.** Two columns on wide screens, stacked on narrow. Left column is always the own
post. Right column is one competitor outlier at a time, with a strip of alternates above
it.

1. **Comparison basis banner.** The most important line on the page, above everything:
   "Your reach and their views are different measurements and are not compared directly.
   Both sides are shown as a multiple of that account's own median." Not dismissible. This
   exists because the raw numbers are 9 against several thousand, and a screen that puts
   them side by side without this line teaches a false lesson every time it is opened.
2. **The index row.** Two large numbers, one per column, both dimensionless:
   - Left: own post reach divided by own median reach, from `computeOwnMedianReach` (new).
     Rendered as "1.4x your median" with "median from 8 posts" beneath it.
   - Right: the competitor post's `videos.outlierScore`, already computed by `scoreVideos`
     in `src/server/services/outlier-calc.ts` as view count divided by that channel's
     median, rounded to one decimal. Rendered as "6.2x their median" with "median from N
     posts" beneath it.

   Both denominators are printed. A ratio without its denominator is where the lie gets in.
3. **Raw numbers, in separate boxes, clearly labelled by unit.** Left box: reach, saves,
   shares, likes, comments. Right box: views, likes, comments, and share count where
   `videos.shareCount` is populated. The two boxes are visually separated and never share a
   row, so no eye can accidentally read across.
4. **Structure comparison.** The part that is actually actionable.
   - Left: the own post's caption, format, and (new) a hook and structure breakdown
     produced by running the same analysis path the competitor side uses.
   - Right: the competitor post's `video_analyses` row from
     `src/server/services/analyze.ts` (`getOrCreateAnalysis`): hook type, structure
     segments with timings, format tags, style tags, why it worked.
   - Rows align by field, so hook type sits against hook type.
   - Where the own post has no analysis yet, the left cell shows "not analyzed" plus an
     "Analyze my post" button, not a blank.
5. **Transcript comparison.** Side by side transcripts where both exist. Own post
   transcript is new (own reels are not currently downloaded or transcribed). Competitor
   transcript comes from the `transcripts` table.
6. **Difference summary.** A generated paragraph naming concrete structural differences
   (hook type, opening seconds, segment count, format tags present on one side and not the
   other). Generated by the local LLM proxy, since this is a text task. It must be labelled
   as generated, and it must not make a causal claim about reach. The prompt has to forbid
   sentences of the form "your post underperformed because X". With n of 1 on the left
   side, no such claim is supportable.
7. **Alternates strip.** Up to 6 competitor outliers from the same niche, ranked by
   `outlierScore`, each a small card. Clicking one swaps the right column.

**Actions.**
- **Swap the competitor post.** Click an alternate card, or open a picker that runs the
  existing feed query.
- **Swap my post.** Dropdown of the 8 own posts.
- **Analyze my post.** Runs the analysis chain on the own post (transcribe if needed, then
  analyze) and fills the left structure column.
- **Regenerate difference summary.**
- **Save to vault.** Turns an observed structural difference into a `vault_items` row of
  type hook or style, reusing the existing vault write path so the finding lands where
  Remix already looks.
- **Open Remix from this comparison.** Starts a remix session on the competitor post with
  the comparison notes attached as context. Uses `getOrCreateSession` in
  `src/server/services/remix.ts`.
- **Copy comparison as markdown.**

**System.**
- New route `src/app/(shell)/me/compare/page.tsx`.
- New query `getComparison(ownPostId, videoIds)` (new) that reads `own_posts` and
  `own_post_insights` on one side and `getVideoDetail` from
  `src/server/queries/video.ts` plus `videoAnalyses` and `transcripts` on the other, and
  returns them as two explicitly typed halves. The return type must not have a shared
  "metrics" shape across both halves. Different types on the two sides is what stops a
  future component from rendering them in one table.
- Own-side index from `computeOwnMedianReach` (new). Competitor-side index read straight
  off `videos.outlierScore`, never recomputed here.
- Alternates from `getOutlierFeed` in `src/server/queries/feed.ts` with a score filter.
- Difference summary through the existing `LlmClient` in `src/server/llm/client.ts`, which
  already supports the OpenAI compatible router mode (`isCompatMode`, `CompatLlmClient`) for
  the local proxy. Text task, so local proxy, per the settled decision.
- Own post analysis reuses `getOrCreateAnalysis`. That function keys off `videos.id`, so
  either it gains an own-post code path or own analyses get their own table
  (`own_post_analyses`, new). The second keeps the identity separation clean and is the
  recommendation.

**Failure.**
- **No competitor median.** `computeChannelMedian` returns null when a channel has fewer
  than 5 posts with a view count, or when the median is zero. The right index then shows
  "no median for this channel yet" instead of a number, and the whole index row is
  suppressed rather than showing one side only.
- **No own median.** Same rule. With 8 posts a median exists, but if reach is missing on
  several posts the usable count can drop below 5. Then the left index reads "not enough
  measured posts for a median (N of 5)".
- **Own post has no insights.** Left column renders the post with a "no insights" note; the
  structure comparison still works, which is most of the value.
- **Analysis fails.** The LLM call errors. The structure cell shows the mapped error from
  `src/server/llm/error-message.ts` and a retry button. The rest of the page stays.
- **Local LLM proxy down.** The difference summary block shows "the local model proxy is
  not answering" with the proxy URL, and everything measured stays on screen. The summary
  is the only part that needs the model.
- **Competitor post soft deleted.** `videos.deletedAt` set. The right column renders the
  stored copy with a banner: "this post is no longer on the creator's timeline; showing
  what was captured on <date>".
- **Transcript missing on one side.** That side shows "no transcript" and a button to
  create one. Not an error.

**Empty.**
- No own posts measured: the whole flow is unreachable, and the entry points explain why
  ("measure your channel first") and link to G1.
- Own posts measured but no competitor channels tracked: the left column renders alone and
  the right column holds the same message the existing dashboard uses when
  `channelsTracked` is zero, with a link to `/channels`.
- Own posts and competitors both present but no competitor scores above the outlier
  threshold: the alternates strip explains that no tracked post has cleared the threshold
  yet and offers a plain "most viewed" fallback, labelled as such.

**Open question.**
- Is the multiple-of-own-median index the right shared axis, or does Kai want an absolute
  view where the size gap is the point? The index is honest about structure and hides the
  size gap. An absolute view is honest about the gap and useless for comparing formats.
  Possibly both, behind a toggle, with the index as the default.
- Should the comparison be one own post against one competitor post, or one own post
  against a set (median of five outliers)? A set is statistically less silly on the right
  side but harder to read.
- Should the difference summary be allowed to say anything at all about why reach differed,
  or is it strictly a structural diff? The recommendation above is strictly structural.

---

### G3. Content strategist report

**Status.** Not built, and deliberately deferred. The build gate is 30 published posts on
the own account. The account has 8. What ships now is the gated state, not the report. The
gated state is a real screen with real work in it, and the report behind it is a prototype
described on paper.

**Entry.**
- Tab or section on `/me`.
- Command palette: "strategist report".

**Screen, before the gate is met (the state that ships).**
1. Heading, "Content strategist report".
2. A progress line: "8 of 30 posts. This report needs 30 to say anything that is not noise."
3. A short explanation of why the gate exists, in Kai's own measurement discipline
   language: at this size an insight can be one person, and a strategist report built on 8
   posts would produce confident recommendations from noise.
4. A preview of the report's intended sections, rendered as an outline with each section
   greyed and labelled with what it will need. This is not a fake report with placeholder
   numbers. No lorem, no sample charts. Section list:
   - What the account has published (format mix, posting cadence, caption length)
   - Which formats reached most, with n per format
   - Which topics or angles recurred, from captions and transcripts
   - Where the account sits against the tracked competitor set structurally, not by size
   - What has never been tried, derived from competitor format tags absent from own posts
   - Named hypotheses, each with the evidence and its sample size attached
5. A "Run anyway" affordance. It exists because Kai will want to see the machinery, and
   hiding it entirely invites a workaround. Behind a confirm dialog that states the output
   is a prototype on an insufficient sample and must not be treated as strategy. Output is
   watermarked accordingly in the UI and in any exported markdown.

**Screen, after the gate (the prototype design).** A generated markdown document rendered
in the app, with each section carrying its own sample size and every claim traceable to a
row. Sections as listed above. Every recommendation is phrased as a hypothesis with the
evidence inline, following the same rule `/ksa:measure` step 5 already imposes: do not
build a strategy on n=1 without labelling it a hypothesis.

**Actions.**
- **Run anyway** (gated, confirm dialog).
- **Run report** (after the gate).
- **Export markdown.**
- **Save as report N.** Persisting a run is what makes G4 possible, so this is not
  optional decoration.
- **View past reports.** List of saved runs by date.

**System.**
- New table `strategist_reports` (new): id, createdAt, postCountAtRun, model, markdown
  body, and a JSON blob of the structured inputs the run saw. Storing the inputs matters:
  G4 diffs two reports, and diffing generated prose alone produces noise from rewording.
- New service `src/server/services/strategist.ts` (new). Reads `own_posts`,
  `own_post_insights`, `own_comments`, plus the competitor side through existing queries,
  builds a structured input object, then calls `LlmClient.generateParsed` with a schema so
  the sections come back typed rather than as free prose. Prompt files live beside the
  existing ones in `src/server/services/prompts/`.
- Text task, so the local proxy per the settled decision. If the input grows past what the
  routed free model handles, this is the first candidate to move to the Claude Code
  headless subprocess.

**Failure.**
- **Model returns something that fails the schema.** `LlmParseError` already exists in
  `src/server/llm/client.ts` and fires after one retry. The screen shows it and offers a
  retry; no partial report is saved.
- **Proxy unreachable.** Same handling as G2's summary.
- **Input too large.** Caption and transcript text across 30 posts plus competitor context
  may exceed the routed model's window. Surface a clear "input too large for the local
  model" error with a suggestion to run through Claude Code instead, rather than silently
  truncating. Silent truncation would produce a report about a subset while claiming to
  cover everything.
- **A report is saved but the underlying post is later deleted.** Reports are immutable
  snapshots. They keep the numbers they were built from and show the run date.

**Empty.** The gated state described above is the empty state, and it is the normal case
today. With zero posts, the progress line reads "0 of 30" and the "Run anyway" affordance
is hidden entirely, since there is nothing to run on.

**Open question.**
- Is 30 the right gate, and is it 30 posts or 30 posts with insights available? Old posts
  may not return insights.
- Should the report cover only the own account, or is the competitor comparison part of it
  (which would make it partly a G2 aggregate)?
- Does a saved report get written to the Kai-Official-OS vault, or stay in Crowsnest?

---

### G4. Diff analysis between two strategist reports

**Status.** Not built, deferred harder than G3. It cannot exist until two saved reports
exist, which cannot happen until G3 runs twice, which needs 30 posts and then a second run
some time later. This block is a paper design of the prototype plus the gated state.

**Entry.**
- From G3's past reports list, selecting two runs and pressing Compare.
- Route, proposed `/me/reports/diff?a=<id>&b=<id>`.

**Screen, before the gate.** The past reports list with a line stating that a diff needs
two saved reports and currently there are N. No mock diff.

**Screen, after the gate.**
1. Header naming both runs by date, with the post count at each run and the number of days
   between them. The elapsed time is part of reading the diff.
2. **What changed in the inputs**, before what changed in the prose. Posts added between
   runs, reach on each, follower delta, new organic comments, new competitor channels
   tracked. This section is computed from stored data, not generated, and it is the
   trustworthy half of the screen.
3. **What changed in the conclusions.** Section by section, the earlier claim and the later
   claim next to each other, with an added, removed or changed marker. Generated from the
   two stored structured inputs plus the two bodies.
4. **Hypotheses status.** Every hypothesis named in report A, with what report B says about
   it: supported by new data, contradicted, or still untested. This is the section that
   would actually change behaviour, and it is the reason to store structured inputs rather
   than prose.
5. **Reworded but unchanged.** An explicit bucket for claims that differ only in wording.
   Without it, every diff looks busy and the real changes hide.

**Actions.**
- Pick report A and report B.
- Export the diff as markdown.
- Jump to either full report.
- Mark a hypothesis as resolved, which writes back to the later report's stored record.

**System.**
- New query over `strategist_reports` (new).
- Input diff computed in TypeScript from the two stored JSON input blobs. Deterministic, no
  model involved.
- Conclusion diff through the LLM with both structured inputs supplied, so it can
  distinguish rewording from a changed claim.

**Failure.**
- **Reports built from different schema versions.** Store a schema version on each report.
  Diffing across versions shows a warning and falls back to input diff only.
- **The two reports are the same run.** Guard in the picker.
- **Model fails on the conclusion diff.** The input diff section still renders, and it is
  the section with the facts in it. This split is deliberate: the deterministic half must
  never depend on the generated half.

**Empty.** Zero or one saved report: the gated message. Two reports with identical inputs
(a re-run with nothing published in between): the diff renders and says so plainly, which
is a useful result rather than an error.

**Open question.**
- Should a diff be run automatically after each new report, or always on demand?
- Does Kai want the diff to consider a claim "contradicted" on any new evidence, or only
  when the new sample is above some size? At this account size the first is going to fire
  constantly.

---

### G5. Content success formula

**Status.** Not built, deferred, and gated on an event that has not happened. The gate is
one post clearing 10x the account median reach. At an approximate median of 9, that is a
post reaching roughly 90 accounts. This block designs the gated state and the prototype.

**Entry.**
- Section on `/me`.
- A notification or highlight on the G1 dashboard when a measured post crosses the
  threshold, since the crossing is the interesting event.

**Screen, before the gate (the state that ships).**
1. Heading, "Content success formula".
2. The gate stated as a live number: "No post has cleared 10x your median reach yet. Your
   median is N across 8 posts. Best post so far: Mx." That is a genuinely useful line on
   its own, because it names the current best and the distance to the bar.
3. An explanation of why the gate exists: a formula derived from posts that all performed
   about the same is a description of the average, not of success. There has to be an
   outlier before there is anything to explain.
4. No preview outline here, unlike G3. There is nothing to outline until there is a post to
   explain.

**Screen, after the gate (the prototype design).**
1. The qualifying post, large: thumbnail, caption, format, reach, index versus median.
2. **The sample size warning, stated harder than anywhere else in the app.** One post above
   the bar is n=1. The formula derived from it is a hypothesis about one post. The screen
   says this in a banner that stays until at least 3 posts have cleared the bar.
3. **What this post did that the others did not.** A structured comparison of the winner
   against the account's other posts, on the fields Crowsnest actually holds: format, hook
   type, structure segment count, caption length, posting time, topic tags, whether it was
   a remix of a tracked competitor outlier.
4. **Which of those factors also appear in tracked competitor outliers.** This is the part
   that raises the evidence above n=1: a factor present in the one own winner and in a
   number of competitor outliers is a stronger candidate than a factor unique to the one
   post. Each factor shows the competitor count that supports it.
5. **The formula**, written as an ordered checklist for the next post, each item carrying
   its evidence and its sample size. Items with support only from the single own post are
   marked as such and sorted below items with competitor support.
6. **Apply this formula.** Opens a Remix session pre-seeded with the checklist.

**Actions.**
- Run the analysis (after the gate).
- Edit the formula by hand. Kai's judgement should be able to override a generated item,
  and an edited formula is stored as edited.
- Apply to a remix session.
- Export as markdown.
- Adjust the threshold. See the open question.

**System.**
- New service `src/server/services/success-formula.ts` (new).
- Own side from `own_posts`, `own_post_insights` and own analyses. Competitor factor
  support counted over `video_analyses` rows joined to `videos` with `outlierScore` above
  the threshold, which is data Crowsnest already has.
- Text task, local proxy.
- The formula is stored (new table `success_formulas`, or a row in `app_settings`) so that
  a later run can be compared against it. `app_settings` is already used this way for
  `recently_viewed` and `niche_profile`.

**Failure.**
- **The median is null.** `computeOwnMedianReach` returns null below 5 usable posts or on a
  zero median, and then there is no threshold to clear. The screen says so rather than
  computing a ratio against nothing.
- **The winner is an artifact.** A post can clear 10x because a competitor or a friend
  shared it, or because the median is tiny. The screen must offer a "this was not organic,
  exclude it" control, and an excluded post stays excluded with a stored reason.
- **No competitor support for any factor.** The formula renders with every item marked as
  single-post evidence and a stronger warning at the top.

**Empty.** The gated state, which is the normal case and will be for a while.

**Open question.**
- Is 10x the right bar, or should it be an absolute reach number? At a median of about 9,
  10x is about 90 accounts, which a single share could produce. An absolute bar (some
  number of accounts reached) may be the more meaningful gate at this size. Kai's call, and
  it is the most consequential open question in group G because it decides when this
  feature turns on at all.
- Should the bar move as the account grows, or should crossing it once be permanent?
- Does an excluded post still count toward the median?

---

## Group H: system

### H1. Settings

**Status.** Partly built. `src/app/(shell)/settings/page.tsx` exists and renders five
sections: niche profile, Instagram connection (the instagrapi sidecar), API keys, local
binaries, and sync. Everything below that is marked new is a design.

**Entry.**
- Sidebar nav item "Settings", already in `NAV_ITEMS`.
- Command palette, already wired.
- Deep links from error states elsewhere in the app (the keyless-mode alerts point here).

**Screen.** Top to bottom. Existing sections first, in their current order, then the
proposed additions.

1. **Niche profile** (built). Description textarea plus comma separated keywords, saved to
   `app_settings.niche_profile` and read by `getNicheProfile` in
   `src/server/services/remix.ts`, so it grounds every generation stage.
2. **Instagram connection** (built). The instagrapi sidecar panel. Eight distinct view
   states (service down, no credentials, logged out, connecting, two factor, challenge,
   connected, error), each with its own copy and its own next action. Includes the standing
   warning that this drives Instagram's private API against Meta's terms and the account
   can be banned, so it must be a burner. This section must gain a line naming which
   identity it is, now that a second one exists: "this is the burner account used to read
   competitors. Your own account is configured below."
3. **Own channel, Instagram Graph API** (new). The counterpart section. Contents:
   - Which account the token belongs to, resolved by calling the account fields endpoint,
     so the screen shows `@kaiships.ai` rather than trusting a label.
   - Token presence badge, following the `ApiKeyStatusCard` pattern (present or not set,
     read from `process.env` server side).
   - Token expiry state: healthy, expiring in fewer than 14 days, or dead, with the days
     remaining where computable.
   - A "Test token" button that makes the cheapest authenticated call and reports the real
     result, in the spirit of the existing Anthropic key test.
   - The instruction path for refreshing: the token is a copy that lives only in
     Crowsnest's `.env.local` and goes stale independently of the copy in Kai-Official-OS.
     The copy has to say this out loud, because the whole point of the copied-token
     decision is that refreshing one does not refresh the other.
   - Metric coverage list: which metrics the client requests today and which are not wired.
   - An explicit separation note: this token never touches the sidecar, and the sidecar
     credentials never touch the Graph API client.
4. **API keys** (built). Anthropic (with a real test through `LlmClient.ping`) and Groq
   (presence only, verified on first transcribe). Proposed addition: a row for the local
   model proxy showing `ANTHROPIC_BASE_URL`, whether compat mode is active
   (`isCompatMode()` in `src/server/llm/client.ts` already answers this), the model id in
   use, and a test button. Right now a reader of this page cannot tell whether text
   generation is going to the real API or to the local router, and that is the single most
   important fact about cost.
5. **Local binaries** (built). yt-dlp and whisper-cli with model, each present or with a
   reason. Proposed addition: the `claude` CLI, needed by H3 and by the vision and heavy
   task path. Same row shape, same detection helper (`detectBinary` in
   `src/server/lib/exec.ts`).
6. **Sync** (built). Shows the sync parameters in effect plus the last run, and goes live
   while a run is in flight. Two settings are shown with an explicit warning that nothing
   reads them: `MEDIA_RETENTION_DAYS` (no retention reaper exists) and
   `SYNC_INTERVAL_MINUTES` (no scheduler exists; every run starts from a click). That
   honesty is the house style and should be copied by every new section.
7. **MCP server** (new, ships with H4). Whether the server is enabled, the transport and
   address, the list of exposed tools with a per-tool enable toggle, and the copy-paste
   config block for registering it with Claude Code. Detailed in H4.
8. **Claude Code pane** (new, ships with H3). Enable or disable the pane, the resolved
   `claude` binary path, the permission mode, and the working directory the subprocess
   runs in. Detailed in H3.

**Actions.**
- Save niche profile (existing server action, toasts on success or failure).
- Connect, disconnect, submit two factor code, submit challenge code, choose challenge
  channel, re-check status (all existing).
- Test Anthropic key (existing).
- Test Graph token (new).
- Test local proxy (new).
- Re-check binaries (new: currently binary detection runs only on page load).
- Start or cancel a sync from the sync panel (existing).
- Enable or disable individual MCP tools (new).
- Enable or disable the Claude Code pane (new).

**System.**
- `src/app/(shell)/settings/page.tsx` is `dynamic = "force-dynamic"` and reads live env,
  filesystem and database state on every load. It gathers everything in one `Promise.all`
  and passes results down, so no section needs a mount effect and no section renders a
  wrong state on first paint. New sections follow the same pattern.
- Statuses that can fail are passed down as results, not flattened to null. The sync
  section takes a `LastSyncJobResult` precisely so a failed read of `sync_jobs` renders as
  a read failure rather than as "no sync has run yet". Every new section owes the same
  distinction.
- Settings that live in `.env.local` are read only in the UI and require a dev server
  restart. Settings that live in `app_settings` are editable in place. New toggles (MCP
  tool enablement, Claude Code pane) belong in `app_settings` so they can be changed
  without a restart.

**Failure.**
- **Config invalid at boot.** `src/server/config.ts` throws on a missing or malformed
  required variable, so the process refuses to start rather than failing later on a click.
  The user sees a startup error naming the variable, not a broken page.
- **Sidecar unreachable.** Rendered as its own state with the start command, never folded
  into "not connected".
- **A status read throws.** The page must not go down with it. Today `getIgStatusAction`
  never throws and returns a failure result instead. New status reads must do the same,
  because they all share one `Promise.all`.
- **Env edited without restart.** The page shows stale values with no indication. Proposed
  fix: a line stating when the process started, so a reader can tell whether their edit is
  reflected.

**Empty.** A first run with nothing configured: every section renders its own not
configured state with the exact variable name and the exact next step. No section is hidden
for being unconfigured, because a hidden section is a feature the user never learns exists.

**Open question.**
- Should the two Instagram sections be visually separated more strongly than by heading,
  given that mixing them is the failure this design is guarding against? A colour coded
  border or an explicit "competitor" and "own" label on each.
- Should Settings gain a per-section "what reads this" line, extending the honesty already
  applied to the two inert sync settings? It would prevent a repeat of the same class of
  bug.

---

### H2. Command palette

**Status.** Partly built. `src/components/layout/command-menu.tsx` exists, is mounted once
in the shell layout, opens on Cmd+K or Ctrl+K, and offers exactly one group: Navigate,
built from `NAV_ITEMS`. That is five items. Everything beyond navigation is a design.

**Entry.**
- Cmd+K or Ctrl+K anywhere in the app. The listener is global and toggles.
- The topbar search trigger button, through the `useCommandMenu` context.

**Screen.** A dialog with a single input at the top and a scrolling result list beneath.
Today: one "Navigate" group with Dashboard, Feed, Channels, Vault, Settings, each with its
icon, and a "No results found" empty. Proposed groups, in this order:

1. **Actions.** Verbs, not places. Sync now, cancel sync, add a channel, import a reel by
   URL, measure my channel, run analysis on the current video, new remix session, new
   script. Actions that apply to a currently open entity appear only when that entity is
   open, and their labels name it ("Analyze this post").
2. **Navigate.** The existing group, unchanged.
3. **Go to channel.** Live search over `channels.handle` and `displayName`. This is the
   group that makes the palette worth opening once there are more than a handful of tracked
   channels.
4. **Go to post.** Search over `videos.caption` and shortcode.
5. **Vault.** Search over `vault_items.title`.
6. **Ask Claude.** A single item that takes whatever is in the input and opens the H3 pane
   with it as the first message. This is the natural bridge between the palette and the
   pane, and it means the palette never has to answer a question it cannot answer.

**Actions.**
- Type to filter. Arrow keys and Enter to select, Escape to close (all handled by the
  existing command dialog).
- Selecting a Navigate item routes and closes (`runCommand` today).
- Selecting an Action runs a server action and closes, with the result reported by a toast,
  matching how sync and vault actions already report.
- Selecting an entity routes to its detail page.
- Selecting Ask Claude opens the pane.

**System.**
- Navigate items come from `NAV_ITEMS`, shared with the sidebar so the two cannot drift.
  Adding "My channel" for G1 to that array puts it in both surfaces at once.
- Entity search needs a new server action returning a small ranked result set, debounced.
  It must be a separate action per group so a slow group cannot block the fast ones.
- Actions need a registry (new) mapping id, label, icon, an availability predicate against
  the current route, and a handler. Defining actions in one array rather than inline in the
  component is what lets the same registry drive the pane in H3 and, later, the MCP surface
  in H4.

**Failure.**
- **A search query fails.** That group renders an inline error row and the other groups
  still work. The palette must never be blocked by one failed query.
- **An action fails.** Error toast with the mapped message. The palette closes anyway; the
  toast is the report surface.
- **An action is unavailable.** It does not appear, rather than appearing disabled. A
  disabled row in a filtered list is noise.
- **Keyboard shortcut conflict.** Cmd+K is taken by the browser's address bar focus in some
  configurations. The listener calls preventDefault, which handles it in the app, but there
  is no fallback if the browser wins. Low priority.

**Empty.** Today the palette shows "No results found" for an unmatched query. With entity
groups added, an empty database means the entity groups do not render at all, leaving
Navigate and Actions. That is correct: an empty "Go to channel" heading with nothing under
it is worse than no heading.

**Open question.**
- Should the palette run destructive or expensive actions directly (a full sync, an LLM
  call that costs money) or only navigate to the screen where that action lives with the
  form primed? Running directly is faster and gives no chance to reconsider.
- Should recent commands be tracked and floated to the top? `app_settings.recently_viewed`
  already establishes the pattern for storing this kind of list.

---

### H3. Claude Code pane docked in the app sidebar

**Status.** Not built. Nothing exists. There is no `claude` subprocess anywhere in the
codebase, no terminal component, no streaming transport beyond the sync progress poll. This
is Kai's idea and this block is a design from scratch. It is also the highest risk item in
this document, for reasons in the open questions.

**Why it exists.** Crowsnest is a local-first research tool and Kai's niche is Claude Code
power user systems. The tool that researches content should be drivable by the same agent
Kai builds systems around, without alt-tabbing to a terminal and re-explaining which post
is on screen. The pane's real advantage over a terminal is context: it already knows what
the user is looking at.

**Entry.**
- A toggle in the left sidebar footer, near the existing sync rail.
- Keyboard shortcut, proposed Cmd+J, symmetric with the palette's Cmd+K.
- The "Ask Claude" item in the command palette, which opens the pane with the typed text as
  the first message.
- Contextual buttons on entity pages ("Ask about this post"), which open the pane with that
  entity attached.

**Screen.** The brief says docked in the sidebar. The left sidebar is a fixed 240px track
in the shell's grid and is far too narrow for a conversation. The recommendation is a
right-hand dock: a resizable column on the right of the shell, collapsed by default, with
the left sidebar keeping the toggle. If Kai wants it literally in the left rail, the rail
has to widen when the pane opens, and the grid template becomes dynamic. Flagged as an open
question.

Top to bottom inside the pane:

1. **Header.** "Claude Code", a session picker (current session, plus past sessions by
   date), a new session button, and a close button.
2. **Context chips.** What the pane is currently attached to, as removable chips: the
   current route, the open post or channel, a selected vault item. Each chip is a real
   entity id that gets passed to the subprocess as context, not a free text hint. The user
   can remove a chip to narrow what the agent sees.
3. **Transcript.** The conversation. Assistant text, user text, and tool calls. Tool calls
   render collapsed as a single line naming the tool and its main argument, expandable to
   the full input and output. This matters: most of what the agent does in this app will be
   tool calls against Crowsnest's own MCP surface, and a wall of raw JSON would make the
   pane useless.
4. **Permission prompts.** When the agent wants to run something that needs approval, the
   request renders inline as a card with allow once, allow for this session, and deny. The
   pane must never silently auto-approve, and the default permission mode is the strictest
   one that still lets read-only tools run.
5. **Status line.** Whether the subprocess is idle, thinking, or running a tool, plus the
   elapsed time of the current turn and a stop button.
6. **Composer.** Multiline input, Enter to send, Shift+Enter for a newline, plus an attach
   button that adds the current page as a context chip.

**Actions.**
- Open and close the pane, resize it, and have that persist across reloads.
- Send a message.
- Stop the current turn. This has to kill or signal the subprocess, and the transcript
  keeps whatever arrived before the stop.
- Start a new session.
- Resume a past session.
- Add or remove context chips.
- Allow or deny a permission request.
- Copy a message, or copy the whole transcript.
- Insert a result into the app: a generated hook goes to the vault, a generated script goes
  to `scripts`. Without this the pane is a chat window that happens to be inside the app;
  with it, the pane is part of the tool.

**System.** All new.
- A server side session manager (new) that spawns `claude` as a headless subprocess with
  streaming JSON output, one process per session, and keeps a registry keyed by session id.
  The binary is detected the same way yt-dlp and whisper are, through `detectBinary`.
- A streaming transport from the server to the pane. The app currently has no streaming
  primitive; the sync rail polls once a second. A poll is wrong for token streaming, so
  this needs server sent events or a websocket, which is a genuinely new capability in this
  codebase and the main reason this flow is expensive.
- Session persistence in a new `agent_sessions` table (new): id, createdAt, title, the
  context chips at creation, and the transcript. Persisting means a reload does not lose the
  conversation, which is the difference between a toy and a tool.
- The subprocess is launched with Crowsnest's MCP server (H4) registered, so the agent's
  tools are Crowsnest's own tools. Without H4 the pane can read the filesystem and little
  else, so H4 is a hard dependency, not a nice-to-have.
- The working directory the subprocess runs in decides what it can touch. Proposed: the
  Crowsnest project root, so it can read the code and the docs. This is also the largest
  security surface in the design.

**Failure.**
- **`claude` not on PATH.** The pane renders a not-installed state naming the binary and
  pointing at the local binaries section in Settings. Same treatment as a missing yt-dlp.
- **Not authenticated.** The subprocess exits with an auth error. The pane surfaces it and
  says where to authenticate. It must not retry in a loop.
- **Subprocess crashes mid-turn.** The transcript keeps everything received, appends a
  clear "the agent process exited" marker with the exit code, and offers to restart the
  session. Partial output stays visible.
- **Stream disconnects but the process lives.** On reconnect the pane resubscribes to the
  same session and backfills. Without this, a hot reload during development orphans a
  running process. Given how much dev reloading happens, this is not an edge case.
- **The agent asks to do something destructive.** The permission card is the guard. Deny is
  the default focus.
- **Two panes in two browser tabs on the same session.** Both attach to the same process
  and both see the same stream. Input from either goes to the same session. This should be
  allowed and made visible ("also open in another tab") rather than blocked.
- **Cost.** Every turn costs real money, unlike the local proxy path used for text work.
  The pane should show a per-session turn count, and there should be no path by which the
  pane starts a turn without the user pressing send.

**Empty.** No session yet: a short explanation of what the pane can do, the list of MCP
tools it has access to (read live from the server, not hardcoded), and two or three
suggested opening prompts drawn from the real tool surface, for example asking it to sync a
channel or summarize the week's outliers.

**Open question.**
- Left rail or right dock? The left sidebar is a fixed 240px grid track and cannot hold a
  conversation without the grid becoming dynamic. Kai asked for the sidebar; the
  recommendation is a right dock. This needs a decision before any layout work.
- What permission mode? Fully interactive prompts are safest and slowest. Auto-approving
  read-only Crowsnest tools while prompting for everything else is the likely sweet spot,
  but it depends on how the tools in H4 are split into read and write.
- Does the pane run headless with streamed JSON, or is a real terminal emulator embedded?
  The first is far less work and gives a controllable UI. The second gives the exact Claude
  Code experience Kai already knows, including slash commands. This is a large fork in the
  road.
- Should the pane share sessions with the terminal, so a conversation started in the app
  can be resumed on the command line?
- Does this belong in Crowsnest at all, given that Kai already has Claude Code in a
  terminal? The honest case for it is the context chips. If those turn out not to matter,
  this feature is a worse terminal.

---

### H4. The MCP tool surface

**Status.** Not built. Grepping the tree, MCP appears only in `docs/research/FEATURES.md`,
which parks it as "later", and in the v1 design spec's non-goals. There is no server, no
tool definitions, no transport. This block is a design.

**Principles this surface follows**, from the settled decisions:

- The UI is primary. MCP is second and built after. Nothing here justifies a UI compromise.
- MCP is for text work: sync a channel, list outliers, read a transcript, run an analysis,
  generate hooks, write a script. Vision and heavy work stay on the Claude Code path.
- Tools wrap functions that already exist. A tool that needs new business logic is a sign
  the logic belongs in a service first.
- Read tools and write tools are separated explicitly, so the H3 pane can auto-approve one
  group and prompt on the other.
- No tool crosses the identity boundary. Own-channel tools and competitor tools are
  separate, named differently, and no tool takes both in one call.
- Every tool returns data the model can reason about as text. Media is referenced by id and
  never inlined.

**Transport and registration.** A local stdio MCP server (new), started as a separate
process from the Next app and sharing the same SQLite database at `CROWSNEST_DB_PATH` and
the same service modules. Settings shows the copy-paste registration block. Whether it
should instead be an HTTP server sharing the running Next process is an open question
below.

**Proposed tools.**

Tier 1 is the six the brief names, plus the two status tools without which the others are
unusable.

| Tool name | Arguments | Returns | Why it earns its place |
|---|---|---|---|
| `crowsnest_sync_channel` | `handle` or `channelId`, optional `lookbackDays` | `{ jobId, status, itemsSeen, itemsCreated, itemsUpdated, itemsFailed, stopReason }` | Wraps `runSync` in `src/server/services/sync-engine.ts`. Syncing is the one long action an agent will want to start before doing anything else, and the alternative is telling the user to go click a button. Write tool. |
| `crowsnest_sync_status` | optional `jobId` | The `sync_jobs` progress row: `{ jobId, status, phase, channelsDone, channelsTotal, currentChannelHandle, retries, cancelRequested, gaps }` | `runSync` can take minutes. Without a status tool the agent either blocks or guesses. The row already carries live progress written at every page and channel boundary, so this is a read of existing state. Read tool. |
| `crowsnest_list_outliers` | `minScore`, `sinceDays`, `channelId`, `fleetId`, `sort` (score, recent, views), `limit`, `offset` | `{ total, items: [{ videoId, channelHandle, caption, postedAt, viewCount, outlierScore, mediaType, url, hasTranscript, hasAnalysis }] }` | Wraps `getOutlierFeed` in `src/server/queries/feed.ts`, which already implements exactly these filters. This is the single most valuable tool on the list: it is the question the product exists to answer. Read tool. |
| `crowsnest_get_transcript` | `videoId`, optional `createIfMissing` (default false) | `{ videoId, text, language, durationSec, source, createdAt }` or `{ videoId, transcript: null, reason }` | Reads the `transcripts` table. The agent's text work needs the words, and without this tool it can only see captions. `createIfMissing` is off by default because transcription is the heavy path and should be an explicit choice. Read tool when false, write tool when true. |
| `crowsnest_analyze_post` | `videoId`, optional `force` | `{ videoId, hookType, structureSegments, formatTags, styleTags, whyItWorked, model, createdAt }` | Wraps `getOrCreateAnalysis` in `src/server/services/analyze.ts`, which caches into `video_analyses` and returns the cached row when one exists. The get-or-create shape means a repeated call is cheap, which is the right shape for an agent. Write tool (it can spend a model call). |
| `crowsnest_generate_hooks` | `videoId` or `sessionId`, optional `count`, optional `vaultItemId` | `{ sessionId, hooks: string[] }` | Wraps `generateHooks` in `src/server/services/remix.ts`, which is already grounded by the saved niche profile. Named in the brief. Write tool. |
| `crowsnest_write_script` | `sessionId`, optional `chosenHook`, optional `styleVaultItemId`, optional `targetLengthSec` | `{ sessionId, outline, variants: string[], scriptId }` | Wraps the outline, variant and save path in `remix.ts` so a script produced in chat lands in the `scripts` table rather than in the conversation only. Named in the brief. Write tool. |
| `crowsnest_get_post` | `videoId` | `{ videoId, channel, caption, postedAt, mediaType, metrics, outlierScore, children, transcript, analysis }` | Wraps `getVideoDetail` in `src/server/queries/video.ts`. The other tools return ids; something has to turn an id into the full picture, or every follow-up question needs three calls. Read tool. |

Tier 2 earns a place only after tier 1 is in use.

| Tool name | Arguments | Returns | Why it earns its place |
|---|---|---|---|
| `crowsnest_list_channels` | optional `fleetId` | `[{ channelId, handle, displayName, followerCount, mediaCount, lastSyncedAt, syncError }]` | Wraps `getChannelsList`. The agent needs handles to pass to the sync and filter tools, and guessing them fails. Read tool. |
| `crowsnest_add_channel` | `handle`, optional `fleetId` | `{ channelId, handle, created }` | Wraps `addChannel` in the sync engine. Turns "track this creator" in chat into a real row. Write tool. |
| `crowsnest_import_reel` | `url` | `{ videoId, channelId, created }` | Wraps `importReelByUrl`. A single URL pasted into chat is the most common way a piece of research arrives. Write tool. |
| `crowsnest_search_vault` | optional `type` (hook or style), optional `query` | `[{ id, type, title, templateText, tags, sourceVideoId }]` | Wraps `getVaultItems`. Without it the agent regenerates hooks that already exist in the vault. Read tool. |
| `crowsnest_own_channel_stats` | optional `sinceDays` | `{ measuredAt, account, posts: [{ postId, format, postedAt, reach, saves, shares, likes, comments, views, reachIndex }], medianReach, sampleSize }` | The own-channel counterpart, gated on G1 existing. Every field carries its sample size, because an agent summarizing this data will otherwise report an 8 post average as a fact. Read tool, own identity only. |
| `crowsnest_compare_post` | `ownPostId`, `videoIds: string[]` | The G2 payload: two explicitly separate halves, each with its own units and its own median denominator | The comparison is the differentiator, and it is the one analysis an agent cannot assemble from the other tools without re-deriving both medians and probably mixing the units. Read tool, spans both identities in read-only form and must never write to either. |

**Deliberately not exposed.**
- Anything that deletes. There is no delete tool. Soft deletes happen through sync, and a
  hard delete from a chat turn is not a risk worth taking.
- Anything that touches Instagram credentials, sessions, or login state. The sidecar's login
  flow stays in the UI, where the two factor and challenge steps have a human in front of
  them.
- Anything that renders or publishes content. That is a different tool's job.
- Media bytes. Assets are referenced by id and served over `/api/media/[assetId]`.
- Settings writes. An agent that can change the niche profile can silently change every
  future generation.

**Entry.** Not a screen. The surface is reached by Claude Code in a terminal with the server
registered, or by the H3 pane, which registers it automatically.

**Screen.** The Settings section in H1 item 7: server enabled or not, transport and address,
a table of tools with name, read or write, and an enable toggle each, plus the last call
made per tool with its timestamp and outcome. That last column is the debugging surface;
without it an agent silently failing against a tool is invisible.

**Actions.**
- Enable or disable the server.
- Enable or disable a single tool.
- Copy the registration block.
- View the recent call log.

**System.**
- New process, new entry point, sharing `src/server/` service modules and the same database
  file. It must reuse the services rather than reimplementing queries, or the two surfaces
  will drift and the MCP answers will quietly differ from the UI answers.
- The single-flight sync lock is a partial unique index in the database
  (`sync_jobs_lock_running`), not an in-process mutex, precisely so a second process cannot
  start a duplicate sync. That design decision is what makes a separate MCP process safe,
  and it was made for exactly this reason.
- Tool enablement stored in `app_settings` so toggling needs no restart.
- Every tool result is capped in size, with pagination on the list tools, so one call
  cannot fill a context window.

**Failure.**
- **Database locked.** SQLite write contention between the Next app and the MCP process. The
  tool returns a retryable error naming the condition rather than hanging.
- **Sync already running.** `crowsnest_sync_channel` returns a clear "a sync is already
  running, job id X" and points at `crowsnest_sync_status`, instead of failing on a unique
  index violation the model cannot interpret.
- **The sidecar is down.** Sync tools fail with the same service-down code the UI already
  distinguishes, and the message says the fix is to start the sidecar, which the agent
  cannot do for the user.
- **No API key for a generation tool.** `NoApiKeyError` already exists and maps to a
  friendly message. The tool returns that message rather than a stack trace.
- **A tool is disabled.** It is not advertised in the tool list at all, rather than
  advertised and erroring on call.
- **Argument that does not resolve.** An unknown `videoId` returns a not-found result, not
  an exception. Models handle a typed empty far better than a thrown error.

**Empty.** A fresh database: `crowsnest_list_outliers` returns zero items with a `total` of
zero and a hint that no channels are tracked yet. Every list tool returns an explicit empty
with a reason rather than a bare empty array, because the difference between "nothing
matched" and "nothing exists" changes what the agent should do next.

**Open question.**
- Separate stdio process or HTTP inside the running Next app? Separate is simpler to
  register and safe because of the database-level lock, but it means starting a third
  process alongside the dev server and the sidecar. In-process avoids that and reuses the
  loaded config, but ties tool availability to the dev server being up.
- Does `crowsnest_analyze_post` route to the local proxy or to the real API? It is a text
  task by the stated rule, but analysis quality is the thing the whole product's value rests
  on. This may be the exception where the cost is worth it.
- Should write tools require an explicit confirmation argument, or is the H3 permission
  prompt sufficient? The prompt only exists inside the pane; a terminal Claude Code session
  has its own permission model.
- Tool naming: `crowsnest_` prefix on every tool is verbose but unambiguous when several MCP
  servers are registered at once. Keep or drop.
