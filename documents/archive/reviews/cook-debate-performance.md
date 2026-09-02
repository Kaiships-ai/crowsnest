# Cook feature debate: performance and resource use

Adversarial pass, performance lens only. Ranked worst first. Numbers below are
back-of-envelope, not measured, and say so where that matters.

## 1. One process runs Next, every pty, and every render watcher; the render itself is the real threat

`server.ts` builds one `http.Server`, hands it to Next's request handler for
everything except `/api/terminal/ws`, and hands the upgrade path to a
`WebSocketServer` in the same event loop. `attachTerminal` then spawns the
pty and the poll timer for that session in that same process.

The cook's CPU load (HyperFrames' browser-based render, Kokoro TTS, ffmpeg
encode) does not run inside this Node process. Those are child processes
spawned by the `claude` pty session, so they get their own OS scheduling
slice and do not block Node's event loop directly. That part is fine. The
problem is they still share one physical Mac, and on a single consumer
machine, a headless-Chromium render plus ffmpeg plus Kokoro can pin several
CPU cores and saturate disk I/O for the whole render duration. Next in dev
mode compiles routes on demand, and every one of those recompiles now
contends for the same cores the cook is using. A founder clicking around
the dashboard while a cook runs will see slower page loads and slower HMR,
not a frozen UI. Process isolation holds; resource isolation (CPU, disk IO)
does not, and there is no priority scheme between them.

Concrete scenario: one cook running HyperFrames and ffmpeg on a MacBook
with 8 performance cores can occupy 4 to 6 of them for 60 to 180 seconds
per render. Run two cooks at once while dev-mode Next compiles a route the
founder just opened, and the machine visibly bogs down, not a crash, but a
UI that feels broken exactly when the founder is checking on their own
render.

Mitigation: fine as v1 for one cook at a time. Process isolation means a
runaway render cannot crash the web server itself (an ffmpeg segfault or an
OOM-killed Chromium dies as a child, not as the Next process). It does not
scale past "one cook, sometimes two." Before offering concurrent cooks
(section 5), the render step needs to leave this box: a separate worker
process (even just spawning outside the Next/ws process so `nice` or a
cgroup/QoS class can apply), or genuinely off-box, a render queue hitting a
beefier machine or a cloud render. Cheapest first step on one box: `nice -n
10` the render-triggering command so the scheduler favors the web server
under contention.

## 2. render-watch: sync fs polling on the event loop, one timer per open session

`watchForRender` runs `readdirSync`, `existsSync`, and `statSync` every
700ms, per session, for as long as the studio tab is open, not just during
an active cook. It polls from the moment the terminal connects until the
socket closes or the pty exits, whether or not the founder ever runs
`/ksa:cooking` that session.

`readdirSync` and `statSync` are synchronous. They block the single Node
event loop for their duration. On a `renders/` directory with a handful of
entries this is sub-millisecond and invisible. The comment in the file
explains why it is sync polling rather than `fs.watch`: FSEvents recursive
mode on macOS provably dropped the landing event in testing. That is a
reasonable, evidence-backed tradeoff, not a smell to reverse casually.

Where it gets real: this scans the entire renders root on every tick,
filtering by suffix match, for every open session. Two problems compound.
First, it never stops until the socket closes. A founder who opens a studio
tab and leaves it open all day polls `readdirSync` roughly 123,000 times
(86,400 seconds divided by 0.7), whether or not they ever cook anything.
Wasted, but each call is cheap enough that this alone is not the risk.
Second, the renders directory itself grows unbounded. No eviction cron or
archive step is visible anywhere in this code. After months of daily
cooking, `readdirSync` returns thousands of entries per call, and every
session's tick pays the cost of listing the whole directory, not just its
own slug's subdirectory.

Concrete numbers: at 100 render directories, `readdirSync` plus filter is
still low single-digit milliseconds, not a problem alone. At 5,000 or more
directories (a year or two of daily use with no cleanup) it climbs toward
tens of milliseconds per tick, on the same thread that serves every HTTP
request and websocket frame in the app. Multiply by N open sessions, each
running its own tick on possibly overlapping 700ms intervals, and this is
where sync fs on the shared loop stops being theoretical.

Mitigation, two independent and cheap fixes:
1. Run the poll timer only while a cook is actually in flight (started on
   `/ksa:cooking` detection or a render-started signal, stopped on
   capture), instead of for the session's whole lifetime. Cuts the idle
   case to zero.
