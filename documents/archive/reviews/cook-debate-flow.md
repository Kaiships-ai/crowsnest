# Cook debate: FLOW lens

Adversarial pass on the proposed cook sequence (brief handoff, HITL gates, publish,
cancel/retry), checked against the actual `/ksa:cooking` and `/ksa:serve` command text
and the code that is actually shipped today, not just the diagram.

Ground truth used below:
- `src/server/terminal/ws.ts`, `session.ts`, `render-watch.ts`, `src/server/studio/paths.ts`
- `Kai-Official-OS/.claude/commands/ksa/cooking.md` and `serve.md`
- `docs/design/mockups/create-run-tracking-preview.html`
- `~/.agent/diagrams/crowsnest-cook-bigpicture.html`

One fact up front that changes the whole read: the code shipped today is still the
"today, coupled to the vault" lane from the big picture doc, not the proposed one.
`session.ts` spawns `claude --dangerously-skip-permissions` (not the
`--permission-mode bypassPermissions` flag the proposal lists), and `paths.ts`
computes the cook's cwd as `VAULT_PATH/Studio/workspace/videos/<slug>`. The
"self-contained, brief.md in, no vault" flow described in the debate prompt has not
been built. Everything below treats it as a proposal and says so.

## 1. HITL through a raw terminal is the load-bearing assumption, and it does not hold up

This is the biggest risk, ranked first on purpose.

`cooking.md` is not lightly interactive. Reading it closely, a single cook run can hit
all of these hard stops, in order: the reach-spec picker if more than one exists, the
mode picker (post vs video), on the video branch a HARD-STOP AskUserQuestion if
`video_kind` is missing or unknown, HITL #1 (storyboard and script approval, "no beats
until approved"), a Kokoro voice confirmation, a captions and BGM question, HITL #2
(the rendered Studio preview, where the founder is expected to open a *second,
separate* localhost dev server and can "edit timeline/voice himself"), and on the post
branch a requirements gate plus a final approve/revise gate. That is six to eight
points where the run is not computing, it is blocked on a human, some of them for as
long as it takes to actually watch a video preview.

`--dangerously-skip-permissions` bypasses tool-permission prompts. It does nothing to
AskUserQuestion, which is a genuine stop-and-wait for the user, not a permission check.
So every one of those gates will render inside the raw xterm pane exactly as Claude
Code's interactive prompt renders it, and the founder has to click into the terminal
and answer it with the keyboard. That is technically workable, xterm.js relays
keystrokes both ways, but the run-tracking design does not know this is happening.

The mockup defines five states: idle, running, success, failed, canceled. There is no
"waiting on you" state. A gate sitting untouched for ten minutes looks identical, in
the pill and in the elapsed timer, to ten minutes of an ffmpeg render actually running.
The mockup's own failed-state example ("no heartbeat for 6:00 ... timed out after
12:00") is a watchdog concept that will fire on a legitimate approval pause. HITL #2
alone, "Kai previews and can edit himself in Studio," cannot reliably finish inside a
12-minute budget once you add the time to notice the run needs attention.

Concrete failure: founder clicks Cook, the pill says "cooking," they tab away expecting
a Reel back in a few minutes the way the "2:14 elapsed" example implies. Cooking.md
immediately needs a `video_kind` answer or a mode pick. Nothing renders. At minute 12
the watchdog auto-fails the run with "no render produced." The founder never touched
the terminal and now reads that as a crash, when the actual event was a single
unanswered question at minute one.

Alternative: give the run tracker a real "needs input" state, sourced from watching the
terminal output for AskUserQuestion's own prompt framing (it has a recognizable
banner), and suspend the watchdog clock while in that state. Surface it as a distinct
pill color and put "answer in terminal" copy next to it, not a generic "cooking" label.
Without this, the run tracker is measuring wall-clock time, not progress, and will
punish the exact interaction pattern the command is built around.

## 2. The brief handoff does not exist, and cooking.md does not read a brief today

Verified by grep across `src/`, not inferred: there is no `brief.md` writer anywhere in
Crowsnest. `ws.ts` calls `mkdirSync(dir, { recursive: true })` on the sandbox directory
and immediately spawns the pty, no file goes in first. `cooking.md` step 1 reads
`Studio/workspace/reach/`. Nothing reads `brief.md`. There is no race condition to
worry about yet, because there is no write to race against.

