---
description: KSA Cooking - turn a Crowsnest remix brief into a real publishable asset. Post mode = carousel (baoyu). Video mode = 9:16 Reel via the real HyperFrames workflow (router -> faceless-explainer, Kokoro VO, parallel beats, Studio). Renders via a named sub-agent.
argument-hint: "[optional brief filename]"
allowed-tools: Skill, AskUserQuestion, Task, Bash, Read, Write, Edit, Glob, Grep
---

# /ksa:cooking

Turn a remix brief into a rendered asset. Cadence: per piece, after the Crowsnest studio writes the brief.
HITL mandatory. All prompts use AskUserQuestion. Multi-agent question gate: sub-agents route every question/gate/blocker back to this lead; nothing proceeds until answered.

This command runs from the Crowsnest ksa plugin. Its cwd is the per-post sandbox
(`data/workspace/videos/<slug>`). The finished renders sit next to it at
`data/workspace/renders/<date>-<slug>/`, which is `../../renders/<date>-<slug>/` from
the sandbox. The editable project (the `hyperframes init` project and its `index.html`)
stays in the sandbox cwd itself, which is `.`.

Post reference: `${CLAUDE_PLUGIN_ROOT}/commands/cooking/baoyu-skill-selection.md`.

## Craft laws - READ BEFORE BUILDING, and put them in every render sub-agent brief

These laws were distilled after Kai rejected the same class of output twice: decorative
motion that does not read as real, and VO that sounds like an AI reader. They exist so the
next run does not have to earn the same rejection again. On the video branch, following them
is not optional.

The full rules are folded inline below - the SHOCK laws (what makes the motion land) and the
VO cadence laws (how the voiceover has to be written). Do NOT paraphrase them into a brief from
memory and do NOT point a sub-agent at any external file. The laws are inline in this command;
put them, verbatim in intent, in every render sub-agent brief and require the sub-agent to
follow them directly - the hook and the first 3 seconds above all.

### SHOCK laws (visual / motion) - what makes a HyperFrames video feel "how did they make that"

Distilled from the HyperFrames launch films. Every rule names the move, says what it does, and
gives the concrete build (the exact transform / easing / keyframe / data-attr / SFX). Keep the
numbers and the easing names; they are the craft.

**0. The one meta-principle: DEMONSTRATE, never assert.** Earn the "wow" by showing the beautiful
thing MOVING first, then naming it. Never open on a claim or a bullet. The shock is the gap between
"a studio made this" and "it is just code / four commands." This sits above every technique below -
a move applied to a text-card-first hook is wasted. The VO can play OVER a motion-graphics montage
with the product named after; the film can demo the thing it sells by being the thing it sells.

**1. Kinetic typography (word slams, big-word energy).**
- 1a. Per-word slide-from-right on VO onsets: each word flies in on the exact beat it is spoken so
  the line assembles in rhythm, not as a faded block. `WORD_STARTS` hand-tuned to the VO (for
  example `[0.09, 0.42, 0.55, 0.85, 1.09, 1.40, 1.64]`); `WORD_SLIDES` a DECREASING offset per word
  (for example `[360, 180, 120, 80, 50, 30, 20]`) so early words travel far and later words barely
  move - that ramp is what makes it feel choreographed. Per word: `gsap.set(el,{x:slide,y:14,opacity:0})`
  then `tl.to(el,{x:0,y:0,opacity:1,duration:0.33,ease:"expo.out"}, WORD_STARTS[i])`.
- 1b. Big-word single-token slam with typing + caret: one giant word owns the frame, swaps to the
  next, blinking caret, hard whip-out. Reveal by animating CSS `width` from `0ch` with `ease:"steps(N)"`
  (typewriter, not fade): `tl.to(".design-word",{width:"6ch",duration:0.27,ease:"steps(6)"},0.7)`.
  Caret is a solid block (for example `8px x 116px`); blink is a scripted array of opacity dips
  (deterministic, render-safe, never a CSS `animation`). Font JetBrains Mono, `font-weight:900`,
  large `font-size` (for example 122px). Hard exit: whole stage `x:-1920, duration:0.18, ease:"power4.in"`.
