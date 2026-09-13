---
name: crowsnest-ci-limits
description: Keep crowsnest GitHub Actions CI within time and cost limits with change-scoped lanes and safe ramp changes. Trigger:/crowsnest-ci-limits
---

# crowsnest ci limits

Tune `.github/workflows/*` so CI stays fast and cheap: change-scoped lanes, single-flight on main pushes, sensible job fanout, and safe ramp-down/ramp-up of the typecheck/lint/vitest/testid-audit jobs.

TODO: port from openclaw-ci-limits (runner budgets, shard sizing, matrix max-parallel guidance). Map to `.github/workflows/ci.yml` and GitHub-hosted runners; drop Blacksmith/ClawSweeper specifics. Flesh out later.
