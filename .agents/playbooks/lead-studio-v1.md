---
extends: autopilot-stack, multi-phase-plan
when: Planning or building Lead Studio v1 in this repo with owners, reviewers, and the PR stack.
---

# Lead Studio v1 way of work

Kai set these rules after the first Lead Studio PRs. Ship speed comes first, and test effort follows risk, not PR count.

## Risk tiers

Every change gets exactly one tier before its owner starts. The owner's report names the tier.

| Tier | Entry | Gate before merge | Who merges |
| --- | --- | --- | --- |
| docs | Docs, comments, plan text, skill text only | `node scripts/check-doc-paths.mjs` and `bash scripts/skill-lint.sh` locally; CI runs typecheck, lint, and tests on the PR | The root, once CI is green, no review |
| small | Under about 1000 changed lines or under 7 to 10 files, and no external surface | `pnpm run test:changed`, plus the verify journeys for the screens it touches | The root, then the post-merge smoke |
| complex | Any external surface, whatever its size, or above the small size | An owner in its own worktree, one independent review with a full first round, and the live lanes | Kai |

An external surface is any of these:

- A write outside the repo or the lane's throwaway HOME, such as `~/.claude`, `~/.orca`, the keychain, Homebrew, or an app profile.
- Process lifecycle, such as spawn, kill, signals, or daemons.
- An outbound write, such as an Instagram publish, ChatbotX, a website deploy, or Polar.
- The real database or a migration.

Every real defect review found in PR-15s, PR-M1, and PR-M2 was a small diff with an external surface. That is why size alone never makes a change small.

## Changes to the bundled playbooks

- **In** "Run the owner loop unchanged." apply the tier table. A docs or small change skips the independent review and merges as soon as its gate is green. Only a complex change runs the full owner loop.
- **In** "Run the owner loop unchanged." an owner runs only the tests related to the files it changed (`pnpm run test:changed`, which runs `vitest run --changed origin/main` at the root). The full suite runs only in CI. Every command runs under node 24; `scripts/heavy.sh` refuses another major.
- **In** "Audit on the wake chain." the tick also reads each open PR's state with `gh pr view <n> --json state,mergeCommit`. A merge it sees triggers `retire.sh` for that worktree and starts the next owner, so Kai never has to say a PR merged.
- **In** "Audit on the wake chain." before the tick replaces a slow or stuck lane, it reads that lane's brief for the cause and fixes the brief first.
- **In** "Verify each round." label each verdict `full` or `scoped`. A scoped round also reruns the core live lane at the final head.
- **In** "Verify each round." a lane that proves a failure path triggers it the way the real caller does, with the same signal and the same entry point.
- **In** "Verify each round." any change a lane makes outside the repo or its throwaway HOME goes in the lane receipt with its revert command. `app-down.sh` fails with `app: HOST CHANGED` when the Claude hooks or `~/.orca/agent-hooks` changed during the run.
- **Replace** "Append on a clean verdict, never ship." with this rule. The root merges docs and small changes itself, then runs the post-merge smoke on `main` (`app-up.sh --seed`, `app-drive.sh shell-01`, and the journeys for touched screens). A red smoke points at the last merge, and the root fixes or reverts it before the next merge. Only complex changes wait for Kai's merge.
- **In** "Settle open questions by prototype before you write." first show Kai two or three runtime and repo shapes, always including the end-state shape, each with its cost, one current-versus-target diagram, and the restated definition of done. Write the full plan only after Kai picks one.
- **In** "Settle open questions by prototype before you write." before the plan encodes a guard or invariant about another system, check that system's live state and record the result.
- **In** "Unless the operator names a path" write the plan under `documents/plans/`, as CLAUDE.md says, so `scripts/check-doc-paths.mjs` checks every path it cites.

## Decisions

When Kai decides, the root acts on it and states any irreversible consequence once. It does not reopen a question Kai has already weighed.