- 1c. Scale-contrast stacked headline: a 3-line hook where each line is a wildly different size
  (for example `l1 220px`, `l2 480px`, `l3 280px`), `font-weight:900`, `letter-spacing:-0.045em`,
  `line-height:0.88`. The middle word more than 2x its neighbors - the size jump IS the emphasis.
- 1d. Big-word slam-swap (exit left / enter right): one phrase whips off left as the next enters from
  right, ~0.2s overlap so it reads as one shove. Exit `x:-2400, filter:"blur(6px)", ease:"power3.in"`;
  enter `fromTo({x:2000,opacity:0,blur6},{x:0,opacity:1,blur0,ease:"expo.out"})`. Blur on both sides
  sells speed.
- Reusable type spec across all of them: weight 900, negative tracking (-0.025em to -0.045em),
  line-height < 1 (0.78-0.9), one word bigger or in the accent color.

**2. Terminal / IDE prompt-typing morph (the signature move).** An editor types a natural-language
prompt character by character, then the box "sends" and morphs / executes into the reveal. This is the
core "an agent made this" beat. Two seek-safe typing methods that survive the deterministic render (a
naive JS loop would not):
1. clipPath wipe with steps ease (preferred, GPU-cheap): set text full, `gsap.set(el,{clipPath:"inset(0 100% 0 0)"})`,
   reveal with `tl.to(el,{clipPath:"inset(0 0% 0 0)", duration:0.9, ease:"steps("+text.length+")"})`.
   `steps(N)` where N = character count = one glyph per step = true typewriter.
2. textContent slice via a tweened counter: `tl.to(obj,{n:PROMPT.length, ease:"none", onUpdate(){ typed.textContent = PROMPT.slice(0, Math.round(obj.n)); }})`.
   Use when you need real text wrapping.
The MORPH: a CTA bar tweens `height` and `width` with `ease:"power3.inOut"` into a terminal, and the
term content fades up ~0.2s later. Send grammar: typed text flies `y:-40, opacity:0`; input area pulses
an inset box-shadow; send button punches `scale:1.2 -> 1.0`; a click ripple expands `scale:0 -> 2.0,
opacity:0.45 -> 0`; the sent message drops in as a chat bubble with `back.out(1.4)`. Deterministic caret
blink (never CSS `animation`): scripted opacity flips, for example
`tl.to(caret,{opacity:0,duration:0.5,ease:"steps(1)",repeat:9,yoyo:true}, start)`. The morph also works
window-scale: a parameterized `onUpdate` interpolates scale + width + left + bottom together so the
composer settles into its docked position WHILE the window shrinks from full-bleed to a floating card.
Parameterize VISUAL width (`width x scale`) so it interpolates monotonically and does not overshoot the
window edge mid-morph.

**3. Transition grammar (the jolts between beats).** Each is a named, reusable seam:
- Charge then scatter (whoosh): pre-impact micro-shake `x:"+=3", yoyo:true, repeat:5, duration:0.045,
  ease:"none"`, then panels fly to the 4 corners `scale:0.52, duration:0.20, ease:"power3.out"` and settle
  with `elastic.out(1,0.7)`. The shake before the release is what makes the whoosh hit.
- Center mask-open (window materialize): dark window scales up from a point, `scale:0.04 -> 1,
  opacity:0 -> 1, ease:"expo.out", ~0.6s`. Use to enter a terminal.
- Zoom-through / window recede (out): `scale:1 -> 0.82, filter:blur(0 -> 14px), fade, ease:"power3.in",
  ~0.32s`; the lower-z layer already at its `data-start` is revealed underneath. Optional `scale:1.04 -> 1`
  settle on the incoming layer.
- EXPLODE-out: `scale:1.55, filter:blur(18px), opacity:0, ease:"power2.in", 0.34s`. Aggressive
  push-through between hard beats.
