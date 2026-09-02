# Cook feature debate: usability

Lens: can the operator actually run this, recover from failure, and trust it, day to day. Sources: the create-run tracking mockup (`docs/design/mockups/create-run-tracking-preview.html`), the proposed harness architecture (`~/.agent/diagrams/crowsnest-cook-bigpicture.html`), and the real command that runs today (`Kai-Official-OS/.claude/commands/ksa/cooking.md`).

The core problem across every finding below: the mockup models a cook as a single continuous "cooking" phase with an elapsed timer and a Stop button. The real command is not that. It is a script with four to six human checkpoints (spec pick, mode pick, a hard-stop `video_kind` question if the spec omits it, HITL #1 plan review before any beats get built, a Kokoro voice confirmation plus captions and BGM questions, HITL #2 studio preview before the final render). Every finding below traces back to that mismatch.

## 1. A HITL wait looks identical to a render, so the watchdog can kill it (worst)

**The problem.** The Running panel shows one pill ("cooking"), one elapsed timer, and a terminal feed with phase lines like "phase: rendering scenes, 60%." There is no state for "waiting on you." But the underlying command spends real, sometimes long, wall time parked on `AskUserQuestion`: approve the storyboard before any beats build, confirm a voice, answer captions and BGM, approve the studio preview before the final render. None of that is rendering. All of it is the operator's attention, not the machine's.

**The moment it bites.** The proposed harness adds a watchdog: "no render after N min to failed." The Failed panel in the mockup literally reads "no heartbeat for 6:00... timed out after 12:00." If the operator steps away to answer a HITL #1 plan review (a real decision that deserves more than a glance) and takes fifteen minutes, the run does not distinguish "the operator is thinking" from "the process is stuck." It just times out. The operator comes back to a Failed run with an E-TIMEOUT and no memory of having done anything wrong, because they did not.

**The fix.** The status strip needs a third state between Running and Failed: something like "waiting on you," driven by whichever `AskUserQuestion` gate is currently open, and the watchdog heartbeat must reset (or pause entirely) while that state is active. Idle-on-a-gate should never count against the render budget.

## 2. Retry always starts from zero, so recovery is expensive

**The problem.** The mockup is explicit and honest about this: "Retry cook always starts a new run, never resumes." Good doc, bad economics. A failure late in the pipeline, say the final render step (`npm run render`) crashing after HITL #1 and HITL #2 already passed and a voice was already picked, throws away every answered gate. Retry means re-answering the mode picker, the voice confirmation, captions and BGM, and sitting through both HITL reviews again.

**The moment it bites.** The failure mode shown in the mockup is a render-stage timeout, exactly the case where the least should have been lost and the most is. An operator who has been burned by this once will start treating any failure past the halfway point as expensive, and will hesitate to hit Stop on a run that looks borderline rather than risk redoing forty minutes of gates for a five-minute fix.

**The fix.** At minimum, persist the answered gates (mode, `video_kind`, voice, captions/BGM, the approved storyboard) with the run record so Retry can resume after the last completed step instead of the first one. If that is out of scope for this layer, the UI should say so plainly next to the Retry button, not only in a design-doc caption the operator will never see once this ships.

## 3. Success enabling Publish is not the same as the operator having watched the video

**The problem.** HITL #2 approves a *studio preview* before the final render (`npm run render`). The final MP4 is captured automatically afterward by "Plan C watcher," with no further human gate. In the mockup, the Success panel's Output pane shows a placeholder box (a play icon and "0:32 - 9:16") and immediately enables Publish. There is no evidence the operator scrubbed the actual rendered file, only that they approved an earlier preview of the plan.

**The moment it bites.** Rendering can introduce defects the storyboard preview never had: audio sync drift, caption timing off by a beat, an ffmpeg artifact, a beat that renders differently than the dev-server preview. `/ksa:serve` publishes straight to a real Instagram account. A tired operator who trusts "Success = good" because the button says Publish and the run says done can put a broken or off-craft video in front of real followers.

**The fix.** Make the preview box an actual playable video, not a placeholder, and treat "the operator opened and played the final render" as a distinct, tracked precondition for enabling Publish, separate from "the render finished." A green pill should never be the only gate in front of a real publish.

## 4. The design demands babysitting while presenting itself as autonomous

**The problem.** A cook takes minutes and needs the operator present for multiple gates, but nothing in the studio or the run tracker tells the operator when they are actually needed versus when it is safe to walk away. The only way to know is to keep the tab open and watch the terminal scroll.

**The moment it bites.** This is a daily tool for a solo founder, not a demo. If every cook means parking in front of the tab for six to twelve minutes because you cannot tell a gate from a render, the operator will either multitask and get bitten by finding #1, or stop using the async parts of Crowsnest and just run `/ksa:cooking` by hand in a terminal where they already know how to watch for prompts.

**The fix.** Once finding #1's "waiting on you" state exists, wire a notification to it (browser notification, sound, or both) so the operator can genuinely leave the tab during the rendering stretches and only come back when summoned. That is what makes this actually different from babysitting a raw terminal.

## 5. No visible signal that the craft rules were actually applied

**The problem.** The SHOCK and VO playbooks exist because output got rejected twice; the command is explicit that skipping them is not optional. The architecture doc's own flag admits the plan is to fold them into the Crowsnest-owned command in E3, dropping the vault files. Nothing in the run tracker (studio strip, `/runs` list, or `/runs/[runId]` timeline) shows whether a given run actually pulled in those rules. The mockup's example timeline events are generic ("phase: scripting -> voiceover -> rendering") with no craft-compliance line.

**The moment it bites.** Once the rules move from external files the operator can independently check into an implicit part of a command they cannot easily diff, craft drift becomes invisible until the output looks wrong again, on a real published Reel. The exact failure this was built to prevent (a rejected-quality Reel making it to publish) becomes silent instead of loud.

**The fix.** Have HITL #1's plan-review gate emit a structured line ("hook follows SHOCK: cold-open, 0:00-0:03" / "VO cadence: flowing, per correction") that the run tracker captures and shows in the timeline. That gives the operator a cheap, per-run way to catch drift without re-reading the playbooks each time.

## 6. Retry cook means three different things depending on state, with one label

**The problem.** "Retry cook" appears on Success, Failed, and Canceled panels with identical copy and no distinguishing context in the actual rendered UI (the "never resumes the old one" clarification lives only in this design doc's caption text, not in the app). On a Failed or Canceled run, Retry obviously means "try again." On a Success run, it silently means "throw away nothing (the old file stays) but go build a competing new one," which is a different mental action.

**The moment it bites.** An operator with a good render who clicks Retry cook expecting a quick variation, then gets routed through the full mode picker and both HITL gates again, will wonder if they just broke something.

**The fix.** Split the label: "Retry cook" on Failed/Canceled, "Cook again" (or similar) on Success, each with one line of inline copy stating what happens to the existing render.

## 7. Scale and comparison are punted, reasonably, but worth flagging now

The `/runs` list reuses `listRuns()`, which is the right move for durability. But at six rows there's no pagination, filtering, or thumbnail shown, and no way to compare a cook against its own past attempts on the same brief (useful given Retry always forks a new run). This is explicitly Layer 1 scope and the doc says so, but a daily-cadence tool will have thirty-plus create runs within a month, and "durable record" only pays off if it stays findable at that volume.

---

## Biggest concern

Finding #1. A watchdog that cannot tell "the operator is thinking about a real decision" from "the process hung" will produce false failures on the exact runs that went furthest and got the most human attention. That is the fastest way to make a founder stop trusting the tool: not a bug that is obviously a bug, but a status that says Failed when nothing actually failed. Lose that trust once and the operator goes back to running the raw command by hand, which defeats the entire point of tracking the run.

## Strongest endorsement

The move from "the only signal is the finished file" to a durable run record with a timeline, elapsed time, and a `view run` link is a real fix for a real gap, and the copy is honest about it: it does not pretend Retry resumes a run it does not, and Layer 1 openly marks the progress bar and transcript as later, unshipped variants instead of half-building them. That restraint is worth keeping as the feature grows past this layer.