So the flow as it ships today, if a founder actually presses Cook, is: an empty
directory, `/ksa:cooking` gets typed into the pty, step 1 finds nothing in
`Studio/workspace/reach/`, and the command's own instructions say "tell Kai to run
`/ksa:reach` first and stop." The cook does not proceed. This is a bigger gap than "the
brief needs a schema," the command has not been touched to look for a brief at all.

Even once someone does write `cooking.md` step 1 to read `brief.md`, the brief still
has to satisfy the command's own gates, not just supply prose. The video branch hard-
stops on `video_kind` specifically, and the good news is Crowsnest already has that
field (`plannedPosts.videoKind` in the schema, validated on create/update), so the
brief can carry it. But the mode picker (post vs video) and the routing table's
tiebreak logic are still live inside the command; a brief that supplies a plan but not
an explicit, already-decided mode will still stop and ask, because nothing in
`cooking.md` has been rewritten to treat a Crowsnest-authored brief as "already
answered." Writing the brief file is necessary but not sufficient; the command needs a
matching rewrite, which the big picture doc itself defers to E3.

## 3. Dropping `/ksa:reach` loses more than plumbing, and the project already knows it

The big picture doc's own section 02 flags this: the SHOCK and VO craft rules exist
because Kai rejected the same class of output twice, and dropping the vault files
without folding those rules into the cook command "loses the craft bar that fixed those
rejections." That is not a hypothetical, `cooking.md` says outright: "reading them is
not optional on the video branch" and to pass the paths, not paraphrase them from
memory.

The proposal's own timeline puts that fold-in at E3, after the harness hub (E1) and
run tracking (D1) ship. That means there is a real window, from whenever E1/D1 land
until E3 does, where cooks run without the two playbooks that fixed prior rejections.
That is a quality regression hiding behind a "not urgent, not a blocker" label in the
big picture doc, worth surfacing again here because a debate on flow is exactly where
"the flow works, the outputs got worse" belongs.