- Cut-the-curve MATCH-CUT (the invisible seam): the outgoing comp rushes UP in its last ~0.45s
  `y:-280, filter:blur(10px), ease:"power3.in"`; the incoming comp ENTERS from `y:+280, filter:blur(10px)`
  and decelerates `ease:"expo.out"`. Matched blur + opposite Y offset + matched velocity across the comp
  boundary = the eye reads two separate compositions as one continuous upward camera move. This is how you
  hide a cut.
- Zoom-through exit on the whole comp root: `tl.to(root,{scale:1.15, opacity:0, filter:blur(4px),
  ease:"power2.in", 0.6s}, TRANS_START)` where `TRANS_START` == the NEXT comp's `data-start`. The two
  overlap for a real dissolve-through.
- Hard whip (light-streak feel): the big-word stage exit `x:-1920, ease:"power4.in", 0.18s`, or the
  slam-swap in 1d. Add a `filter:blur()` on the moving layer for the streak.
- Universal rule: put a `filter:blur()` on anything moving fast, and match the velocity (ease + offset) on
  both sides of a cut. Keep a shared ground color (cream `#F0EEE6`) behind every section so exposed edges
  never flash black.

**4. Beat-synced SFX on non-ducked tracks + music-drop choreography.** Sound is authored as discrete clips
pinned to exact frames on their OWN tracks, so hits punch through instead of being ducked into the music.
Every sound is an `<audio class="clip">` with `data-start` (exact onset), `data-duration`, a UNIQUE high
`data-track-index`, and `data-volume`:
- Music: one track, `data-volume="0.11"` - it sits far under everything (ducked by being quiet, not by
  sidechain).
- Keystroke ticks: one instance per typing burst, `data-volume` ~0.40.
- Clicks: one instance per cursor tap, `data-volume` ~0.55.
- THE DROP: the bass-drop clip fired ON the reveal beat, its OWN track so nothing ducks it, `data-volume` ~0.55.
- VO: each spoken line its own clip at `data-volume="1.0"` on its own track.
Because each SFX and the drop are on separate tracks from the music they are never sidechained down - they
land on top at full transient. Authoring workflow: build the film SILENT, then lay sound in post against an
audio cue map (film time -> cue -> source). Silence is a tool; do not fill every second - a deliberate stretch
of silence up front makes the first sound hit harder. Music-drop choreography: place the biggest visual event
(scatter, reveal, logo lockup) exactly ON the drop. Align the payoff frame to the beat, not near it.

**5. Easing / curve discipline.** A small, deliberate vocabulary; match the curve to the intent:
- `expo.out` - entrances and word slams (instant speed, hard decel). The default "arrive" curve.
- `power3.out` / `power2.out` - cursor moves, UI element entrances.
- `power2.in` / `power3.in` / `power4.in` - exits, whip-outs, zoom-throughs (accelerate away).
- `back.out(1.8)` to `back.out(2.5)` - pops / sticker payoffs (overshoot then settle).
- `elastic.out(1,0.4)` / `elastic.out(1,0.7)` - a settle bounce on a landed object.
- `steps(N)` - typewriter reveals and deterministic caret blink.
- A custom velocity-matched quadratic for depth pulls (for example `entryEase = t => -0.806*t*t + 1.806*t`),
  hand-derived so the entry tween's END velocity equals the following linear hold's velocity - no stall between
  "push in" and "slow drift."
- Render-safety: exits are FRAME-ALIGNED (compute the tween to complete on the last rendered frame before a cut,
  because steep `expo.in` tails sample badly). NEVER rely on CSS `@keyframes animation` for anything that must
  appear in the render; script it on the GSAP timeline via `data-*` and `onUpdate`.

**6. Layout + type systems (scale, weight, single hot accent).**
- Weight: display type 900; supporting 700-800; UI/mono 400-500.
- Tracking: negative on display (-0.025em to -0.045em); line-height < 1.
- ONE rationed accent per film, used sparingly (for example clay `#D97757`, fire/amber `#c86d3f`, cyan
  `#00C3FF`). Everything else is ink on cream or white on dark. The accent marks exactly one hot word / one
  CTA / one caret.
