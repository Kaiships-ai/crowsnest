# Crowsnest usability pass (flows)

Report-only browser pass against `main` / `8909788`, dev server at http://localhost:3000.
No code changed, no commits, no branch switches. HEAD did not move during the pass.

Method: gstack browse driving the real app, one core job at a time, walked as a first-time
user. Every claim below is something I did in the browser, with the observed state read off
the live DOM. A few were cross-checked with read-only `sqlite3` queries to tell "the UI is
hiding it" apart from "it was never produced".

Lens: task flow and friction. Can a user finish the job, where do they stall, what is
undiscoverable, what happens when it goes wrong. Functional bugs are in
`docs/reviews/2026-08-04-qa.md` and visual findings in `2026-08-04-design.md`; where a flow
finding sits next to one of theirs I cross-reference instead of refiling.

Quoted UI copy is reproduced with straight quotes to satisfy the repo writing rules. The app
itself uses curly ones.

## Jobs walked

Add a channel, read a sync result, find outlier reels, open a video and read its analysis,
find and run a frame pass, remix and export a script, read runs and logs to understand a
failure. Plus the blocked and empty states each job runs into.

## Two things that changed since the earlier passes

Worth stating up front because both prior reviews are built on them.

1. **Remix works end to end today.** QA H1 recorded script generation failing in 1.4s. I ran
   the full flow on a fresh session (`/feed/7c810d0b-.../remix`) and every generative stage
   succeeded: hooks in 27.8s, outline in 8.4s, "Script, 3 of 3 variants succeeded" in 13.2s.
   The script saved to the Vault. So Flow E is not blocked, and the remaining findings there
   are about the shape of the flow, not about it failing.
2. **The frame pass gate is one gate, not two.** QA H3 wanted a second unanalysed video to
   firm up the negative case. I have it: on `7c810d0b` (no analysis row) the Hook and
   structure tab contains exactly one button, "Transcribe & Analyze", and nothing else. The
   string `LAYOUT` does not appear. Same as QA's `0b033d3d`. The gate is confirmed on two
   videos now.

## What works

- The remove-channel confirmation is the best piece of copy in the app. It says what
  removal does, that it is soft, that the posts stay in the database, and that "there's no
  button in the app yet to bring one back". Naming your own missing undo is rare and right.
- The sidebar sync popover is a genuinely good status surface: phase, channels done,
  elapsed, and honest counters including "Instagram never says how many there are, so the
  per-sync cap is the only denominator".
- Empty states in the Remix research stage each name the specific thing that would fill
  them ("analyze the source video from Video Detail first", "Save a post from the feed to
  give research something to pull from") instead of just saying nothing here.
- `/mine` with no Graph token explains what connecting would add, in terms of the three
  metrics you would get, and still renders the planner underneath. It is the strongest
  blocked state in the app.
- The post-save step in Remix is honestly optional: "Optional, the script above is already
  saved either way. Skip this and it just stays in the Vault."
- The frame pass never-run copy earns its space, and the four dashes honour the
  no-fabricated-zero contract (QA already covered this).

## Findings

### High

#### H1. Adding a channel gives the user no confirmation and does not update the board

Flow B, step 1. Screen: `/channels`, "Add channel".

Steps:
1. Click "Add channel", type a handle, click "Track channel".
2. Watch the screen.

What happens: the dialog stays open about 6 seconds, then closes. Nothing else changes. The
header still reads its pre-click count, the board still shows the same cards, and no toast
or inline message appears. I polled the DOM every second through the whole window and every
poll returned no success text, no error text, no new card.

The channel really was created. Measured immediately after the dialog closed:

| check | value |
| --- | --- |
| header | `11 tracked - 1 never synced - 4 fleets` (unchanged) |
| new handle on board | false |
| row in `channels` | present |

A manual reload shows it. So the action succeeds and the screen lies about it. The first
thing a user does here is click "Track channel" again, because nothing told them the first
one worked.

The asymmetry makes it worse: **remove** does refresh. I removed a channel and the card
disappeared and the header dropped from 12 to 11 within about 4 seconds, no reload. So the
board can update itself, and does, for one of the two write actions on the screen.

Fix: revalidate the channels board after `addChannelAction` the way removal already does,
and raise a toast naming the handle that was added.

#### H2. A handle that fails to resolve is added anyway, and the failure is written only to the log

Flow B, step 1. Same screen.

I submitted `zzq_not_a_real_handle_9931`. The app created the channel. It also logged, at the
same second:

```
warn  backend  channel.add.profile_failed
      { "handle": "@zzq_probe_two_4471",
        "message": "Network failure talking to Instagram.",
        "code": "IG_NETWORK" }
```

So the profile fetch was attempted, it failed, the backend knew, wrote a warning with a
message written for a human, and then added the channel and told the user nothing. The
information the user needs exists and is one screen away on `/logs`, which they have no
reason to visit and no way to know about.

On the board the resulting card renders as `Z @zzq_probe_two_4471` and nothing else. No
follower count, no error, no marker. It looks like a channel that has simply not synced yet.
The only signal anywhere is the "1 never synced" count in the page header, which lumps it in
with legitimately new channels.

Combined with H1 the outcome is: the user typos a handle, gets no error, gets no
confirmation, sees no new card, reloads, finds a blank card, and has no way to learn why it
is blank.

Fix: surface `channel.add.profile_failed` in the dialog. Either block the add and show the
message, or add it and mark the card with the failure and a retry, but do not swallow a
warning the backend already phrased for a person.

#### H3. The frame pass error offers the one action that cannot work, and names a remedy that is not a control

Flow D. Screen: `/feed/a68a0361-f429-4091-a66f-e83096ab7ed2`, Hook and structure tab, Layout
section.

Rendered state, read off the page:

> Last frame pass didn't produce a reading: video has no downloaded video asset (sync with
> downloads first). **Retry frame pass**

