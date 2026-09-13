# Campaign evidence and counting

Update the operator-requested report throughout the run, not only at the end.
Never place credentials, raw authenticated requests, real Instagram session
data, or personal information in an artifact.

## Campaign header

Record the user-approved scope, the current requested fix target, the actual
start time, the current immutable `origin/main` SHA and refresh time, the
authorized landing policy (crowsnest never self-merges; a human lands every PR),
the report location, and the machine-load budget. If the operator changes the
target, update the active goal and every ledger denominator while preserving
historical progress; never treat the old target as campaign completion.

## Audit lane

For every active lane record:

```text
lane:
  component:        # analyze | discover | feed | ig-sync | kit | llm | mcp | mine | onboarding | publish | remix
  baseline_sha:
  worker:
  started_at:
  deadline:
  status: running | replacing | evidence-ready | rejected
  evidence:
```

Keep several materially different component lanes in flight when independent
worker execution is authorized; scale to the machine, not a fixed swarm. Track
blocked worker and live-service capacity explicitly. A finished worker, a planned
worker, a sequential inspection, or a duplicate component is not an active lane.
For a solo run, inspect distinct components and report the actual concurrency and
independent-verification limitation honestly.

Freeze one baseline per wave. Verify each read-only worker checkout with both
`git -C <checkout> rev-parse HEAD` and an empty
`git -C <checkout> status --porcelain=v1` at worker start and immediately before
report acceptance; never trust a dirty checkout because `HEAD` matches. Keep
intentionally dirty fix worktrees outside frozen review waves. Let only the lead
refresh the shared remote ref.

## Bug ledger

Count a product bug only after every required field is proven:

```text
number:
summary:
baseline_sha:
component_owner_and_user_path:
reproduction_before:
observed:
expected:
independent_verification:
root_cause:
affected_callers_and_siblings:
canonical_owner_refactor:
regression_or_live_proof_after:
exact_reviewed_head:
exact_head_ci:
pull_request:
status: PR open (human to land) | merged <verified SHA>
risk: low | review required
```

Require evidence that the repair eliminates the canonical cause, not only the
observed symptom. Record which sibling paths were checked, which were fixed
together, and which are unaffected; count a shared invariant once. Keep a
separate `review-required` section for security, auth, drizzle schema and
migrations, API route contracts, the Instagram session and auth path, persistent
state, and other human decisions; give the reproduction, the proposed PR, the
completed validation, the risk, and the outstanding gates, and do not include
them in the accepted-fix count.

## Long-running evidence

For any bounded soak or stress run, record the actual start, the immutable
source SHA, the owned live PID and isolated endpoint and state directory, the
elapsed time, the exact pass, fail, and skip counts, sampled system load, and
the actual end time. A live result is incomplete until the specified duration has
actually elapsed; an unavailable capability is unavailable, never
skipped-and-green.