- Font pairing: a heavy grotesk (Inter 900, Hanken Grotesk, Big Shoulders Display) for display + a mono
  (JetBrains Mono, Spline Sans Mono) for terminal + occasionally ONE serif italic for a single emphasis word
  (Instrument Serif, DM Serif Display italic). The serif-italic-single-word is a recurring premium tell.
- Grounds: cream `#F0EEE6` / `#F5F4ED` OR near-black terminal `#1C1C1C` / `#1a1b1f`. Add a grain overlay
  (tiny radial-gradient dots) and a radial vignette for depth.

**7. Color / contrast + chromatic depth.**
- High-contrast base (cream vs ink, or dark window vs cream ground) keeps type readable at 1s.
- Chromatic-aberration text-shadow for a neon / premium glow: a cyan shadow offset LEFT plus a magenta shadow
  offset RIGHT plus a soft black drop, for example
  `-5px 0 18px rgba(73,242,255,.38), 5px 0 18px rgba(255,79,216,.28), 0 24px 80px rgba(0,0,0,.58)`. Cheap, and
  it reads as expensive.
- Gradient-fill text for a shimmering hot word: `background:linear-gradient(...); -webkit-background-clip:text;
  -webkit-text-fill-color:transparent; background-size:300% 100%` then animate `background-position`.

**8. Camera / parallax / depth moves.**
- Z-push as scale + blur (dolly): a continuous slow pull `scale:0.88 -> 0.80` with a `blur(0 -> 2px)` ramp
  during a hold, so the shot breathes like a camera drifting back rather than a frozen card.
