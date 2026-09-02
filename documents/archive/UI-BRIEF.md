# UI design brief for Crowsnest

Written 2026-07-28 for a Claude Design session. Attach `docs/design/prototype/prototype.html` alongside this file. That prototype is the approved UX: 36 flows, what happens and in what order. It is deliberately ugly. Your job is the visual layer, not the flows.

## What this is

A desktop research tool for one person. It watches Instagram creators, finds posts that beat their own channel baseline, explains why they worked, and turns the pattern into a new script.

One user, running it locally on a Mac. No signup, no onboarding, no marketing surface, no mobile, no light mode. Nobody else will ever see this screen, so it can be dense.

## The one job

Find a viral video. Take its hook, its script and its layout. Rebuild it in my own style.

Every screen either serves that or gets out of the way. The number that matters most in the whole product is the outlier multiplier, how many times a post beat its own channel's normal.

## What you are designing into

- Next.js 16 App Router, React 19, Tailwind CSS v4, shadcn/ui on Radix and Base UI.
- 26 shadcn components already wrapped in `src/components/ui`. Button, card, dialog, table, tabs, select, sheet, popover, command, progress, skeleton, tooltip and the rest. Reuse them. Design a new component only when none of those can carry the idea.
- Tokens live in one place, `src/app/globals.css`, as CSS custom properties. Changing the look means changing that block, so give exact values.

Current tokens, for reference and for arguing with:

```
--background #0b0d12   --card #12151c    --popover #171b24
--foreground #e7e9ee   --muted-foreground #767d93
--primary   #6a5ae0    --accent  #f5a524  --destructive #f1585c
--border    #242938    --input   #565e78  --ring #7c6cff
--radius    0.625rem
```

## Problems to solve, stated as problems not solutions

1. **Nothing adapts.** The shell is a hardcoded 240px sidebar plus content, with no breakpoint anywhere, and every page is a centred 1120px column inside it. On a 16 inch display that means four cards and two empty margins. The whole UI uses 25 responsive utility classes across roughly 16,000 lines of components.
2. **The hero number does not own the design.** Primary is a generic violet. The amber accent appears only on the outlier badge, so the one number the product exists to produce is the least emphasised thing on screen.
3. **Failure is the normal state and has no design.** Instagram rate limits, sessions expire, syncs come back partial. That is not an edge case here, it is most sessions. Right now it renders as a red alert bar.
4. **Tiny numbers need dignity.** The owned channel has 8 posts and about 5 followers, and posts have reached about nine people. The interface has to show a reach of 9 without looking broken and without pretending it is a trend.

## Screens, in the order they matter

1. **Outlier feed.** A grid of 9:16 thumbnails. The multiplier is the hero. Filters are follower band, score threshold, timeframe, fleet, and sort. Filters should read as current state, not as a form to fill in. Follower band stays prominent, it is how a five follower account finds copyable formats instead of famous ones.
2. **Video detail.** Left is the video and its metrics. Right is the analysis: the hook, the story beats, and the visual layout (on screen text and where it sits, cut rhythm, framing). Three exits at the end of the reading path: remix, save to vault, copy as prompt.
3. **Remix studio.** Five stages, Prompt, Research, Hook, Style, Script. It needs to feel like progress through a pipeline, and any stage can be blocked when the local model proxy is down.
4. **Channels.** Per channel sync health, run history, and a clear difference between a channel that is stale and one that has never synced at all.
5. **My channel.** Three views: a month calendar of published and planned posts, a post list, and metrics. Every figure carries its sample size.
6. **Dashboard, Vault, Settings.** Lower stakes. Consistency matters more than invention.

## Locked, do not redesign these away

- Dark only. No light mode.
- The outlier multiplier is the hero number on any card that has one.
- Follower band is a first class control in the feed, not hidden in a menu.
- Sync failure and recovery is a designed surface, not an error toast.
- Every own channel number displays its sample size.
- No fabricated numbers anywhere, including in your mockups. A missing value is a dash, never a zero.

## Open, and I want your opinion

- Keep the violet primary, or move the identity onto the amber that already marks outliers. One line in `globals.css` either way, and it decides the whole feel.
- Fluid width, or a wider fixed column. The feed grid packs at 240px minimum, so it can hold a lot more than it currently shows.
- Card density. Right now one size. Worth a compact mode for scanning 200 posts?
- Type. Currently the default sans with no pairing. Numbers are everywhere in this product and deserve a face that handles them.

## Real content for mockups

Use these. Do not invent creators or view counts.

| Score | Views | Caption |
|---|---|---|
| 10.1x | 2,272,877 | OpenAI has officially launched ChatGPT Work |
| 2.3x | 524,960 | This is the most advanced robot hand ever invented |
| 1.6x | 359,004 | This is gonna completely change how people make videos |
| 1.1x | 247,324 | This is the most insane tech company in the world. ASML. |
| 0.9x | 201,483 | I can't believe I just built this. I used AI to digitize my |
| 0.8x | 189,022 | This Japanese broccoli farmer automated his farm |
| 0.5x | 120,187 | Scientists just figured out how to reverse aging using AI |
| 0.2x | 38,580 | One of the most advanced food service robots ever built |

All eight belong to @kallaway, 442,447 followers, channel median 224,403 views. Reels between 73 and 111 seconds. A second channel, @hormozi, is tracked and has never synced, so its follower count is unknown.

The owner's own account is @kaiships.ai. Niche: Claude Code power user systems, agents and skills, for solo builders. Tagline: "Real Claude Code agents. No slop."

## What to bring back

Exact values, not descriptions. A `globals.css` token block that can be pasted in, the shell layout with its breakpoints, and the outlier card and video detail specified tightly enough to build: spacing, type scale, states, and what changes on hover and focus.

If a shadcn component needs a variant that does not exist yet, name the component and the variant rather than inventing a parallel component.
