# Prepare an isolated candidate checkout

crowsnest has no Gateway, no OCM, and no in-place managed runtime. The test
target is an isolated git checkout of the candidate build, built and run against
an isolated `HOME` and a disposable data directory. Never use the caller's
active checkout or the tester's real workspace.

## Resolve the candidate SHA

Resolve exactly one immutable SHA before preparing anything. If the tester
supplied a tag or branch, resolve it to a commit; do not test a moving branch.

```sh
candidate_sha="<exact-candidate-sha>"
test "$(printf '%s' "$candidate_sha" | wc -c | tr -d ' ')" = 40
```

If SHA resolution fails, report the setup blocker and pause. Do not fall back to
a moving branch, the caller's checkout, or a published package.

## Create the run-owned checkout

Create a disposable checkout at that SHA and prove it did not move:

```sh
work="$(mktemp -d "${TMPDIR:-/tmp}/crowsnest-validation.XXXXXX")"
git -C "$work" init -q
git -C "$work" remote add origin https://github.com/Kaiships-ai/crowsnest.git
git -C "$work" fetch --depth 1 origin "$candidate_sha"
git -C "$work" checkout --detach -q FETCH_HEAD
test "$(git -C "$work" rev-parse HEAD)" = "$candidate_sha"
```

If fetch, checkout, or the SHA equality check fails, report the setup blocker
and pause.

## Build on an isolated HOME

Build and run against a disposable `HOME` and data directory so nothing touches
the tester's real state:

```sh
run_home="$(mktemp -d "${TMPDIR:-/tmp}/crowsnest-validation-home.XXXXXX")"
env -i HOME="$run_home" PATH="$PATH" bash -c "cd '$work' && npm ci && npm run build"
```

Record the tool versions used (`node --version`, `npm --version`) for the test
environment profile. Any `npm ci`, `npm run build`, or startup failure of the
candidate itself is an eligible build finding; record it for the worksheet once
readiness is verified. Setup plumbing failures (mktemp, fetch, disk) are tooling
failures, not candidate findings: apply
[the tooling-feedback packet procedure](tooling-feedback.md).

## Containment gate

Treat containment as a hard gate. The candidate must write only inside `$work`
and the disposable `HOME` and data directory. If a real data path or a live
credential would leak into the candidate (for example, an absolute path pointing
back at the tester's crowsnest state), do not build or start it. State that
isolation could not be proven and stop; do not normalize or copy the path by
hand.

Copy the tester's state (for example, an Instagram session file or a database)
into the disposable location only with their explicit approval and a restoration
plan, because a candidate can invalidate a live session-file token. See
[human testing](human-testing.md) for the surfaces and
[cleanup and report approval](report-closeout.md) for teardown.

## In-place testing is not wired

There is no supported in-place lane for crowsnest today: do not update, migrate,
or restart the tester's real installation. TODO: wire an in-place update lane
(with a verified backup, a dry run, and a rollback plan) only if a managed
crowsnest runtime ever exists.

## Record the target

Record the candidate version and the full `candidate_sha` as the tested target.
Complete this step only when readiness is either verified or blocked with a
concrete finding. If readiness is blocked, skip diagnostics, the worksheet, and
surface testing, and state plainly:

```text
Build blocked, the candidate never became ready, so manual surface testing cannot begin.
Reply exactly `finish validation` to prepare a reviewable report of this finding, or tell me any final feedback to include.
```