- transform-origin anchoring: set `transform-origin` to the CANVAS center (not the element's own center) so a
  scaling child shrinks in lockstep with its parent instead of drifting. This precision is why the depth moves
  look locked.
- Zoom-through entry: incoming layer starts `scale:1.45, blur(14px), opacity:0` and resolves to `scale:1,
  blur:0` - you fly INTO the next scene through a blurred pane.
- Cursor as camera actor: fake macOS pointer choreography - move `power3.out`; click compress `scale:0.82,
  duration:0.07, ease:"power4.in"`; release `back.out(3)` or `elastic.out`; a click ripple; then the UI reacts.
  This sells "a human / agent is driving," which is core to the pitch.

**9. Clip choreography + timing rhythm.**
- Real video clips are gated by `class="clip"` + `data-start` / `data-duration` / `data-media-start` (trim
  into the source). Poster + last-frame still images bridge the gaps so a clip that has not started / has ended
  never flashes black.
- Composite a foreground element over a dark plate with `mix-blend-mode:lighten` - the dark box vanishes into
  the dark window, only the bright subject survives.
- Layered onset pop: elements enter on their own beats with a small `y` rise + `back.out` so each addition has
  its own "tick."

**10. Act structure / pacing patterns.**
- Problem -> escalation -> relief (3-act): Act 1 plant the pain as a playable gag, Act 2 escalate it, Act 3
  reveal the product as the obvious fix + a relief beat. The product is the punchline.
- Accelerating montage for escalation: fire many beats at RAMPING cadence - for example phase 1 `0.42s` per beat
  (legible), phase 2 `0.17s`, phase 3 `0.07s` (blur zone), with `filter:blur()` ramping up and a camera shake at
  the peak, then a punchline. Acceleration = rising tension without narration.
- Contrast as the engine: silence then sound; boring then alive; pain then fix. Build every film on one
  before/after gap.
- Hold beats for reading: after a fast sequence add a `+0.5s` static hold so the eye can catch the payoff.
  Fast is not uniformly fast - it is fast then a beat.

**SHOCK quick-pull menu (grab a move by name):**

| Want | Move |
|---|---|
| Words hit on the beat | Per-word slide-from-right, decreasing offsets, expo.out on VO onsets |
| One giant word owns the frame | width `steps(N)` typing + block caret + whip-out |
| "An agent typed this" | clipPath `steps(len)` prompt typing + box morph + send |
| Hide a cut | Cut-the-curve match: out `y:-280 blur10 power3.in` / in `y:+280 blur10 expo.out` |
| Hard punch-through | EXPLODE-out `scale1.55 blur18 opacity0 power2.in 0.34s` |
| Terminal appears | Center mask-open `scale0.04->1 opacity0->1 expo.out 0.6s` |
| Whoosh | Charge `x+=3 yoyo x5 @0.045` then scatter `power3.out` + `elastic.out` settle |
| The drop lands | Bass-drop own track, `data-start` == reveal frame, vol 0.55 |
| SFX that punch | Each SFX its own `<audio class=clip>` + unique high `data-track-index`, music at vol 0.11 |
| Camera drift | `scale 0.88->0.80` + `blur 0->2px` hold, velocity-matched entryEase |
| Premium glow | Chromatic text-shadow (cyan left + magenta right + black drop) |
| Cursor drives it | move power3.out -> compress 0.82 power4.in -> release back.out(3) -> ripple |

### VO cadence laws - how to write short-form voiceover that sounds like a real creator, not an AI reader

The tell is never the synth engine - it is the WRITING. Even lines are AI. Long inter-sentence silence is AI.
Wind-up is AI. Uniform pace is AI. Write for the ear: fast, uneven, punchy, no dead air, momentum from the first
syllable.

**0. The one meta-principle: WRITE FOR THE EAR, NOT THE PAGE.** A viewer hears the line once, at speed, while
scrolling. They cannot re-read, so the line has to land on first hearing. If a sentence only works when you can
see it on a page (subordinate clauses, parentheticals, "which," "in order to," balanced grammar), it is written
wrong for VO. Say it out loud; if you stumble or run out of breath, the viewer will too. The rule in five words:
"Always feels like a person, never like a reader."

**0.5. CADENCE CORRECTION - FLOW, don't chop. THIS SUPERSEDES ANY FRAGMENT-FIRST ADVICE.** The first cut of this
playbook leaned fragment-first (short sentences + a beat of silence between each). Kai tested it in a real reel
and rejected it as choppy and robotic. The fix is the OPPOSITE, and it OVERRIDES the fragment rules below:
- A whole sentence is delivered as ONE unbroken flow. No stop, no micro-pause WITHIN a sentence. The words run
  together the way real speech does.
- Pause only BETWEEN sentences, and keep that gap SHORT. The break lives at the sentence boundary, never
  mid-sentence.
- Medium to medium-long sentences, not fragments. Info-dense, connected by "and / so / but / instead" that carry
  the thought straight through without a stopping point. Vibe example: "here's the thing, right now you can do
  everything with Claude Code: create videos, create docs, all of it." One flowing, continuous, info-packed line.
- Faster overall. Push the pace up; a flowing line carries more words per second than a choppy one because there
  is no dead air between pieces.
- ONE short hook, then flow. Only the very first line is short + fast + high-extraction. Everything after it flows
  as medium sentences.
- Fragments (a bare "Nope." / "Gone.") are now the EXCEPTION, used at most once for a deliberate pattern
  interrupt, never the default. When in doubt, JOIN two short sentences into one flowing line with a connector.

**1. Sentence length + rhythm - flowing, medium, continuous.**
- Medium is the default: ~10 to 20 words per sentence, one connected thought, delivered unbroken. Use "and / so /
  but / instead / then" to weld ideas into one flowing line rather than splitting them into stubs.
- VARY the length - still the anti-AI move. AI writes sentences of the same length so the cadence flatlines. Mix
  medium and medium-long lines; open with the one short hook. You are varying medium vs long now, not fragment vs
  fragment.
- Only the hook is short: the first line is fast and high-extraction; after that, flow.
- End on the strong word: put the payload word last so the beat lands on it.

**2. Pace / words-per-second - real creators talk FAST.**
- Target 3.0 to 3.5 words per second (roughly 180-210 wpm) - noticeably faster than professional narration
  (~2.3 wps / 140 wpm), which is exactly why narration sounds like an ad and creators sound alive.
- Front of the reel is fastest: the hook and the first 3 seconds are the densest, quickest delivery in the whole
  piece. Slow down only to LAND a payoff.
- Pace is a curve, not a constant: fast through setup, micro-brake on the money word, then fast again. A flat fast
  read is as robotic as a flat slow one.
- Budgeting: at 3.2 wps, a 7-second beat holds about 22 words, max. If a line is longer it rushes ugly or forces
  the pace into ad-read territory. Cut words until it fits with breathing room; do not slow the read to fit the
  words.

**3. Kill dead air - the biggest AI tell.** Long equal gaps between sentences is the #1 reason a reel VO sounds
generated, and a pause INSIDE a sentence is worse. TTS defaults to a fat pause at every period and often every
comma.
- Never stop mid-sentence. The words inside one sentence run together as a single breath. If the engine inserts a
  pause at an internal comma, remove the comma or splice the clip tight.
- Tighten inter-sentence gaps to 0.1 - 0.25s for momentum runs. The next line should feel like it is already
  coming.
- Reserve the big pause (0.4 - 0.8s) for exactly one or two spots: right before a reveal, or right after the
  punchline lands. A pause is punctuation you spend, not a default you leak.
- Use connectors to erase gaps entirely: starting a sentence with "but," "so," "because," "and that's why" chains
  it to the last one so momentum carries through.
- TTS note: if the engine inserts long stops at periods, replace some periods with commas in the input text, or
  splice the clips tighter in post. Comma-chaining reads faster than three separate sentences.

**4. Momentum connectors - the "but / so / because" engine.** Retention is momentum; every sentence should tug the
viewer into the next.
- "but" - reverses, creates a tiny open loop.
- "so" - cause to effect, feels inevitable.
- "because" - promises a reason, the ear waits for it.
- "and that's the thing / here's the part / which means" - hands off to the next beat.
Do NOT open a reel with a windup connector, but DO use them to weld the middle together.

**5. Retention techniques - front-load, open loops, pattern interrupts.**
- No wind-up. Ever. Cut "So today I want to talk about," "Have you ever wondered," "In this video." The first
  spoken word must be substance. If you can delete the first sentence and the reel is stronger, it was wind-up.
- Front-load the hook: the most provocative / concrete claim goes in second one, not built up to.
- Open a loop, close it late: imply a question the viewer needs answered, then delay the answer. The gap is the
  retention.
- Pattern interrupts (sparingly): break the rhythm so the ear re-engages - one deliberate short line after several
  flowing ones, a hard "No.", a question after statements.
- Rhetorical questions pull the viewer into answering in their head. One or two per reel, not more.
- Specific beats vague: concrete nouns (invoice, empty calendar, four commands) out-retain abstractions. A real
  number is better than "a fortune" IF it is true. NEVER fabricate a number for punch.

**6. Spoken vs written - the conversion checklist.** Run every line through this before it goes to VO:
- Contractions, always: "it's / you're / don't / that's / here's / nobody's." This one swap fixes half of
  AI-voice.
- Active voice, subject first: "The kit rendered it," not "it was rendered by the kit."
- Second person, direct: talk to one viewer as "you."
- Cut hedges: "kind of, basically, really, just, actually, pretty much, I think." Spoken, they sound unsure.
- Cut adjectives that don't earn: "gorgeous, amazing, incredible, revolutionary." Let the render carry the awe;
  the VO stays flat and factual on top - the contrast is the flex.
- Concrete verbs over noun phrases: "renders, ships, posts, made" over "handles the rendering process."
- Say numbers the spoken way: "$99" -> "ninety-nine"; "$149" -> "one forty-nine"; "20 seats" -> "twenty seats."
  Write the spelled form in the VO input, keep the numeral on-screen.
- Read it out loud, timed. If you run out of breath it is too long; if you sound like you are presenting it is too
  written; if you would never text a friend that sentence, rewrite it.

**7. Delivery direction (for the TTS input or voice actor).** Per line, mark: pace (fast / brake here); the ONE hot
word that gets the stress (match it to the visual accent - everything else stays flat so the hot word pops); the
gap after (tight ~0.1s run-on, or held ~0.5s - default tight, hold only before a reveal or after a punchline);
register (curious rising / confident dropping / deadpan / warm). Different register per act = a person reacting to
their own content, not a reader holding one tone for 35 seconds.

**8. VO quick-pull menu:**

| Want | Move |
|---|---|
| Scroll-stop in 1s | Front-load the hook, no wind-up, densest+fastest read of the whole reel |
| Not sound like AI | Flowing medium sentences delivered unbroken, contractions everywhere, no mid-sentence stops, only short gaps |
| Kill dead air | No pause inside a sentence; inter-sentence gap 0.1-0.25s; connector-chain the next line |
| Momentum through the middle | Weld ideas into one flowing line with and / so / but / instead |
| Retention hold | Open a loop early, close it late; pause only right before the reveal |
| Re-engage a drifting eye | Pattern interrupt (sparingly): one deliberate short line after several flowing ones |
| Land a payoff | Brake the pace on the last word, put the payload word last, then hold 0.5s |
| Real-creator numbers | Spell them for the voice ("ninety-nine"), keep the numeral on-screen, never fake one |
| The no-slop flex | VO stays flat + factual over a gorgeous visual; the render carries the awe |

**9. The anti-AI test (paste this over any VO draft):**
1. Do all my sentences have the same length? -> vary them.
2. Any sentence that stops or pauses in the MIDDLE? -> deliver it as one unbroken flow; only break between
   sentences. Do NOT chop a medium sentence into fragments - join stubs with and/so/but instead.
3. Any "it is / you are / do not"? -> contract them.
4. Any wind-up before the first real word? -> delete it.
5. Same fat pause at every period? -> tighten to 0.15s, keep one big pause for the reveal.
6. Any hype adjective doing the work the visual should do? -> cut it.
7. Would I text this sentence to a friend? -> if no, rewrite until yes.
8. Timed out loud, does each beat fit its seconds with breath to spare? -> if not, cut words, don't slow down.

## Format default: Reels

Reels out-reach carousels roughly 13x on this account, measured 2026-07-23 (123.5 vs 9.7 mean reach; 2 of 9
posts produced 78 percent of all lifetime reach). The default mode is `video` until the account clears $200 in
reach value. If the mode picker in step 2 is about to select `post`, say so and confirm there is a specific
reason for a carousel.

## Steps

1. **Read the brief.** Read `./brief.md` in the sandbox - the Crowsnest studio wrote it there. If `$ARGUMENTS`
   names a file, use it; otherwise use `./brief.md`. The brief is always present, so there is no reach fallback.
   `brief.md` holds the full remix output: source outlier, hook, style, outline, the full Script body, target
   length, video kind, and frame-pass layout.

2. **Mode picker.** AskUserQuestion: `post` (carousel) or `video` (9:16 Reel). Match the brief (daily-video ->
   video; post/carousel -> post), let Kai confirm.

---

## POST branch (carousel)

3p. **Requirements gate (MANDATORY, AskUserQuestion):** style (vibe), layout (card/deck/single), aspect ratio (IG crops slides to the first).
4p. **Pick the baoyu skill/combo** via `${CLAUDE_PLUGIN_ROOT}/commands/cooking/baoyu-skill-selection.md` + gate answers; confirm the pick to Kai.
5p. **Render via a named sub-agent in a pane.** Brief it with the brief's per-slide sections, gate answers, chosen skill, output folder, and the craft laws inline above. Same aspect on every slide; on-niche; no slop; no fabrication.
6p. **Output** `slide1.jpg`..`slideN.jpg` + `caption.txt` (from the brief's caption) to `../../renders/YYYY-MM-DD-<slug>/`.
7p. **HITL gate.** AskUserQuestion "Approve this carousel?" Approve / Revise.
8p. **Log** + index.
9p. **Handoff.** Ready for `/ksa:serve`.

---

## VIDEO branch (9:16 Reel) - real HyperFrames workflow

Do NOT hand-roll a motion-graphic and do NOT run a duplicate requirements gate - the HyperFrames workflow owns the build and asks its own brief. The steps below (3v-8v) ARE the workflow; run them in order, hold the two HITL gates, and let the workflow own everything between them.

3v. **Route to the workflow via the video-kind table (deterministic - no judgment, no per-run drift).** Read the video kind from `brief.md` and look it up in the table below. This IS the routing - do NOT "read the router and decide." Run `npx hyperframes skills update` first (works offline) for freshness only: it refreshes the installed workflows, it does not make the decision.

   | video kind | HyperFrames workflow | When (mutually exclusive) |
   |---|---|---|
   | `explainer` | `faceless-explainer` | topic / stance / listicle / build-in-public / concept / how-to. No site, no footage; visuals invented per scene. DEFAULT. |
   | `site-tour` | `website-to-video` | built FROM a real website or app URL (screens captured or recreated). |
   | `product-promo` | `product-launch-video` | launch / feature announcement / product promo hype cut. |
   | `music-video` | `music-to-video` | driven by a music track; audio-reactive visuals. |
   | `pr-announcement` | `pr-to-video` | from a PR / release notes / changelog. |
   | `talking-head` | `talking-head-recut` | recut of existing on-camera footage of Kai. |
   | `slideshow` | `slideshow` | image / slide-deck sequence to video. |
   | `general` | `general-video` | none of the above fit - used ONLY when the brief explicitly sets it. |

   **Tiebreak (deterministic):** built from a URL -> `site-tour`; otherwise an invented-visual reel is `explainer`, even if it sells a product.

   **Missing or unknown video kind:** HARD-STOP. Do not guess, do not silently default. Ask Kai via AskUserQuestion to pick one of the eight, then proceed. This is the ONLY cook-time workflow question; when the video kind is valid there is no pick - the table decides.

   Then dispatch a named render sub-agent in a pane. Give it: the brief, the table-mapped workflow, the real assets it references, a style reference if one exists, and **the craft laws folded into this command (the SHOCK laws and the VO cadence laws above), with an instruction to follow them directly before writing the storyboard or the VO script.** Scope/format (aspect 9:16, length) comes from the brief; only ask Kai if the brief omits it.
4v. **Run the workflow** (the workflow owns these; the sub-agent drives it):
   - Brand tokens come from the brief if it names them, otherwise the sub-agent chooses them per-video (the SHOCK laws set the type / color / accent discipline); **follow the SHOCK laws and the VO cadence laws inline above**; write `STORYBOARD.md` + `SCRIPT.md` against them.
   - **HITL #1 - plan review:** route the storyboard + script to the lead for Kai to approve BEFORE building. No beats until approved. State explicitly which craft-law rules the hook and the VO cadence follow, so a rejection lands on the plan rather than on a rendered video.
   - Kokoro TTS: test voice(s), Kai confirms one (`am_michael` default, or his clone). Generate narration, transcribe to word-level `transcript.json`, map beats to word onsets. Ask captions + BGM.
   - `hyperframes init` the project in the sandbox cwd (`.`); write the `index.html` orchestrator there.
   - Build beats with one sub-agent per beat (parallel) -> `compositions/beat-N.html`; build `captions.html`.
   - Read-gate beats; `npm run check` (lint + WCAG contrast); fix; re-check to pass; snapshot frames.
5v. **HITL #2 - Studio preview.** `npm run dev` (run_in_background, long-running) -> route the localhost URL to the lead; Kai previews and can edit timeline/voice himself in Studio.
6v. **Render on approval.** `npm run render` -> MP4. Copy final `video.mp4` + `cover.jpg` to `../../renders/YYYY-MM-DD-<slug>/`; keep the editable project in the sandbox cwd (`.`).
7v. **Log** + index.
8v. **Handoff.** Ready for `/ksa:serve`.

Rules for the video sub-agent: route every gate/question/blocker to the lead; never go idle mid-job; no fabricated output; deterministic compositions only (no Date.now/Math.random/network).