Three problems stack up:

1. The only button attached to the error is "Retry frame pass", which will fail identically
   every time until the video is downloaded. The offered recovery is a loop.
2. The message tells the user to "sync with downloads first". I searched Settings for that
   control. What exists is a read-only row under Sync: "Video download / on demand /
   EAGER_VIDEO_DOWNLOAD=false: pulled on first play", and the section header says the rows
   below it are ".env.local-only, validated at boot". So the remedy the error names requires
   editing a dotfile and restarting the app. It is not a thing the user can do in the app.
3. The button that actually fixes it, "Download video", is on the same page, sitting over the
   player, with nothing connecting it to the error. QA read this as the recovery being at
   hand. Walking it as a user, it is not: the error points one way, the fix is somewhere
   else on the page under a different name, and the button next to the error points at the
   loop.

Fix: put "Download video" in the error itself as the primary action, and cut the "sync with
downloads first" clause, which describes an environment variable rather than a user action.

#### H4. The Style stage generates a 7-beat outline and displays none of it

Flow E, stage 4. Screen: `/feed/<videoId>/remix`, Style.

Steps: reach the Style stage, click "Generate outline", wait.

What happens: the run log records `Style, outline generated (7 beats) / Success 8.4s`. The
button changes to "Regenerate outline". The stage panel still reads, in full:

```
STRUCTURE
Source video's structure
Regenerate outline
```

The whole rendered page body at that moment was 614 characters. The outline is not in it.
It is in the database:

```
stage=style  length(outline)=908
{"beats":[{"label":"Hook","content":"I stare at my screen, 10 hours wasted every week
on busywork that keeps me from building.","targetSec":0}, ...
```

So the stage produced a real, structured, 908-character result and showed the user a
success line in a side panel instead of the thing itself. There is no way to read it, edit
it, or approve it before Continue carries it into the Script stage.

The inconsistency is what makes this high rather than medium: the Hook stage, one step
earlier, renders all five generated hooks as selectable cards with "Use this hook" and "Save
as template". The user learns at stage 3 that a generative stage shows you its output and
lets you choose. At stage 4 the same interaction produces nothing on screen, which reads as
a failure, not as a stage that quietly worked.

Fix: render the beats. The Script stage already renders its variants in an editable
textarea, so the pattern exists in the same file.

#### H5. The core job "find outlier reels" starts on an unfiltered list, while the app ships the right starting filter and never applies it

Flow C, step 1. Screen: `/feed`.

