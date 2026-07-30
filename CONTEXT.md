# Crowsnest

A single user research tool for short form video. It watches Instagram creators, finds the posts that beat their own baseline, explains why they worked, turns the pattern into a new script for Kai's niche, and holds the plan for when that script goes out. Filming and publishing stay outside it. This file is the glossary. It holds vocabulary only, no design and no implementation.

## Accounts and identity

**Channel**:
Any Instagram account whose posts Crowsnest stores.
_Avoid_: creator, profile, account

**Tracked channel**:
A Channel Kai does not own, read through the burner via instagrapi. Public numbers only.
_Avoid_: competitor, watched channel

**Owned channel**:
A Channel Kai controls, read through the Instagram Graph API with his own token. The only kind that has Insights.
_Avoid_: my channel, own account, connected account

**Burner**:
The throwaway Instagram account whose credentials drive instagrapi. It never touches an Owned channel.
_Avoid_: scraper account, bot account

**Fleet**:
A named group of Channels, used to scope the Feed to one niche or cohort.
_Avoid_: watchlist, list, folder

## Posts and measurement

**Video**:
One stored Instagram post, whatever its media type. Photos and carousels are Videos too.
_Avoid_: post, reel, media, item

**Insight**:
A metric that exists only for an Owned channel: reach, saves, shares, profile visits, follows from post, watch time.
_Avoid_: analytics, stats, engagement data

**Baseline**:
The middle view count across a Channel's recent Videos. What "normal" means for that Channel.
_Avoid_: average, median views, benchmark

**Outlier score**:
How many times a Video beat its own Channel's Baseline.
_Avoid_: multiplier, virality score, performance ratio

**Outlier**:
A Video whose Outlier score clears whatever threshold is being applied. Not a fixed number.
_Avoid_: viral video, banger, top post

**Reproducible outlier**:
An Outlier on a small Channel, where the reach came from the post rather than from an existing audience. The kind Kai can copy at his own size.
_Avoid_: small account win, organic outlier

## Study and reuse

**Transcript**:
The spoken words of a Video with timestamps, produced locally.
_Avoid_: captions, subtitles, text

**Analysis**:
The stored breakdown of one Video: its hook type, its story beats, its format and its visual layout, plus why it likely beat the Baseline.
_Avoid_: breakdown, insight, report

**Hook**:
The opening move of a Video, the part that stops the scroll.
_Avoid_: intro, opener, first three seconds

**Layout**:
What a Video looks like rather than what it says. On screen text and where it sits, cut rhythm, framing, b roll pattern. Read from frames, never from the Transcript.
_Avoid_: style, visual style, format, template

**Vault item**:
A reusable Hook or Layout saved out of an Analysis, or written by hand, kept for future Remixes.
_Avoid_: template, saved hook, swipe file entry

**Remix**:
Turning a studied Video into a new script for Kai's niche, staged as Prompt, Research, Hook, Style, Script.
_Avoid_: generation, rewrite, scriptwriting

**Script**:
The finished text a Remix produces. Filming and publishing belong elsewhere.
_Avoid_: draft, content, copy

**Planned post**:
A dated intention to publish, optionally carrying a Script. Lives only in Crowsnest and never touches Instagram: nothing schedules, nothing publishes, nothing reminds. Kai marks one published by hand or it stays a plan.
_Avoid_: scheduled post, queue item, calendar entry, campaign

## Operations

**Sync**:
One run that pulls a Channel's profile and recent posts, downloads their images, and recomputes Outlier scores.
_Avoid_: scrape, fetch, refresh, pull

**Lookback**:
How far back in time a Sync reaches.
_Avoid_: window, date range, history depth

**Cooldown**:
The account wide pause after Instagram signals it has had enough. It applies to the Burner, not to one Channel.
_Avoid_: rate limit, backoff, throttle
