# Cook harness, red-team pass

Lens: the harness only, meaning how the embedded Claude Code session gets spawned, hosted,
and torn down. Not the brief format, not the run-tracking UI, not the vault split.
Sources: `crowsnest-cook-bigpicture.html`, `create-run-tracking-preview.html`,
`src/server/terminal/session.ts`, `ws.ts`, `render-watch.ts`,
`Kai-Official-OS/.claude/commands/ksa/cooking.md`.

Findings are ranked most serious first. Each has: the risk, a concrete failure, and
a specific alternative.

## 1. A multi-minute unattended job is bound to a browser tab's socket

`ws.ts` wires `ws.on("close")` and `ws.on("error")` straight to `session?.kill()`.
There is no detach, no reconnect, no path for a job to survive the viewer closing.
A cook per `cooking.md` is not quick: HITL #1 (plan review), Kokoro TTS, per-beat
sub-agents, `npm run check`, HITL #2 (Studio preview), then `npm run render`. The
run-tracking mockup itself shows elapsed times of 6:41 and 12:00.

**Failure scenario:** you press Cook, the render clears HITL #1, and your laptop
sleeps five minutes in (or Wi-Fi drops, or you close the tab to check something
else). The socket errors or closes, `session.kill()` fires, and the whole render
dies: kokoro mid-generation, ffmpeg mid-encode, nothing recoverable. The
run-tracking design adds a status pill and a `/runs/[runId]` page, but nothing in
the shipped code changes the fact that the process backing that run has the
lifetime of a socket, not the lifetime of a job.

