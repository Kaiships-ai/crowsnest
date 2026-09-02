# Crowsnest V1 product review, 2026-07-31

Independent review, done from the running app at localhost:3000, not from source
alone. The dev server was not actually running when this review started (`curl` to
port 3000 refused the connection); I started it myself with `npm run dev` before
testing anything, so every screenshot and every claim below is from a live session
against the real seeded database (2 channels, 8 videos, 1 analysis, 0 saved posts
at the start).

Confirmed before testing: the local model proxy at localhost:20128 is down (the
app's own remix screen reported a connection failure against it, not something I
assumed). The Instagram Graph API token is unset (Settings confirms "No Graph API
token is set on this machine"). The Instagram sidecar (instagrapi, burner account)
has real credentials in .env.local but the sidecar process was not running; I did
not start it, since that means logging a real burner account into Instagram and
Settings' own risk notice says that can get the account challenged or banned. I
was not asked to take that risk and didn't think it was mine to take.

## If Kai sat down tomorrow morning

He opens the app (assuming the dev server is already running, since nothing
auto-starts it) and lands on the dashboard. It's honest: a real partial-sync
banner, real tile counts (2 channels, 2 scripts drafted, both match the database),
a real top outlier. So far, good.

He clicks Feed. This is where the first real problem shows up. The filter row
reads "All channels, Any score, Any views, Last 30d," which looks like nothing is
filtering the list. But the page is silently applying the "Balanced" saved
preset (minScore 5, sinceDays 30) whenever the URL carries zero params, and the
filter controls never learn about that: they read only the URL, which is empty,
so they show "Any score" while a minScore of 5 is actually active. Of his 8 seeded
posts, 7 have a score under 5 and vanish with no visible reason. Feed shows "1
result" under a "Any score" label that is not true. He would have no way to know
his library isn't actually empty without opening the URL bar or knowing to click
into a Select that already claims to say "Any."

He clicks the one card he can see, a real 10.1x outlier. The detail screen is
strong: hero score, a median bar with the 1.0x marker and the real channel median
(224.4K), a sampled-posts histogram, a correctly-shown "Low confidence" label
(the channel has 8 of roughly the 10 posts a median needs). He clicks "Transcribe
& Analyze." It fails immediately, but honestly: "video has no downloaded video
asset yet, sync must download it before it can be transcribed." He clicks
"Download video." It fails again, just as honestly: "The Instagram service isn't
running. Start it with `npm run ig:service`." That's a real, unavoidable stop:
before Kai can read a transcript for any post in his library, he has to leave the
app, open a terminal, and start a Python sidecar that logs a real Instagram
account in.

Say he does that (untested here, for the reason above) and gets a transcript. He
opens Remix. Prompt and Research complete on their own with real data (I saved a
post to the Vault mid-review and confirmed Research picked it up immediately,
correctly, with its real score and channel). Hook generation then fails, again
honestly: "Hook generation is blocked, nothing answered at
http://localhost:20128," with a run log of the actual failed attempts and the
literal fix ("Start the local proxy in a terminal, then retry, this stage isn't
broken, it's offline"). To get past that he either starts his usual local router,
or edits .env.local to drop ANTHROPIC_BASE_URL and route directly to the real
Anthropic API on the ANTHROPIC_API_KEY that Settings already shows as
"Configured," which costs real money per call and is a decision the app surfaces
but does not make for him.

So: no script gets produced tomorrow morning without Kai first doing two pieces
of setup outside the app, in a terminal, one of them carrying real account risk,
every session. Once both are running, everything I could exercise downstream of
them (research reading the vault, the plan-needs-a-script gate, the honest
"nothing here publishes" copy on the planner) is real and worked exactly as
specified. The one job is built. It just doesn't start itself.

## Scores

**1. Usability: 7/10.** Navigation is self-explanatory (grouped sidebar, "<-/->
keys work too" shown inline on the detail screen, prev/next actually work),
and every empty or disconnected state I hit gave exactly one next action rather
than a dead end. The wound is the Feed's silent default filter (above): it can
make a working library look empty with no visible cause, which is the opposite
of "read as current state." Getting to a script also requires knowing to open a
terminal twice, which is disclosed everywhere it matters but is still a
"read the docs" moment for a tool meant to be opened, not launched.

**2. Friendliness: 8/10.** This is the app's clearest strength. Every failure
state I actually triggered (sidecar down, model proxy down, no Graph token,
empty vault, never-synced channel, a no-script plan) named the exact cause and
the exact fix, several with the literal command to run. That is the brief's
"failure is the normal state" rule, actually built. Docked for the Feed filter
mislabel above, and for the partial-sync banner repeating identical copy on
every single screen with no way to tell whether it's the same stale sync from
hours ago or a new one.

**3. Value: 5/10.** The measurement half of the one job (score, median,
histogram, confidence, thin-sample warnings, band chips) is real, consistent
across every screen, and does exactly the diagnostic job CONTEXT.md describes.
The remix half (hook, script, layout) is real and wired correctly wherever I
could reach it, but it sits behind two services that are off by default and one
of them carries account risk to turn on. On an ordinary morning, today's value
caps at "here is a post that beat its baseline and roughly why," not "here is a
script," through no fault of the code.

**4. Trust: 6/10.** Every number I cross-checked against the database (outlier
score, views, channel median, engagement rate, scripts-drafted count, the saved
post's score in the vault) matched exactly, and the low-confidence and
thin-sample notices appear exactly where the sample is genuinely too small.
That foundation holds. It loses points for one real, specific hole: the Feed's
own filter controls can say "Any score" while a hidden default is actually
excluding 7 of 8 posts. On a research tool whose entire pitch is a number you
can trust, a filter that misreports its own state is exactly the failure mode
the brief calls fatal, even though the underlying score math never lies.

**5. Completeness against v1-scope.md section 2 (spot check): 6/10.** Holds up:
channel health states (never-synced hatched row with dashes, thin-sample note
with the real post count), follower band chips with live counts, the planner's
script-or-acknowledgement gate (Create plan stays disabled until one is
chosen), Vault's empty state and its real save-and-reappear flow, remix Research
actually reading the Vault, My channel's designed "not connected" surface, and
the first-run welcome screen's four real, numbered steps. Fails one named P0
item: the truth pass was supposed to remove the platform filter from the feed
entirely (v1-scope.md's truth pass table, and acceptance criterion "No platform
filter, platform chip, or platform icon appears anywhere in the feed"). It
wasn't. filter-bar.tsx still ships an All/IG toggle in the filter row (confirmed
in source and on screen), and docs/product/truth-pass-report.md records this as
a deliberate choice ("kept All and IG") rather than an oversight, so it reads as
closed when the acceptance criterion it was supposed to satisfy still fails.
Everything else named in that same truth pass (the card's platform chip, the
TikTok/YouTube profile URL builders) was genuinely removed.

## One more thing worth flagging

Whether the app's own claims about itself agree with what's on screen. Since
trust is the whole premise, I checked the codebase's own reports against the
running app and found one place they diverge: truth-pass-report.md and
v1-scope.md's acceptance criteria disagree about whether the feed's platform
control counts as "removed," and nothing caught that before this review. On the
other side of that ledger, the negative-state design (every failure surface I
found) is genuinely better than most V1 products ship, and it is consistent
enough that I'd trust a new failure state I hadn't seen yet to follow the same
pattern.

## The single biggest thing standing between this and daily use

Getting from "open Crowsnest" to "have a script" requires Kai to personally
start two background processes by hand, in a terminal, before every session:
the Instagram sidecar (which also carries real account-ban risk per the app's
own warning) and a working LLM backend. Until one of those is either
auto-started or reduced to a single in-app action, this is a tool he has to
launch, not one he can open.
