# Prototype features with no data layer behind them

Collected from workers during the UI port. Each one is a prototype element
that was dropped rather than faked. Fixing any of them means schema plus
query work, which was out of scope for a rendering-layer pass.

## Video detail

- Own-channel Insights: reach, saves, shares, profile visits, follows from
  post, watch time, each with sample size. Nothing in `schema.ts` holds these.
  Comes from the Instagram Graph API Insights endpoint on the owned channel.
- Median bar plus spark histogram under the score. Needs the channel's median
  view history bucketed over time. The detail query returns a single
  `outlierScore`, no history.
- Layout section in Hook and Structure: on screen text and its position, cut
  rhythm, framing. Plus the "Run frame pass" action. The `video_analyses`
  table has no columns for it and no such server action exists.

## Shell

- Sidebar count badges (feed count, vault count) from the prototype. No prop
  or query supplies them, and faking a number is banned, so the badges are
  absent. Needs a count query wired into the shell layout.
- Prototype nav lists Post under Research and My channel under Sources. Neither
  is a top level route here, both are nested detail pages, so no nav entry was
  invented for them.
- Prototype paints the logo dot amber. The amber budget rule bans amber on the
  logo, so it renders in foreground instead. Deliberate override, prototype
  loses this one.

## Vault and settings

- Prototype's vault is a flat sorted list of saved outlier posts, with a score,
  a reason it was kept, and remix or remove per row. The real vault is a tabbed
  library of hooks, styles and scripts. Different data shape, so the app's
  structure stayed and only the typography came across.
- Prototype settings has a sticky left sub nav switching views. The real route
  stacks all five sections. Hairline dividers stand in for the rhythm rather
  than a faked nav.

## Dashboard

- The prototype's dashboard is a denser, different page: a NEXT prompt bar, a
  single top post hero, a producer donut, a reach against score scatter, a 28
  day timeline, a score ranking list and a coverage list. None of it has a
  query behind it. The route kept its existing structure (KPI row, top outliers,
  fleet spikes, recently viewed) and took only spacing and type from the
  prototype.
- Sparkline stayed single hue rather than using the score-1 to score-5 ramp.
  The series is raw view count buckets with no score per bucket, so a tier
  color would assert a reading the data does not contain.

## Remix studio

- No run log section. Nothing in `RemixSessionRow` records per run history, so
  the prototype's log was dropped rather than invented.
- Radix primitive internals (Select, Dialog, Input) keep their own rounded
  corners. Only components the stages render directly were forced to radius 0.
  Small visible inconsistency, left deliberately.

## Feed

- Comfortable and compact density toggle, and the header sync button and search
  from the prototype's feed header. Each needs new state or a new server action.
- Per filter empty-state hint copy. One static line stands in for it.
- Engagement rate on the card. Not in `FeedItem`, only in the quick preview's
  on demand fetch.
- The "not for me" dismiss control. No server action behind it.

## Channels and my channel

- Per channel "last 8 runs" sparkline. No query returns per channel job history.
- Planned and scheduled cells in the month calendar, and the pipeline funnel.
  Nothing in the app schedules a post, so every one of those cells would have
  been invented.
- Length against reach scatter. `durationSec` exists, so this one is only a
  matter of scope, not missing data.
- The prototype labels view counts as reach throughout. Reach is an Insight,
  owned channel only, through the Graph API, and that work is not built (see
  `docs/design/ux-flows/04-ownchannel-system.md`). The screens say views.