Separately: the reach spec also carries the format-default reasoning ("Reels out-reach
carousels roughly 13x, default is video until $200") as part of its own content, and
the mode picker in step 2 is written to defer to that spec. A Crowsnest brief that
supplies "chosen hook, chosen style, outline, script variants" per the debate prompt
sounds content-equivalent, but nobody has verified the command's routing logic (the
`video_kind` table, the tiebreak rule "built from a URL -> site-tour, otherwise
explainer") can actually consume that shape without a rewrite. That rewrite is E3.
Today it is unbuilt, tomorrow it is unverified.

## 4. Publish is one click after Cook, in the same session, and the only client-side gate is "a render exists"

`serve.md` does have its own hard approve/hold AskUserQuestion, which is the real
safety net, and that is worth crediting. But look at what sits in front of it:
`studio-panel.tsx`'s Publish button is `disabled={!render}`, nothing more. It does not
require the founder to have watched the video, does not require caption review inside
the Crowsnest UI (serve.md's own CTA keyword check only warns, it does not block), and
fires `/ksa:serve` into the exact same pty the cook just used. One click starts a
command that, once the operator answers "Publish" instead of "Hold," calls
`ig_publish.py` against a real Graph token and posts to Instagram. There is no
Crowsnest-side "are you sure" between the button and that terminal prompt, no preview
of the caption Crowsnest itself has stored, nothing that would stop a mis-click from
reaching the in-terminal gate.

There is also a session-lifetime problem specific to flow: `ws.ts`'s `close` handler
kills the pty. Publish has to happen before the tab closes or refreshes, in the same
sitting as Cook, because the render capture that flips `render` from null to a value
lives entirely in that websocket's React state. A founder who cooks now and wants to
review and publish tomorrow cannot do it from this screen; a fresh page load has no
render, no matter that the MP4 is sitting on disk and `serve.md` step 1 would happily
find it in a brand-new session.

Alternative: make publish a deliberate, separate action outside the cook run's
terminal, a review screen with the thumbnail and caption already pulled into
Crowsnest's own state (not dependent on a live pty), with its own server action that
shells to `ig_publish.py` directly. Keep serve.md's approve/hold gate as a second,
independent check if the terminal path stays, but do not make "the session happens to
still be alive" a precondition for publishing something that already rendered
successfully.

## 5. The "one run" boundary is a UI fiction; Stop and Retry both discard real work

A "run," in the tracker's model, is one opaque terminal stream with one elapsed timer
and one Stop button. Underneath, it is: a mode/kind decision, a storyboard and script
pass, two hard approval gates, TTS generation, N parallel per-beat sub-agent renders, a
lint-and-fix loop, snapshotting, and a final render. Stop kills the pty
(`session.kill()`). There is no checkpointing mentioned anywhere in `cooking.md`. Stop
mid-render throws away whatever the beat sub-agents had produced; Stop mid-gate throws
away a plan the founder was about to approve, one keystroke from done.

The mockup's own caption is explicit that this is intentional: "Retry cook ... always
starts a new run, never resumes the old one." Combined with the watchdog misfire risk
in section 1, that means the most likely way a run fails (a false timeout while waiting
on a legitimate approval) is also the run type with the most sunk cost to discard, an
already-approved storyboard and a generated voiceover, gone, full re-generation
required. That will train founders to avoid Stop and to babysit the terminal instead of
trusting the run tracker, which defeats the point of building run tracking in the first
place.

Alternative, scoped smaller than a full resume feature: at minimum, let a
Failed-by-timeout run distinguish "timed out waiting for you" from "timed out mid-
render," and for the former, keep the terminal session alive long enough for the
founder to just answer the gate late rather than forcing a full Retry.

## 6. Multi-post and batch are not designed for at all

The flow is one pty per `postId` (`ws://.../api/terminal/ws?post=${postId}`), spawning
a full `claude --dangerously-skip-permissions` process with the whole render pipeline
behind it, ffmpeg, HyperFrames' own `npm run dev` and `npm run render`, Kokoro TTS.
Nothing in `ws.ts` or `session.ts` caps concurrency or checks for an already-running
cook on the same or a different post. Three founders' worth of "make a video today"
means three tabs, three heavy local processes, competing for CPU on one machine.
HyperFrames' own preview dev server (`npm run dev`, the thing HITL #2 depends on) most
likely binds a default port; two concurrent cooks both hitting HITL #2 at once is a
believable EADDRINUSE or, worse, a founder reviewing the wrong post's preview at the
wrong URL. The `/runs` list shown in the mockup is a flat table with no concurrency
indicator and no queue. This was clearly scoped as single-post, tab-bound, and the
debate prompt's own framing ("how does making 3 videos in a day work") has no answer
in what is designed so far.

## Ranked summary

1. HITL-through-terminal has no "waiting on you" state and a watchdog that will
   misfire on legitimate approval gates. This is the one that makes "click Cook and
   walk away" false as currently designed.
2. The brief handoff is unbuilt: no writer exists, and `cooking.md` reads a reach spec,
   not a brief, today. Pressing Cook right now dead-ends at "run /ksa:reach first."
3. Dropping `/ksa:reach` drops the SHOCK/VO craft rules that fixed two prior
   rejections, and the project's own doc defers the fix to E3, after this ships.
4. Publish is one click and one session away from Cook, gated by nothing on the
   Crowsnest side beyond "a render exists," and cannot happen in a later session.
5. Stop and Retry both discard all in-progress work with no checkpointing, which
   punishes exactly the failure mode most likely to happen (a false timeout on a gate).
6. Multi-post has no concurrency model, no queue, and a believable local port
   collision the moment two cooks hit the Studio-preview gate at once.

## Biggest concern

The entire "click Cook, walk away" pitch rests on HITL working invisibly through a raw
xterm pane, and it does not. `cooking.md` has six to eight genuine human stops, the run
tracker has no state for "waiting on you," and the watchdog timeout as mocked up will
punish the normal case, not the broken one. Fix the state model and the watchdog before
building anything else in this list; everything downstream assumes a "the run is either
computing or done" model that the actual command does not have.

## Strongest endorsement

Keeping the raw xterm as the interaction surface, instead of trying to reimplement
AskUserQuestion and the sub-agent question-routing gate as custom Crowsnest UI, is the
right call. That reimplementation would be its own large project and would still lag
whatever Claude Code's interactive prompt does next. The run tracking wrapped around
it, durable `/runs` history, a watcher that reliably captures the finished render,
tab-per-post isolation, is a real improvement over today's zero-visibility state, and
none of the six issues above require throwing that part out. They require making the
tracker honest about what a "cook" run actually is.
