# onboarding: concept brief

First-run setup: license, Instagram login, keys, and reaching a working dashboard.

## What it is

Onboarding is what happens between `kai up` opening a browser and the user reaching a
working feed. It is two layers, not one. The [Kit](../kit/01-concept-brief.md) CLI's
`kai kit init` is the terminal half: it writes `.env.local`, prompts for the Instagram
account (username and a not-echoed password), generates the sidecar's shared secret,
optionally takes an `ANTHROPIC_API_KEY`, and asks where the vault lives, then creates the
database. The in-app half is a five-screen flow served at its own route, `/first-run`,
outside the normal app shell (no sidebar, no topbar): welcome, a niche/focus question,
connect (the one real credential screen, wired to Instagram login including its two-factor
and challenge branches), sources (adding tracked channels), and first sync. A route guard
(`src/server/queries/first-run-gate.ts`) sends a database with no channels tracked and the
first-run flag not yet set to this route before any other page renders; once a channel
exists or the flag is set, it never redirects there again, even if every channel is later
removed.

Settings also carries two related panels once onboarding is behind the user: the Instagram
connection panel (the same login/disconnect surface the connect step uses, reachable again
later if the session needs re-establishing) and the local binaries check (yt-dlp,
whisper-cli plus its model file), a read-only status list for the optional local
transcription path.

## Why it exists

A buyer with the Kit installed but nothing configured cannot use crowsnest at all: there is
no data until a channel is tracked, and no channel can be tracked until the Instagram
sidecar has a session. Onboarding exists to take a completely empty install to a dashboard
with at least one tracked channel and a first sync underway, and to do it once, the
first-run gate exists specifically so a real production database is never routed back into
a wizard by mistake.

## Boundaries

Onboarding owns the first-run gate, the five-screen `/first-run` flow, and the CLI's `kai
kit init` prompts; it hands off to the [feed](../feed/01-concept-brief.md) and the rest of
the app once a channel is tracked and the flag is set. It does not own ongoing Instagram
session management day to day, that panel lives in Settings and is shared with the connect
step rather than owned separately by either. It does not own the Graph API token for the
user's own channel: per the coldstart design work, that panel was proposed but never
built, there is no Graph API code path in the app today, and the burner Instagram identity
(read by the Python sidecar) and any future Graph token must never share code or an
environment variable prefix.

Known gaps, filed live against a real onboarding pass: `kai kit init` can save an empty
`IG_PASSWORD`, which crash-loops the sidecar and leaves sync dead with no onboarding-time
warning; and the CLI echoes `ANTHROPIC_API_KEY` in plaintext during entry despite being
marked as a non-echoed prompt in code. Both are tracked in
[onboarding/05-backlog-to-enhance.md](05-backlog-to-enhance.md). A larger redesign, moving
Instagram login and key entry into the dashboard with live validation instead of a
terminal prompt, is tracked in the same backlog and is not yet built.
