# Cook debate: UI/UX lens

Adversarial pass on the Crowsnest "cook" feature, restricted to interface and
interaction design. Sources: the tracking mockup
(`docs/design/mockups/create-run-tracking-preview.html`), the proposed
architecture (`~/.agent/diagrams/crowsnest-cook-bigpicture.html`), the shipped
studio components (`studio-screen.tsx`, `studio-panel.tsx`,
`terminal-pane.tsx`), and `docs/design/DESIGN-SYSTEM.md`.

One framing note before the ranking: the mockup and the shipped code are not
the same product yet. `studio-panel.tsx` today has no status pill, no elapsed
timer, no Stop button, and no view-run link. It has a button that reads
"Cook," then "Retry cook," and a static output box that says "Cooking. The
render appears here when it finishes." That gap matters for a few of the
findings below, because the worst problems live in what is already live, not
just in what the mockup proposes.

## Ranked findings, worst first

### 1. The publish gate is a life-or-death action answered by typing into a terminal

`studio-panel.tsx`'s `publish()` sends `/ksa:serve\r` straight into the pty.
`markPlanPublishedAction` similarly fires from a plain button click. The
bigpicture doc confirms HITL approve/revise and mode-picker prompts happen as
text inside the same Claude Code TUI stream the operator is also watching
scroll past render logs, sub-agent chatter, and hook errors.

Publishing to Instagram through the real Graph API is not reversible in any
UI-visible way. There is no confirm step, no "you are about to publish X,
are you sure" modal, and no undo affordance anywhere in the mockup or the
shipped panel. The operator's only defense against a mis-typed answer to a
terminal prompt, or against pressing Publish while misreading which render is
loaded in the preview, is care. A founder operating this between other tasks,
tired, at the end of a 10-minute cook, is exactly the person who fat-fingers
a terminal answer.

Who hits it: the founder, at the exact moment they are least paying close
attention (the reward moment right after a render finishes).

