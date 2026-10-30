# Research: how a reel maker works and judges a reel

Lens: creator tools. This page records what I looked at, what holds up, and what the prototype takes from it.

Most public writing on these tools is vendor copy or review blogs, and some of those blogs belong to competitors. I mark that below. I found no independent study of any of these claims, so I only use them as signals of what makers care about. I did not use any of these products hands-on; everything here comes from their pages and from written reviews.

## What I looked at

| Source | What it gave me | How far to trust it |
| --- | --- | --- |
| [Descript: video editing](https://www.descript.com/video-editing) | "If you know how the backspace key works, or how to copy-and-paste, then you already know how to make video in Descript." The transcript is the edit. | Vendor's own words. |
| [Descript reviews on Product Hunt](https://www.producthunt.com/products/descript), [G2](https://www.g2.com/products/descript) and [Hack'celeration](https://hackceleration.com/labs/review/descript) | Praise goes to text editing. Complaints: slow on long projects, crashes, and a composition and track model that trips people up. | User reviews, read through search summaries. |
| [Opus Clip reviews, eesel](https://www.eesel.ai/blog/opusclip-reviews) | Calls the virality score "Often inaccurate; not a reliable measure of success". Reports a "clunky editor that makes fixing the AI's mistakes feel like a real chore". | Review blog, summarizing users. |
| [Opus Clip test, BIGVU](https://bigvu.tv/blog/opus-clip-tested-2026-where-ai-wins-40-percent-discard/) | One test over 14 days: "roughly 40% of generated clips end up in the trash", because a moment was incomplete or captions drifted. "A first-pass tool rather than a set-and-forget one." | BIGVU is a competitor. One tester. |
| [Opus Clip API blog](https://www.opus.pro/blog/viral-moment-detection-api) | The score is a 0 to 100 estimate of hook strength, emotional peaks and trend fit. | Vendor. No published validation that I could find. |
| [CapCut reviews, eesel](https://www.eesel.ai/blog/capcut-reviews) | Liked: trimming and timeline edits feel simple, auto captions save time. Disliked: "very complex multi-track edits can feel cramped". | Review blog. |
| [Captions in CapCut, Riverside](https://riverside.com/blog/how-to-add-captions-in-capcut) | Auto captions often need manual syncing and correction. | Riverside is a competitor. |
| [Creating with Gen-4, Runway help](https://help.runwayml.com/hc/en-us/articles/37327109429011-Creating-with-Gen-4) | Test in the cheap Turbo model, then move to the full one. Seen through search only: the page refused a direct fetch. | Vendor. |
| [Runway Gen-4 review, Fluxnote](https://fluxnote.io/blog/runway-gen-4-review-is-it-worth-the-price-2026) | "Failed generations or multiple iterations quickly deplete your allowance." 30 to 40% of that team's takes needed re-prompting. | Review blog, one team. |
| [Instagram's retention chart, Website Builder Expert](https://www.websitebuilderexpert.com/news/instagram-reel-retention-chart/) | Instagram shows "the percentage of views from people who continued to watch your Reel at each moment". Skip rate counts people who swipe past in the first three seconds. | Reports Instagram's announcement. |
| [Reels skip rate guides: Inro](https://www.inro.social/blog/instagram-reels-insights), [Metricool](https://metricool.com/instagram-reel-analytics/) | Read a sharp early drop as a weak hook, a slow slide as lost momentum. Guides disagree on benchmarks. The sensible ones say compare against your own recent reels. | Third-party guides. |
| [Edits by Meta, Buffer](https://www.buffer.com/resources/instagram-edits) and [Inro](https://www.inro.social/blog/edits-new-meta-app) | Ideas, drafts and insights in one app, including skip rate and retention. Mosseri: "It's more for creators than casual video makers." | Second-hand reports. Buffer had not tested it yet. |
| Claude Desktop vs Lead Studio study, `documents/plans/polish-study.md` on `KineBeo/polish-study` | One screen for one job. Answer at once, then fill a reserved shape. Speak the maker's words. Lead's honest waits and kept work are already better. | Our own captures. |
| Spec in Kai's handoff folder (`proto/data.js`, `proposal/data.js`) | The 6-step loop, the sources, the reel and funnel model. I read these and only skimmed `proposal/wireframes.js`. | Our own. |
| `documents/brand/mascot/index.html`, plus `hallmark`, `apple-design` and `emil-design-eng` | Mascot code reused as is. Rules: banned default fonts, no card nesting, interruptible motion, no ease-in, no scale from 0. | Our own. |

## What works, and why

1. **The artifact is the interface.** Descript's strongest idea, and the part its users praise most, is that you work on the thing itself instead of on a control panel. A reel maker's thing is the reel.
2. **Numbers mean something at a moment in time.** Instagram's own chart plots retention against the seconds of the reel. A maker asks "what was on screen when they left?", and a dashboard tile can't answer that.
3. **The timeline is the maker's home.** CapCut users praise simple timeline edits. Every editor keeps a monitor above a timeline, so the layout needs no teaching.
4. **Skimming is how editors judge.** The curve plus a frame that follows the pointer turns reading a number into watching the moment.
5. **Your own history is the benchmark.** Guides disagree on what a good skip rate is, so a fixed target would be invented. "Usual 36%" is true for this maker.
6. **Takes are expected to fail.** Runway and Opus Clip reviews both show a large share of output gets thrown away. So a cook has to be cheap to fix: resume, not restart, and a note pinned to one second.

## What to refuse

| Refuse | Why |
| --- | --- |
| A virality score | The reviews above call it unreliable, and it invites posting without watching. Lead Studio shows the real curve and says plainly that it gives no score. |
| Publishing straight from an AI pick | The BIGVU test throws away about 40% of clips. Final check stays a human step. |
| A multi-track editor | We do not edit video here. CapCut owns that, and its complex-edit complaints show how hard it is. The timeline holds reels and seconds, not media tracks. |
| Credits and spend meters in the main view | Runway's meter is a real cost for its users. Lead Studio has no credits, only limits that reset, so limits read as "back at 14:00". |
| Templates, trend feeds, effect libraries | They serve a maker with no idea. This loop starts from your numbers and rivals. |
| Stacks of cards, gradients, glow | Named slop in `hallmark`. Hairlines and type carry the layout, with one accent. |

## Strategy chosen: the bench

One screen, laid out like an editor: **monitor, desk, note, and one timeline along the bottom**. Every reel is a clip on that timeline, from an empty day to its sales. Zooming is navigation: month, week, then the seconds of one reel, with no screen change. After the end of the reel, the same axis carries on into "After the reel": comments, DMs, gift page, sales.

The mascot's job is to sit where the next thing is. There is only one of it, and it flies there: on the clip that waits for you, in the empty monitor, or asleep when a limit is running.

## Rejected alternatives

1. **Reel inbox, one card per reel moving through columns (Kanban).** Clear status, but it hides time. A maker's week, and the seconds of a reel, both live on an axis. It would also bring the card wall back.
2. **Script first, a full Descript-style document for the whole app.** Great for Plan and Approve, weak for Pull and Insight, where the raw material is numbers and frames. I kept the idea only where it fits: in Plan, the script is the reel.