A bare visit opens on "All channels / Any score / Any views / Any timeframe", 452 results,
sorted by "Highest score". Per QA M2, 339 of those 452 have no score at all. So the default
state of the screen named Outlier Feed is a ranking of mostly unrankable rows.

The app already has the answer. Opening the "Saved views" menu shows:

| view | label |
| --- | --- |
| Balanced | |
| High Conviction | `default` |

Selecting "High Conviction" navigates to `/feed?minScore=10&minViews=500000&since=14` and
returns 3 results, all real outliers. That is the job, done, in one click.

The view is marked `default` and a bare `/feed` does not apply it. A first-time user has no
reason to open a menu called "Saved views" on their first visit, because they have not saved
anything yet. The one control that would teach them what this screen is for is named after
a thing they do not have.

Fix: apply the view marked `default` on a bare visit, and show "Clear filters" (which the
filtered state already renders) so the unfiltered list stays one click away.

#### H6. The sidebar offers a permanent link into an onboarding wizard with no way back out

Screen: every shell route, sidebar "GET STARTED 2/4" panel.

The checklist shows four items with "Finish setup" as a live link to `/first-run`. It is on
every screen in the app.

`/first-run` sits outside the shell, so there is no sidebar. Measured on the welcome screen:
zero `<a>` elements on the page, and exactly one button, "Get started". Clicking through to
step 01 gives four step tabs, five niche choices, and "Back". Still zero links. No skip, no
exit, no "I am already set up", nothing that returns to the app. The only ways out are the
browser back button and typing a URL.

