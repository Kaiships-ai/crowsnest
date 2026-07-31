# How to test Crowsnest

For the tester team. Read this before a batch, then read the acceptance
criteria for your screen in `v1-scope.md` section 2.

## Report to a file, not to a message

Write findings to `docs/product/test-reports/<screen>-<date>.md` and report only
that path back. Messages between agents get lost or crossed; a file on disk does
not. A finding that only exists in a chat message did not happen.

## What counts as a bug here

In priority order. The first two outrank any cosmetic issue.

1. **A fabricated value.** A number the app displays that it cannot know. A zero
   standing in for a missing value. A sample size that does not match the rows
   behind it. This product is a research tool, so a number Kai cannot trust
   makes the whole thing worthless. Report these first and loudest.
2. **A control that does nothing.** A button that fires a toast promising a
   later release, a field that saves nothing, a filter that returns zero rows
   with no explanation, an instruction that cannot be followed. Ten of these
   shipped once already.
3. A broken flow, a crash, an error with no designed surface.
4. Wrong data, correct shape.
5. Visual mismatch against the prototype.

## Test the empty and the broken, not the happy path

Failure is the normal state in this product: Instagram rate limits, sessions
expire, syncs come back partial, the local model proxy goes down. The happy path
is the least interesting thing you can check.

For every screen, check all four:

- Zero rows. A fresh database, no channels, no posts.
- One row. Tiny numbers need dignity. The owned channel has about 5 followers
  and posts that reached about 9 people. A reach of 9 must not look broken and
  must not pretend to be a trend.
- A partial or failed sync.
- A missing dependency: no Graph token, proxy down, sidecar not running.

## Running the app

Use `http://localhost:3000`, never `127.0.0.1`. On the IP form Next 16 silently
blocks Server Actions as a cross origin dev request: the click does nothing at
all, no row written, no toast, no console message, no network request, and the
page still returns 200. It reads as a broken button rather than a blocked
request. That has already cost a day once.

## Verify, do not assume

Do not report a pass you did not observe. If you could not test something, say
so and say why. "Blocked, no Graph token" is a useful report. "Looks fine" is
not.

Check the claim against the database where you can:
`sqlite3 data/crowsnest.db "select ..."`. A screen agreeing with itself proves
nothing.

## Do not fix

You report, someone else fixes. A tester who edits code loses the ability to
tell whether the bug was real. Exception: if you find a shipped fabricated
value, say so immediately rather than waiting for the batch to finish.