**This is the one thing I would block on.** A render job should outlive the tab that
started it. Concretely: spawn the `claude` process detached from the WS connection
entirely (for example `child_process.spawn(..., { detached: true })` under a
supervisor, or shell out through `tmux`/`screen` the way the existing "parallel
agents in cmux panes" pattern already does elsewhere in this stack). The WS becomes
a viewer that attaches to a running job's output stream. Reconnecting re-attaches,
it does not restart. Persist a PID (or session id) per run row so a server restart
can at least detect that a run's process is gone instead of silently losing track
of it.

## 2. The run-state model has no room for the HITL gates the command actually blocks on

`cooking.md`'s video branch has two mandatory `AskUserQuestion` gates: approve the
storyboard and script before any beat gets built, and preview in a spawned
`npm run dev` before the final render. Those are not edge cases; they are steps 4v
and 5v of the documented happy path.

The run-tracking mockup's state machine is `idle / running / success / failed /
canceled`, five states, no "waiting on you." A cook that is paused on HITL #1 looks
identical, from the run-tracking pill's perspective, to a cook that is three
minutes into rendering beat 4. The elapsed-time-only signal ("2:14", "12:00 to
timeout") is actively misleading here: a render that is genuinely idle waiting for
a human approval will eventually get killed by the watchdog for looking exactly
like a hung one, which is the wrong failure mode for a design gate.

**Alternative:** the harness needs to know the difference between "no heartbeat
because it is stuck" and "no heartbeat because it is waiting on you," and the run
model needs a `blocked_on_input` state distinct from `running`. That is a harness
concern, not just a UI concern: whatever signal drives the watchdog (render-watch's
poll, or a future one) has to be able to see AskUserQuestion prompts in the pty
output, not just infer liveness from time since the last byte.

## 3. Sub-agent dispatch "in a pane" may not be a child of the pty at all

`cooking.md` step 3v says to dispatch a named render sub-agent in a pane. Elsewhere
in this workspace, pane dispatch means a separate cmux pane: an independently
spawned process tree, not a child of the process that requested it. If that is what
"pane" means here too, then `session.kill()` in `ws.ts` only kills the top-level
`claude` pty. The render sub-agent, and whatever it is running (kokoro, ffmpeg, a
second `npm run dev`), is not in that process's group and survives the kill
untouched.

**Failure scenario:** Stop is pressed (or the watchdog fires), the studio shows
"canceled," but the actual render sub-agent, in its own pane, keeps burning CPU and
eventually writes a video.mp4 that `render-watch.ts` picks up anyway, well after
the UI told you the run was dead. Two stale panes from two "canceled" runs can both
target the same renders directory at once.

**This needs a definite answer before E1, not after.** Either the harness profile
forces render sub-agents to be true OS children of the top-level `claude` process
(no pane-based dispatch for the render step, so a single kill reaps the tree), or
the harness explicitly tracks pane PIDs alongside the pty PID and the watchdog
kills all of them. Leaving this unstated is itself the risk.

## 4. One Node process hosts the WS server, the HTTP server, and every cook's process tree

`ws.ts`'s own comments are direct about this: an unhandled error anywhere in a
single connection's handling would take the entire dev server down, not just that
connection, because there is no process-level `uncaughtException` handler and this
is a custom server hosting all of Next in one process. That is a reasonable
mitigation for the case it guards against (a ws error event), but it does not
change the underlying shape: N concurrent cooks are N pty children, each itself a
parent to kokoro, ffmpeg, `npm run dev`, and `npm run check`, all hanging off one
Node event loop that also serves every other HTTP request Crowsnest handles.

**What breaks at 2 cooks:** two `npm run dev` instances from HITL #2 fight over the
same default port unless something assigns ports dynamically, and nothing in the
design says it does. **At 5:** ffmpeg encode and kokoro inference compete for CPU
with each other and with the main app's request handling, so page loads elsewhere
in Crowsnest slow down while a cook is rendering. **At 20:** pty file descriptors
and process ulimits run out, and if any one child throws in a way the ws.ts guard
does not catch, it can still take the shared process down, so every concurrent
cook dies at once instead of just one.

**Alternative:** for the actual usage pattern here (a solo founder, likely one or
two concurrent cooks, not a fleet), a full job-runner service is probably overkill,
but the render step should not share a process with the app server. Shell out to a
separate worker process (even a plain detached child per cook, per finding 1) so a
crash in one cook's tree cannot touch the HTTP/WS server or other runs. If
concurrency past two or three ever becomes a real target, that is when this should
become an actual queue (BullMQ-style, or even a `renders/` lockfile capping
concurrency at 1) instead of "however many tabs happen to be open."

## 5. `--dangerously-skip-permissions` in a sandbox cwd is a convention, not a boundary

The proposal's own config table calls this "contained by the sandbox cwd." It is
not. `--dangerously-skip-permissions` removes Claude Code's own permission gating
entirely: arbitrary Bash, arbitrary Write, arbitrary network fetch. The sandbox
directory is only the default cwd. Nothing stops `cd ..`, nothing stops reading or
writing anywhere the OS user can reach, nothing stops network egress to an
arbitrary host. There is no container, no chroot, no sandbox-exec profile, no
seccomp profile, no network allowlist. The only thing standing between "render a
video" and full access to this Mac is the model choosing to stay in the sandbox
directory because the brief told it to.

**Actual blast radius:** the same as the developer's own logged-in session. A cook
runs ffmpeg and kokoro (both real binaries doing real I/O) and fetches whatever the
brief or the model decides it needs. Per finding 3, it can also spawn sub-agents in
independent panes with the same unrestricted posture. If the brief or any fetched
content carries a prompt injection, which is plausible since briefs originate from
research or scraped content upstream in the pipeline, the containment story is
hoping it does not happen.

**Alternative:** at minimum, a dedicated low-privilege OS user for cook processes
with filesystem permissions that actually enforce the sandbox boundary, plus a
network egress allowlist (kokoro and ffmpeg do not need arbitrary internet access;
IG's Graph API domain and whatever asset CDN is used are the only things that
should be reachable). Better: run the cook inside a container or a sandbox-exec
profile with a bind mount limited to the one sandbox directory. Worth doing before
E3 makes the plugin surface bigger, not after.

## 6. `render-watch.ts` matches finished renders by a stale-tolerant heuristic, not by run identity

The watcher polls the renders root and matches any directory ending in `-<slug>`,
then fires once a `video.mp4`'s size holds steady across two 700ms ticks. It has no
notion of which run it is watching for, only the post's slug.

**Failure scenario:** a cook fails partway last week and leaves a stale
`2026-08-06-my-post/video.mp4` sitting in the renders root; nothing here cleans up
failed partial renders. Today you cook the same post again. Because that old file
is already fully written and untouched, it reads as size-stable on the very first
poll of the new run, so the watcher can report a finished render that predates the
run currently in progress, before the new render has even started encoding.

**Alternative:** have the cook command write a run-id sentinel, or have Crowsnest
pass a run id into `brief.md` and require the render directory name or the
`video.mp4`'s metadata to carry it, so the watcher matches on run identity rather
than slug suffix plus a size heuristic. The size-stability polling itself is a
reasonable, documented workaround for a real macOS FSEvents gap; that part is not
the problem.

## 7. `--plugin-dir` vendoring the whole skill suite: load cost and drift

Already flagged honestly in the proposal's own note for E3, so this is more a
request to close the gap than a surprise finding: hyperframes lives both globally
(`~/.claude/skills/hyperframes*`) and, after E3, as a vendored copy inside the
Crowsnest plugin. A fix made to the global skill will not reach cook sessions until
someone manually re-syncs the vendored copy, and there is no version stamp proposed
anywhere that would let a run record show which skill version actually rendered it,
which matters the day someone asks why a cook looked worse than last week's.
Concrete ask for E3: pin via a git submodule rather than a loose copy, and stamp
the submodule's commit hash into the run row so a regression is traceable to a
skill version rather than a vague sense that something changed.

## 8. Non-determinism means two cooks of the same brief are not comparable

A full interactive `claude` session with model sampling and two HITL gates means
cooking the same brief twice produces genuinely different VO takes, beat framing,
and pacing, by design, since this is creative generation rather than a
deterministic render pipeline. That is probably fine and even desirable here (you
want variation, not identical reruns), but it means the run-tracking system cannot
diff one run against the last one or treat a failed run plus a retry as directly
comparable signal. Worth naming so nobody later builds a regression-detection
feature on an assumption of determinism that was never true.

## Biggest concern

**Finding 1.** Tying a multi-minute, HITL-gated render's entire lifetime to whether
a browser tab's websocket stays open is the wrong shape for what this actually is:
a background job. Everything downstream, the run-tracking UI, the watchdog, Stop
versus Canceled, is built on top of that assumption, so it is worth fixing before
D1 locks in a run model that would need reworking later to support detach and
reattach.

## Strongest endorsement

**Cutting the vault out of the cook path (E1's brief.md, `--setting-sources user`,
`--plugin-dir`) is the right call, and it fixes a real, already-observed bug, not a
hypothetical one.** The current shipped path spawns into the vault's cwd and picks
up ambient hook noise (the documented `load_vault_context.py` error) purely as a
side effect of implicit discovery. Replacing "whatever sits on this cwd's settings
path gets loaded" with a declared, inspectable profile, one file that is the whole
truth of what a cook session is, is a genuine improvement in correctness and
auditability, independent of every concern above. It is the one part of this
proposal I would ship as designed.
