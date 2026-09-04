# studio: concept brief

`documents/architect/core-components/studio/`

Status: shipped and in daily use for the cook, publish, and save to calendar loop; a few of the live displays do not survive a reload (see backlog).

## 1. What it is

The studio is the screen at `/mine/{postId}/studio`, one route per planned post, that turns a plan into a rendered vertical video. It is a three pane screen: a read only Brief on the left describing what is about to be cooked, a live Claude Code terminal in the center, and an Output rail on the right with the render preview, Publish, and Save to calendar. The user reaches it two ways, both deep links: the remix finish stage's "Open the studio" link and the plan dialog's "Create in Studio" button. Either way the page opens on the brief.

The terminal pane opens its websocket the moment the page mounts, before the user does anything: the server resolves the post, writes a `brief.md` into a per post sandbox directory, and spawns a Claude Code session there with the `ksa` plugin loaded, running under bypassed permissions with no settings files inherited. That spawn claims a `create_runs` row in `running` status right away. Clicking Cook does not start the session, it only types the `/ksa:cooking` slash command into the session that is already running, which is what actually begins the render. The status pill, the elapsed clock, and the streamed terminal output show the session working; when the render lands it appears in the Output rail and gates Publish. Publish then types `/ksa:serve` into the same session (the official Graph API path) after a confirm.

## 2. Why it exists

The rest of the app finds outliers, saves them, remixes a script, and schedules a plan on a calendar, none of that produces a video. The studio is the component that closes the loop: it takes the plan the remix built and hands a cooking agent everything it needs to actually render the reel, then lets the user publish it. The cook is deliberately an agent session in a terminal rather than a fixed pipeline, so the render logic lives in the Claude Code harness and its slash commands, not in the Next.js app. The app's job is to compose the brief, spawn and track the session, and surface the result.

`brief.md`, written into the run's sandbox directory when the session spawns, carries more than the on screen brief: the remix's chosen hook and script variant, the persona, and the source video's transcript and beats. The on screen brief is just enough for the user to confirm what they are about to cook.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Brief | The read only left pane, composed server side by `getStudioBrief` from the plan, the source video's detail, and the remix session the plan came from. |
| `brief.md` | The richer markdown file `writeBrief` writes into the run's sandbox directory when the terminal session spawns. It carries the chosen hook and script variant, the persona, and the source video's transcript and beats, none of which appear on screen. |
| Cook run (`create_runs` row) | One row per terminal session spawn, tracked in `create_runs` with a status of running, waiting, success, failed, or canceled. Owned in full by [background jobs](../../shared/background-jobs.md). |
| CookEntry | The in memory, postId keyed record in `session-registry` that lets a Claude Code session, its watchdog, and its render watch outlive the websocket that spawned it, so closing a tab never kills a cook. |
| Render asset | The MP4 the cook produces, stored through the shared asset store as a `media_assets` row and served from `/api/media/{assetId}`. Its id stamps the create run's `render_asset_id`, which is what gates Publish. |
| Publish gate | Publish reads the `render_asset_id` off the post's latest create run once on mount, so it survives a reload. Save to calendar needs a render captured live in the current session, so it does not survive one. |

## 4. How it fits in the system

The brief is composed from data the calendar, remix, and feed already wrote: a plan (from [mine](../mine/03-feature-description.md)), a source video (from [feed](../feed/03-feature-description.md)), and a remix session (from [remix](../remix/03-feature-description.md)). The studio touches none of that data itself; it only reads it once per page load. The cook run it spawns is a background job whose five statuses are owned by [background jobs](../../shared/background-jobs.md), and its failures surface through the shell's failure strip, owned by [status and failures](../../shared/status-and-failures.md). Publishing to Instagram is not app code: `/ksa:serve` reaches the Graph API from inside the agent session, out of the app's own reach entirely.

## 5. Dependency map

### Upstream (what studio depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | `planned_posts`, `videos`, `video_analyses`, `remix_sessions`, and `create_runs`, read and written through `queries/studio.ts`, `queries/create-runs.ts`, and `actions/create-run-actions.ts`. |
| Claude Code CLI, `ksa` plugin | The harness the cook session runs under; `harness-profile.ts` builds its arguments (`--permission-mode bypassPermissions`, `--setting-sources ""`, `--plugin-dir` pointed at the `ksa` plugin, `--model` from `COOK_MODEL`). The plugin supplies the `/ksa:cooking` and `/ksa:serve` slash commands. |
| `WORKSPACE_ROOT` config | Where the per post sandbox (`brief.md`, the cook's working directory) and the render directory live. |
| The shared asset store (`src/server/media`) | Stores the finished render as a `media_assets` row, content addressed by sha256, and serves it from `/api/media/{assetId}`. |
| `xterm.js` and the `ws` websocket server | The client terminal emulator and the server side pty relay (`src/server/terminal/ws.ts`) that carries keystrokes, output, render frames, and run frames between the browser and the spawned session. |

### Downstream (what depends on studio)

| Consumer | What it reads |
| --- | --- |
| Runs screen (`/runs`, `/runs/{runId}`) | Lists and details `create_runs` rows alongside sync and remix runs, through `queries/runs.ts`. |
| [mine](../mine/03-feature-description.md) (the calendar) | Reads `planned_posts.state`; a plan's published state is not set by anything the studio does (see edge cases below). |

### External

| Dependency | Role |
| --- | --- |
| Claude Code (Anthropic) | Runs the cook and serve agent sessions; authenticates through the same OAuth session the harness inherits, not an API key stored in the app. |
| Instagram Graph API | Reached only by the injected `/ksa:serve` command inside the agent session, never by app code. |
| ffmpeg | Used by the cook session to render the video; invoked from inside the agent's own work, not by the Next.js app. |

## 6. Boundaries

The studio owns the studio screen, the cook session's spawn and status tracking, the render capture that gates publish, and the two publish controls. It does not own what the cook agent actually does inside the session: the harness, its `/ksa:cooking` and `/ksa:serve` commands, the pty, and the websocket frames are terminal internals, out of scope here (see [background jobs](../../shared/background-jobs.md), which owns the five create run statuses). It does not own the plan, its script, or its remix session, all persisted before the studio opens (see [mine](../mine/03-feature-description.md) and [remix](../remix/03-feature-description.md)). Publishing to Instagram is likewise the injected `/ksa:serve` agent's concern; the app's own planned posts table has no network path, and Save to calendar only marks a row by hand. A frame pass, which would fill the brief's Visual direction section, is not wired up in this build, so that section reads "Frame pass not run." for essentially all real plans.
