# Sandcastles v3 UI backlog, 2026-08-08

Source: six screenshots of Sandcastles' current app (Kane Kallaway walkthrough), newer than the
2026-07-23 FEATURES.md inventory. This is a menu of features their live UI has that Crowsnest does
not, each mapped to what Crowsnest ships today and sized for a single-user local build.

Size tags: S under half a day, M about a day, L multi-day. Priority is for this local clone, not for
Sandcastles.

## What the screenshots show

Their nav is grouped Research (Videos, Ideas), Create (Scripts, Projects, Exports), Setup (Channels,
Persona, Automations, Settings). Crowsnest nav is Feed, Vault, Channels, My channel, Dashboard, Logs,
Runs, Settings. The gaps below come from that difference plus the detail on each screen.

## Must, the ideas loop

### B1 Ideas inbox with triage

What they have: an Ideas surface with a count badge (30 pending), an Inbox and a Shortlist tab. Each
idea is a card carrying its source video, outlier multiple, views, and engagement. You move through
the queue and act: Shortlist, Discard, Go to Analysis, or Create script. There is a Discard all. Each
idea has a Your Notes field.

Crowsnest today: no ideas concept. The closest is the remix Research stage, which pulls related
outliers inside a single generation, then throws them away. Nothing persists an idea as a reviewable
object.

Why it matters: this is the daily habit loop. Sync surfaces outliers, an ideas pass turns each into a
one-line concept, and the inbox is where you triage them into scripts. It is the reason to open the
app every morning. Everything else is downstream of having ideas to work.

Size: L. Needs an ideas table (source video, generated concept, status inbox/shortlist/discarded,
notes), a generator that reads a video analysis and writes a concept, and the inbox UI.

### B2 Keyboard-driven idea and video actions

What they have: an action menu on a card with single-key shortcuts. Create script C, Shortlist S, Add
to project A, Save hook template H, Export for LLM E, Open in new tab O, Remove from vault R. The whole
triage runs from the keyboard.

Crowsnest today: mouse-only. Buttons exist for some of these (Remix, Save to Vault, Copy as prompt),
but no keyboard layer and no single command surface.

Size: M. A shared command menu component plus a key handler, reused on the idea card and the video
detail action rail.

## Should, discovery and organization

### B3 Channel discovery: Describe and Suggested

What they have: the add-channel dialog has four tabs. Suggested lists curated creators grouped by
category (Social media marketing strategies, Content creation advice). Describe takes a natural
language niche ("social media marketing growth") plus platform and account-size filters and returns
matching creators. Search and Add URL are the manual paths. A Your Watchlist side panel builds up as
you pick, with Save and Remove all.

Crowsnest today: add-channel has only By handle and Paste reel URL. No discovery. You have to already
know the handle.

Caveat for a local clone: Suggested needs a seed list of creators per niche, and Describe needs an LLM
plus a search source. Crowsnest has no channel database of its own. Describe is buildable against the
existing LLM proxy plus the IG sidecar to resolve results, but it is the heaviest item here and it
leans on the sidecar that currently 503s on profile lookups.

Size: Suggested from a hand-seeded list S. Describe with LLM plus resolve M to L.

### B4 Projects

What they have: a first-class Projects surface under Create, and Add to project is an action on ideas
and videos. Groups research, ideas, and scripts per niche or campaign.

Crowsnest today: not built. Flagged already as the one must/should gap against the older inventory.
Vault plus fleets partly cover grouping, but there is no object that holds an idea, its source videos,
and its scripts together.

Size: M. A projects table, a members join (idea, video, script), a nav surface, and the Add to project
action.

### B5 Persona as a first-class profile

What they have: Persona is its own Setup surface, not a settings field. It is the audience and voice
profile that every generation reads from.

Crowsnest today: a Niche profile textarea buried in Settings ("AI tools and building-in-public for
solo founders"). It already feeds Remix, so the concept exists, it is just not a real surface and it
holds one paragraph.

Size: S to M. Promote the existing niche profile to its own page and let it carry more structure
(audience, voice, do and do-not list) that the generators read.

### B6 Exports surface

What they have: Exports under Create, and Export for LLM is a per-item action. Implies a place to see
and re-pull past exports.

Crowsnest today: Copy as prompt exists on video detail, and export.ts builds the payload, but there is
no exports history or surface.

Size: S. A list of past exports with re-copy, if export events are already persisted; otherwise add
the record first.

## Should, the video and feed screens

### B7 Video detail summary and Idea Analysis tab

What they have: the detail page leads with a Summary paragraph, then tabs Transcript (with a word
count), Idea Analysis, Hook, Storytelling Format, Visual Layout.

Crowsnest today: tabs are Transcript, Hook and structure, Why it worked, Layout. No summary block, no
word count, and no distinct Idea Analysis (the thing that seeds B1).

Size: S for the summary and word count. The Idea Analysis tab is really the front end of B1.

### B8 Feed filters: engagement and analyzed status

What they have: the Videos filter panel adds an Engagement range and a Status filter (Analyzed and
Unanalyzed checkboxes) on top of channel, keyword, outlier score, views, posted-in-last, and platform.
Plus a top-bar Add video URL and Customize channels.

Crowsnest today: feed has channels, score, views, timeframe, followers tiers, and saved views. No
engagement filter, no analyzed-versus-unanalyzed filter.

Size: S each. Engagement is a stored field already shown on cards. Analyzed status is whether a
video_analyses row exists.

## Later, would need real infra

### B9 Automations

What they have: an Automations surface under Setup. No implementation detail is visible, but the name
plus a lightning icon reads as scheduled or triggered flows (auto-sync, auto-generate ideas on new
outliers).

Crowsnest today: none. The sync cadence setting even says out loud "No scheduler exists. A sync only
ever starts from a click." So this is a genuine gap and a genuine build: a scheduler the app does not
have yet.

Size: L. A scheduler plus the jobs to run on it. Related to the deferred perf work, since a background
scheduler and the sync lock design have to agree.

## Suggested order

1. B7 summary and B8 filters first. Small, visible, no new infra.
2. B1 Ideas inbox and B2 keyboard actions next. This is the product's daily loop and the highest value.
3. B4 Projects and B5 Persona to give ideas and scripts a home.
4. B3 Describe discovery and B9 Automations last. Both need infra Crowsnest does not have (a channel
   source, a scheduler) and both lean on the sidecar.

## Open questions for Kai

- Ideas: should an idea be generated automatically on every new outlier from a sync, or only when you
  ask for one on a video. Auto-generate is the habit loop but spends LLM calls on posts you may never
  open.
- Discovery: is a hand-seeded Suggested list enough, or is Describe (niche to creators) a real need.
  Describe is the heaviest item and depends on the sidecar that currently fails profile lookups.
- Do Projects and Vault stay separate, or does a Project become the container and Vault just the
  reusable hook and style templates inside it.