2. Retire old render directories (move to cold storage or delete after
   AssetStore ingestion succeeds) so the scan target stays bounded. The MP4
   bytes are already duplicated into AssetStore's content-addressed store
   once `put()` succeeds (section 3), so the renders-dir copy is redundant
   after that point and safe to prune.

If N concurrent sessions ever gets large, swap the per-session poll for one
shared poller, process-wide, that fans out matches to interested sessions.
Cost today scales with sessions times directory size; a shared poller makes
it scale with directory size alone, regardless of session count. Not urgent
at today's scale.

## 3. AssetStore.put: full-buffer read and hash on the request path, no backpressure

```
const bytes = await readFile(file.path);
const sha256 = createHash("sha256").update(bytes).digest("hex");
```

This reads the entire MP4 into a `Buffer` before hashing, then holds it
again to write it out if it is a new asset. It moved to `fs/promises`
recently per the commit log, which fixed the sync-blocking version of this
problem: the async form does not block the event loop while the disk I/O
happens. What it did not fix is peak memory. For a 45-second 9:16 Reel at a
reasonable bitrate this is maybe 15 to 40MB, trivial. HyperFrames can also
render longer explainer-style content; a 5 to 10 minute render at higher
bitrate is easily 200 to 500MB in one `Buffer`, held twice briefly (once
during hash, again for `writeFile` if new) if V8 does not collect the first
reference fast enough. That is a single allocation spike, not a leak, but
it lands exactly when `onFound` fires from render-watch, right as the
founder is likely also using the terminal socket and the process is
serving other requests.

This does not block on an HTTP request; the watcher callback triggers it,
not a request handler, so no request waits on it. It still runs on the only
event loop in the app, though, and Node's async `readFile` for a large file
delivers the full buffer at once to `createHash().update()` regardless of
internal chunking. There is no true backpressure concern here since it is
not a stream consumer. The real risk is memory under concurrent cooks
(section 5): N simultaneous `put()` calls each holding a multi-hundred-MB
buffer, not any single call alone.

Mitigation: switch to a streaming hash, `crypto.createHash` supports piping
a `ReadStream` through it, so the file is processed in chunks (default
64KB) instead of held whole. Pair that with a stream-to-stream copy for the
write-if-new step instead of buffering. Peak memory per `put()` then drops
from the size of the file to about 64KB regardless of render length. Small,
mechanical change, worth doing before render lengths grow past today's
short-Reel assumption, and worth doing before section 5 makes concurrency
real.

## 4. Spawning a full interactive claude per session, plus a planned per-session plugin load

`createTerminalSession` spawns `/Users/.../claude --dangerously-skip-permissions`
via `node-pty` for every opened studio tab: a full agentic CLI process, not
a lightweight shell. This is expensive by nature. Cold start runs around a
second or more (binary load, env and config resolution, any startup
hooks), and each running instance holds its own memory footprint for
loaded context, tool definitions, and conversation state, realistically
tens to a few hundred MB per idle session depending on what has loaded into
context, before any actual work happens.

The proposed architecture (`crowsnest-cook-bigpicture.html`) adds
`--plugin-dir crowsnest/harness/plugin` to every spawn, loading commands
and every skill (hyperframes, faceless-explainer, baoyu) fresh per session.
If `--plugin-dir` re-reads and re-parses the plugin tree on each invocation
(the diagram's own config table does not say otherwise, and nothing in the
shipped code caches or shares a parsed plugin across sessions), that adds a
filesystem-read-and-parse cost at every session cold start, on top of the
existing claude startup cost, for content that is mostly static between
sessions.

Concrete scenario: a founder iterating on a cook opens and closes the
studio tab five times in ten minutes to retry. That is five full claude
cold starts plus five plugin-tree loads, each paying the same fixed cost,
with no reuse between them.

Mitigation: worth measuring first, `time claude --plugin-dir ... --help`,
before assuming this is a real problem rather than a prediction. If it does
matter in practice, the fix is a warm pool: keep one or two idle claude
processes pre-spawned with the plugin already loaded, hand them out on
session open, spawn a replacement in the background. That is real
complexity (session affinity, health checks, stale-pool invalidation) and
not worth building until cold-start time is measured and shown to be a UX
problem. Flagging it now so it is a known tradeoff going into E1, not a
surprise after.

## 5. No concurrency ceiling, no queue, no backpressure anywhere in this path