To be fair to it: the wizard does resume rather than reset. On step 01 the current niche is
preloaded (`Other` carries `aria-pressed="true"`, matching the stored custom niche "AI tools
and building-in-public for solo founders"). So entering it is not destructive. It is just a
room with no door, reachable from a link that is present on every screen of a fully
configured install with 10 channels and 449 videos.

Fix: add a "Back to Crowsnest" link to the first-run layout. Independently, the checklist
counts 2/4 permanently, because `first_run_completed` is absent from `app_settings` on this
install, so the item can never tick.

### Medium

#### M1. A failed run offers "Retry" and no "View", and the row that does open it looks like plain text

Flow, debugging. Screens: `/runs`, `/runs/<runId>`.

In the Actions column, successful runs show "View" and failed runs show "Retry". Design M8
noted this. Walking it, the consequence is sharper than it looks: the row itself **is**
clickable (`cursor: pointer`, navigates to the run detail), but it carries no anchor, no
chevron, and no affordance beyond the cursor. So the path from a failure to its trace exists
and is invisible, while the visible control offers to run the failing thing again.

Fix: give failed rows both View and Retry.

#### M2. Drilling into a failed run shows less than the list did

Screen: `/runs/<runId>` for the "Instagram service timed out after 30000ms" run.

The list row states the reason. The detail page does not. Measured on the detail page:
`/timed out/i` against `document.body.innerText` returns false. What it shows is "Failed",
counters at 0, and a 3-row trace of `sync.started` and `sync.finished`.

So the user clicks into the detail for more and gets strictly less than the row they clicked.
The failure reason is dropped on the one screen dedicated to that failure.

This is the flow half of QA H2 (log events not tagged with the run id). Even fixing the
tagging would not fix this one: the reason is already stored on the run and simply is not
rendered in the header.

Fix: render the run's error message in the detail header.

#### M3. There is no path from a run to its logs, only timestamps

Screen: `/logs`.

Columns are Time, Level, Source, Event. There is no run id column. The filters are search,
three level checkboxes, a "Show everything" switch, a source select, an event box, and
since/until. No run filter, and `/run.?id/i` against the page text returns false.

So the surface map's question, how many clicks from a failure to the log line that explains
it, has no answer in clicks. The user copies a timestamp off the run and eyeballs the log
list for rows near it.

Fix: a run id filter on `/logs`, and a "See logs for this run" link on the run detail that
pre-fills it.

#### M4. Vault item actions are hidden behind an unsignalled click, and the action set differs by tab

Screen: `/vault`, all four tabs.

Every tab renders items as cards with no buttons and no links. The page-level buttons are
"+ New template" and the four tab controls, and that is all. The cards are clickable
(`cursor: pointer` opens a dialog) but nothing says so.

What is behind the click differs by tab, with no rule a user could infer:

| tab | actions in the dialog |
| --- | --- |
| Hooks | Delete, Use in Remix, Close |
| Scripts | Create Prompt, Close |

So a saved hook can be deleted and pushed into Remix. A drafted script, the most expensive
artifact the app produces, can only be turned into a prompt. There is no delete for scripts
anywhere in the UI, which means the Vault only grows. There is also no "attach to plan" from
the Vault, even though Remix offers exactly that immediately after saving; a user who skips
it there cannot get back to it.

On the surface map's question about whether Hooks and Styles read as orphans: they do not.
"Use in Remix" wires them to the Hook stage's "SEED FROM A VAULT HOOK" picker, which exists
and works. The problem is not that they are orphaned, it is that you have to click a card
that looks inert to find out.

Fix: put the actions on the card. Add delete to scripts.

#### M5. Generation runs for half a minute with a static word, while the panel built to narrate it stays empty

Flow E, stages 3 to 5.

Clicking "Generate hooks" replaces the button with the text "Generating...". It stayed that
way for roughly 35 seconds (the run log later recorded 27.8s plus round trips). During that
whole window:

- no elapsed timer, no progress, no estimate
- no cancel
- the RUN LOG panel, directly below, read "No generation attempts yet."

The run log only populates after the run finishes. So the one component on screen whose job
is to say what is happening says nothing is happening, for the entire time something is
happening. A user waiting 35 seconds with no signal will click again or leave.

Fix: write the attempt to the run log when it starts, not when it ends, and put an elapsed
counter on the button.

#### M6. Opening a video takes two clicks through an intermediate sheet, and the card's only link goes somewhere deeper

Flow C, steps 2 to 3. Screen: `/feed`.

A feed card's anchors are exactly two: the channel handle, and `/feed/<id>/remix`. There is
no anchor to `/feed/<id>`. The thumbnail is a `div[role=button]` labelled "Preview <caption>"
that opens the quick sheet; the sheet then carries "Open full page".

So the shallowest-looking affordance on the card (Remix) is the deepest commitment, and the
detail screen, where analysis, transcript, Layout and Save all live, is reachable only
through an intermediate sheet. It also cannot be opened in a new tab or middle-clicked,
which for a tool built around comparing posts is a real cost.

The thumbnail does carry `tabindex="0"`, so keyboard access is fine.

Fix: make the thumbnail or the title an anchor to the detail page. Keep the preview sheet on
a separate control.

#### M7. The Continue button is always enabled, so the stepper does not encode progress

Flow E. Screen: `/feed/<videoId>/remix`, stages 2 through 4.

At the Hook stage with nothing generated, "Continue" is enabled and advances to Style. Same
at Style with no outline. A user can walk from Prompt to Script touching no generative
button, arrive at a Script stage, and generate from a session with no hooks and no outline.

Nothing marks a stage as incomplete, and nothing warns on the way past.

Fix: mark stages that produced nothing, and either disable Continue or confirm the skip.

#### M8. Export is copy-to-clipboard only, with nothing on screen when the copy fails

Flow E, step 5. Screen: Remix Script stage, "Create Prompt".

Clicking it produced: "Couldn't copy to clipboard, check browser permissions." Nothing else.
No panel, no textarea, no download, no prompt text anywhere on screen.

The clipboard denial is an artifact of my automated browser and a normal user would get the
copy. The finding is the failure path: the export has exactly one delivery mechanism and no
fallback surface, so when the single mechanism fails the built artifact is unreachable. The
same control is the only action on a saved script in the Vault (M4), so this is the end of
the line for the whole Flow E.

Fix: render the prompt in a selectable panel and treat the clipboard copy as a convenience
on top of it.

#### M9. The sync summary counts a failure and gives no way to reach it

Screen: sidebar sync popover, and the run header.

The popover reports, for the last library sync: "31 created, 386 updated, **1 failed**, 1
deleted, 768 assets saved, 0 assets failed". The failure count is a number with no link, no
tooltip and no name. Per QA H2 the one `sync.item.failed` event is untagged, so it does not
appear in that run's trace either.

Same screen, two smaller things a user has to parse past: "took 14:41" appears with no
mention of the 10:00 budget it broke (QA M1), and "416 / 200 (cap) posts seen" reads as a
number exceeding its own cap until you get to the explanation after it.

Fix: make "1 failed" a link to the failing item or its log line.

### Low

#### L1. The "Paste reel URL" tab of the add dialog has no helper text

The "By handle" tab explains that a profile URL works too and is normalised. The reel tab is
a bare label, a field, and "Import reel". It does not say what importing one reel does, where
it lands, or whether it starts tracking the channel.

#### L2. The add-channel dialog does not mention fleets

The board is organised into fleets and has an "Unassigned" column. The dialog offers no
fleet choice and does not say the channel will land in Unassigned. A user who has built
fleets has to go find the new channel and drag it.

#### L3. "Your vault is empty" on a vault that has items

Remix research stage. The copy reads "Your vault is empty. Save a post from the feed to give
research something to pull from." The vault has 2 vault items and 7 scripts; only
`saved_posts` is 0. Same root as QA M3, different surface, and here it actively tells the
user something false about their own data.

#### L4. "Quick Remix" sits beside "Continue" with nothing explaining the difference

Remix stage 1. Two forward paths, no `title`, no `aria-label`, no helper text. A first-time
user cannot tell whether Quick Remix skips quality or skips work, and picking wrong costs
them the whole staged flow.

#### L5. The Vault renders script markdown literally

Saved scripts show `**Hook (~0s)**` with the asterisks, in both the list and the detail
dialog. The model's own output also carries an unbalanced bracket (`[VISUAL] ... corner]`)
that the app passes straight through.

#### L6. Scripts render at full length in the list, so the tab does not scan

Every script row prints the entire script body. With eight saved, the tab is a wall of prose
with no titles standing out, which is the opposite of what a library screen is for.

#### L7. Developer-facing strings in three user-facing places

The sync popover says the state is "Read straight off sync_jobs". Settings names
`EAGER_VIDEO_DOWNLOAD` and `.env.local` in body copy. `/mine` tells the user to set
`IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID`. The `/mine` one is defensible, since on a local tool
that genuinely is the action. The other two name internals to explain behaviour the user
cannot act on. Same family as design M17.

## Cost of the two flagship jobs, counted

**First outlier on screen, from a bare `/feed`:** 1 click, but only if the user finds the
"Saved views" menu. Otherwise they sort 452 rows of which 339 cannot be sorted (H5).

**Reading a frame pass, from `/feed`:** thumbnail, "Open full page", "Hook & structure" tab,
and before any of that the video needs both an analysis row and a downloaded asset. Five
preconditions, none signposted, on a catalog where 9 of 449 videos have an analysis and 8
have an asset. Nothing on the default tab of any video mentions that a Layout reading exists,
including the 8 videos that already have one: `/LAYOUT/` against the landing page text
returns false on both an analysed and an unanalysed video.

## Not tested

1. Starting a sync. Three reviewers share this checkout and database and a library sync now
   runs 14:41 and takes the global lock. I evaluated the sync entry points and read completed
   runs instead. The "run" half of "run a sync and understand its result" is unwalked.
2. Sync cancel and the progress UI while a run is in flight.
3. A frame pass on a video with an asset, for the same lock-sharing reason. The four states
   were read from the two videos that already sit in them.
4. `/first-run` past step 01. I stopped rather than write onboarding state on a shared
   install.
5. The planner on `/mine`: create, schedule, publish, delete.
6. Notifications panel, command palette, saved-view creation.
7. Mobile and keyboard-only walkthroughs.

## State I changed, and put back

Disclosed because this is a shared database.

- Added two probe channels (`@zzq_not_a_real_handle_9931`, `@zzq_probe_two_4471`) to test the
  add flow. Both removed through the UI. `channels` is back to 10 active rows; the two sit
  soft-deleted with a `deleted_at`, which is what the app's own remove does.
- Ran one full remix session on `7c810d0b` and saved the resulting script, so `scripts` has
  one more row than it did. I left it, because the UI has no delete for scripts (M4).
- Restarted the gstack browse daemon, which had lost its page and was answering every
  command with "No active page". The dev server was not touched.

## Counts

| severity | count |
| --- | --- |
| high | 6 |
| medium | 9 |
| low | 7 |