Alternative: publish/approve/revise decisions should never resolve as free
text typed into a shared terminal stream. Pull them out as structured UI:
a button-and-modal pair rendered in the Output pane ("Publish this render? /
Yes, publish / No, revise"), driven by a structured event the terminal
session emits (like the existing `render` message type), not by parsing
what the operator typed into the pty. The terminal can still show the
prompt text for transparency, but the actual commit action needs a real
button with a confirmation step, the same way Stop already gets its own
button instead of requiring the operator to type `^C`.

### 2. The raw terminal is the primary surface, and it is a leaky abstraction

The center pane is a full ANSI-streaming xterm instance running a live
Claude Code TUI. The bigpicture doc's own "today" column lists what shows up
in that stream: banners, sub-agent chatter, and a known hook error
(`load_vault_context.py`) that fires because of implicit vault discovery.
None of that is content-operator language. "Envisioning the piece...",
"writing scenes... 6 cards", "phase: rendering scenes, 60%" (the mockup's
own sample lines) is closer to a debug log than to product copy, and it sits
directly next to actual internal errors the operator has no way to
distinguish from normal chatter.

DESIGN-SYSTEM.md section 1.1 sets the whole app's explanation budget at
zero, with the empty state and error states as the only exceptions. A raw
terminal violates that principle by construction: everything in it requires
the operator to already know what a Claude Code session looks like
internally to tell signal from noise, which contradicts "the founder is the
primary operator, not a developer by trade."

What is lost by hiding it: transparency and trust during a period when the
architecture is actively changing (E1 through E3 in the bigpicture doc).
While the harness is unproven, watching the raw stream is a legitimate
debugging tool.

Alternative: keep the terminal, but demote it. Make the status strip plus a
short, product-language phase list ("Writing script -> Voice -> Rendering ->
Done") the primary surface in the center pane, with the raw terminal
available behind a "show session log" disclosure, off by default. This
keeps the transparency for debugging without making ANSI scrollback the
thing a non-developer stares at for 10 minutes.

### 3. A failed cook's real diagnosis lives one click away, in an unbuilt page

The mockup's Failed state in the studio pane shows a decent summary
("Render failed, no render after 12 minutes... Press Retry cook to start a
new run"). But the actual diagnosis (the timeline, the "no heartbeat for
6:00" warning, the first-error callout) only exists on
`/runs/[runId]`, a page that does not exist in the shipped app yet. The
studio's own "view run" link points at `#detail` inside the mockup file,
not a real route.

Today, in the shipped `studio-panel.tsx`, a failed cook has no dedicated
failure UI at all: the Output pane's placeholder text is only "Cooking. The
render appears here when it finishes" (bound to `started`, not to a result
state), so a failure currently reads as a cook that silently never finishes.
The only real signal is whatever text scrolled by in the terminal, which the
operator would have to scroll back to find, unlabeled as an error versus
normal log noise.

Who hits it: anyone who steps away during a cook and comes back to a stalled
pane, which for a 10-minute-plus render is the common case, not the edge
case.

Alternative: ship the failure state in the studio pane before or alongside
`/runs/[runId]`, not after. The studio pane already has the room (the
mockup's own `.err-copy` block); it does not need the full run detail page
to stop lying about what happened. Treat "Output pane shows a truthful
result for every terminal run state" as the actual Layer 1 bar, independent
of whether `/runs/[runId]` ships in the same pass.

### 4. Stop sits next to "view run," not next to Retry, and that is a mis-click risk in the wrong place

The team's hypothesis was "Stop is too easy to hit next to Retry." Checking
the mockup: that specific risk does not exist. Stop only renders in the
Running state; Retry only renders once a run has a terminal result (done,
failed, canceled). They are never adjacent, because they never coexist on
screen. That part of the design is fine and worth keeping.

The real adjacency risk is different: in the Running state, the order is
`pill -> elapsed -> view run -> Stop`, all inside one `.spacer` flex row
with equal visual weight (mono 2xs text and pill-shaped buttons at the same
size). "View run" is a `text-decoration:underline` link; "Stop" is a
`--destructive`-washed pill directly to its right. Reaching for "view run"
mid-cook, on a trackpad or a touch surface, is one slightly-short click away
from Stop, which fires immediately with no confirmation and ends a
render that might be at 90%.

Alternative: put visual and physical distance between "view run" (an
inspect action) and Stop (a destructive action). Either move Stop to its
own trailing position with a gap wider than the standard `--sp-3`, or
require a second click to confirm Stop (a two-stage button, "Stop" ->
"Confirm stop" within a short window) given how much work a canceled cook
throws away.

### 5. The output pane is static for the entire cook, which pulls the eye back to the terminal

The task description asks where progress lives during a 10-minute cook.
Answer, as designed: nowhere the eye should be looking. The mockup's Output
pane during Running shows one static sentence and a Layer 2 progress bar
explicitly marked "later, not in this release" and rendered at `opacity:.5`
to signal it is not real yet. The shipped `studio-panel.tsx` matches this:
the Output box's text is static ("Cooking. The render appears here when it
finishes.") for the full duration.

That means the only thing on screen that changes during a cook is the
terminal's scrolling log and the elapsed timer's seconds ticking over. The
operator's eye has nowhere else productive to go, so it goes back to problem
#2, the raw log, which is the opposite of what a three-pane layout with a
dedicated Output pane should achieve. Brief (left) and Output (right) both
go visually inert for the entire cook; only the center pane is alive.

Alternative: Layer 1 does not need a numeric progress bar to give the Output
pane something honest to show. A phase label ("Writing script" ->
"Recording voice" -> "Rendering") sourced from the same `render-watch`
events the bigpicture doc already proposes for D1's watcher would give the
right-hand pane a reason to hold attention without inventing a percentage
the system cannot back up yet.

### 6. First-run has no explanation of cost, duration, or what "Cook" commits to

Idle state, per both the mockup and the shipped panel: a "Cook" button and a
blank terminal prompt. DESIGN-SYSTEM.md section 1.1 allows exactly one
exception for "no self-explaining UI": the first-run empty state. This
screen does not use it. There is nothing telling a first-time operator that
pressing Cook starts a session that can run 10+ minutes, spawns a real
subprocess, and (per the bigpicture doc) will eventually consume paid
model usage per profile. The button reads the same on cook #1 as on cook
#50.

This is lower severity than the findings above because the cost of getting
it wrong once is recoverable (Stop, or wait it out), but it is a real first-
impression gap for the stated audience: a founder, not a developer, seeing
a "Cook" button next to a terminal prompt for the first time, with the
Output pane and the terminal empty, and no signal for what happens next
or how long to expect it.

Alternative: use the design system's own carve-out. One sentence under the
idle Output placeholder ("A cook takes about 10 minutes and produces one
render") answers duration without adding chrome, matching the section 1.1
exception's own bar ("one sentence naming what is missing, one button
naming what to do," from section 8's empty-state rule).

## Minor watch item, not ranked above

The running-state pill's amber dot/text is justified in the mockup's own
CSS comment as an addition to the amber budget ("score badges + the
running-state dot/pill only"), but `DESIGN-SYSTEM.md` section 3's canonical
allow-list (score badge, chart cells, "exactly one primary action per
screen") does not list a status pill. During Running, the screen shows both
the Brief's score badge and the pill simultaneously, which is two amber
uses on one viewport. The design system's own ship checklist (item 1) says
score badges do not count toward the one-large-amber-area limit, so this
probably clears the letter of the rule, but the base doc should be updated
to say so explicitly rather than leaving the running pill's amber exception
declared only in a mockup's source comment.

## Biggest concern

Finding #1. A destructive, irreversible, real-world action (publishing to
Instagram through the live Graph API) resolves through free-text answers
typed into a shared ANSI terminal stream, with no confirmation UI and no
visible undo path anywhere in the mockup or the shipped code. Everything
else on this list is a legibility or attention problem; this one is a
"the operator can accidentally publish the wrong thing with no safety net"
problem, and it sits at the exact moment (right after a successful cook)
when attention is lowest and the reward feeling is highest.

## Strongest endorsement

Making Stop and Retry cook mutually exclusive by tying them to disjoint run
states, rather than showing both at once and relying on button copy or
disabled-state styling to keep them apart, is the right call and is already
correctly modeled in the mockup. It removes an entire class of "which button
did I mean to press" error by construction instead of by hoping the operator
reads the label carefully. The same instinct (state determines what can
exist on screen, not just how it looks) is also why turning a cook into a
tracked run with a durable `/runs/[runId]` record is worth building: it is
the only piece here that survives the operator looking away for the full
10 minutes and coming back to something they can actually read.