This is the structural gap underneath every risk above. Nothing in
`session.ts`, `ws.ts`, or `render-watch.ts` tracks how many sessions or
cooks are active, and nothing rejects or queues a new one. Every
`attachTerminal` call unconditionally spawns a new pty and a new poll
timer. If the founder, or a future teammate, or an automated batch job,
opens five studio tabs and fires `/ksa:cooking` in each, the code does
exactly that: five claude processes, five HyperFrames renders, five ffmpeg
encodes, five poll timers, all competing for the same CPU cores and disk on
one Mac, with the single Next/ws process still expected to stay responsive
underneath it.

This is the multiplier that turns sections 1 through 4 from "acceptable for
one founder running one cook" into "the machine falls over." Five
concurrent HyperFrames-plus-ffmpeg jobs is not five times the load of one.
On a machine with finite cores it is core-count-limited thrashing (context
switching, thermal throttling on a laptop, memory pressure from five
headless-Chromium processes). The stated goal here, cooking five videos at
once, is not an edge case; it is the first thing this design breaks under.

Mitigation: a concurrency ceiling is cheap to add and should land before
this ships as a feature people rely on. A process-wide counter, or a small
queue such as `p-queue` with concurrency set to 1 or 2, gates how many
cooks run at once, with the studio UI showing "queued" beyond the ceiling.
This does not require the full off-box render architecture in section 1.
It is a guard rail, not a redesign, and it directly answers "what happens
with five at once" with "four wait their turn" instead of "the Mac
chokes."

## 6. Watchdog plus poll timer: two timers per session, cleanup depends on every exit path firing

The proposed watchdog timeout (render-watch's poll timer plus a new
per-session watchdog for no render after N minutes) means two independent
timers per session going forward. The shipped code already threads timer
cleanup through three exit paths for the one existing timer: `session.onExit`,
`ws.on("close")`, and the `ws.on("error")` handler all call
`renderWatch.stop()` and `session?.kill()`. That pattern reads as
deliberate and already careful; the comments explain why each handler
exists, notably that an unhandled `ws` "error" event would otherwise crash
the whole single-process server.

Adding a second timer doubles the surface for a missed cleanup path, and
the diagram does not yet show where the watchdog timer's `clearTimeout`
would live. One gap is visible in the current code even without a
watchdog: if `attachTerminal`'s outer `try` throws after `renderWatch` is
created but before the `ws.on("close")` handler is registered (say,
`session.onData` registration itself throwing, however unlikely), the
catch block calls `session?.kill()` but never `renderWatch.stop()`, a
leaked interval on an already-rare error path. Minor today, worth fixing
by capturing `renderWatch` in the same outer-scope pattern already used for
`session`, before adding a second timer that needs the same discipline
twice.

Mitigation: when building the watchdog, use one `AbortController` per
session instead of two independently tracked timers. Register both the
poll interval and the watchdog timeout against the same abort signal, tear
down both from a single `abort()` call reachable from all three exit paths
plus the outer catch. That collapses two timers and N cleanup call sites
into one cancellation source with the same N call sites, a safer shape
under the rapid open, close, retry churn a founder produces while iterating
on a cook.

---

## Biggest concern

Section 5, the missing concurrency ceiling. Every other finding here is a
tuning problem (polling interval, buffer size, cold-start cost) that
degrades gracefully. A concurrency ceiling is the one gap that turns "cook
runs a little slow" into "the machine stops responding," and it is also the
literal scenario the proposed architecture wants to support: what happens
when the founder wants to cook five videos at once. Right now the answer is
that it tries and probably chokes. This should land before or alongside E1,
not deferred to a later phase, because every other piece of the roadmap
(harness hub, run tracking, workspace move) assumes cooks are well-behaved
individual events, and none of them currently ask how many can happen at
once.

## Strongest endorsement

The decision to poll instead of use `fs.watch`. This is the one place in
the reviewed code where a sync-I/O choice looks correct rather than sloppy,
because the comment shows the author tried the "correct" answer first and
it silently dropped the exact event the feature depends on (macOS FSEvents
recursive mode missing a fast write-then-rename race right after watcher
creation). A polling loop that is provably reliable beats an event-driven
one that is provably lossy, even though polling is usually the reflex to
flag in review. The fix is not to stop polling. It is to poll with less
waste (section 2: only while a cook is in flight, against a directory that
does not grow forever). The polling decision itself should stay.
