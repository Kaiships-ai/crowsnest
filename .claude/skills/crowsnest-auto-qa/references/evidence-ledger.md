# Auto QA evidence ledger

Maintain one Markdown ledger in the user-requested report. Resume its existing
numbering; never replace, reset, or inflate a running campaign.

Record campaign-wide facts:

- The operator's current requested target; update the active target without
  erasing earlier historical progress.
- The exact current `origin/main` SHA and refresh time.
- The active component lanes (from analyze, discover, feed, ig-sync, kit, llm,
  mcp, mine, onboarding, publish, remix).
- Owned dev-server ports, the isolated fixture database (`data/e2e.db`), and
  resource use (CPU, memory, disk, open ports).
- Live-sync proof state, without any credential material.
- Any bounded soak start, elapsed time, and pass/fail/skip counts.

For each candidate use one explicit state:

- **Hypothesis:** a lane reported a potential issue; no independent reproduction.
- **Reproduced:** a failing current-main user path or focused regression exists.
- **Fix validated:** the canonical-owner root-cause refactor passes the user
  path, sibling regressions, independent review, and required exact-head CI.
- **Review required:** security, auth, migration, API-contract, persistent-state,
  uncertain, or high-impact work; link the PR without counting it.
- **PR open:** a focused PR is open on the exact reviewed head, awaiting a human
  landing. Crowsnest never self-merges.
- **Merged:** a human landed it and canonical `main` contains the merge SHA.
- **Rejected or duplicate:** record the actual reason and canonical root cause;
  do not increment progress.

For every accepted fix record:

```text
<number>/<target>: <distinct user-visible bug>
component: <canonical owner and affected user surface>
main baseline: <full SHA>
root cause: <repo-root source paths and current behavior>
canonical refactor: <owner, shared invariant, affected callers and siblings>
before: <actual failing user repro or regression>
after: <exact passing product path and focused regression>
proof: <e2e journey, scenario outcome, or verify-live evidence>
review: <fresh independent review on final head>
CI: <exact head and successful required ci.yml run>
PR: <GitHub pull request URL>
status: PR open (human to land) | merged <verified SHA>
risk: low | review required
```

Do not accept a symptom-only guard, a compatibility shim, a duplicate count, a
mocked or bypassed proof, a screenshot of an error state, a skipped check, a
green summary with zero real scenarios, or a GitHub state without verified
canonical main. Stop the count at the actual number of verified root-cause
fixes; never round up toward the target.
