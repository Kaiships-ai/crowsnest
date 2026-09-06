# discover: backlog to enhance

Bugs and enhancements for discover. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| DISC-01 | Suggestion ranking is not built; every niche shows its full curated list in a fixed order with no personalization | low | enhancement | product-description open question | open |
| DISC-02 | A dual-niche creator (for example fitness and business) lands under one curated niche only, not shown under both | low | enhancement | product-description open question | open |
| DISC-03 | The seed picker is built but not mounted; no first-run step wires it in yet | low | enhancement | product-description open question | done (mounted in first-run sources step) |
| DISC-04 | Seed verification is partial. A live sidecar run confirmed and marked fitness (27 of 30, 3 dropped) and finance (26 of 28, 2 dropped); tech and business (30 each) remain unverified because the window closed first. The remaining two niches are hand-curated from real public accounts but not yet machine-confirmed; a dead handle there will surface as a failed sync on first follow. Run `verify-seeds.ts` in a further sidecar window to finish tech and business | medium | bug | partial live verification | open |
| DISC-05 | Feed to idea to copy-to-LLM in three or fewer clicks is deferred until after Goal 1 wave 3 merges; `/feed` and `/ideas` are Goal 1's until then | low | enhancement | product-description open question | open |
| DISC-06 | `bootstrapCreatorSeeds` does a select-then-insert per creator (about 130 round trips) rather than one guarded batch insert. Kept as is: it matches `bootstrapSystemFilters` right above it, the unique index already guarantees idempotency, the cost is one-time at install, and no batch-insert or `onConflictDoNothing` pattern exists anywhere else in the codebase to reuse. Switch to a batched `onConflictDoNothing().returning()` if bootstrap ever runs hot | low | enhancement | round 1 code review | open |
| DISC-07 | browse-e2e journeys need testids that do not exist yet: the discover-board empty-state message ("Run npm run db:bootstrap"), the per-niche tab triggers under `discover-niche-filter` (only the tab list carries a testid, not each niche), and a per-handle distinguishing attribute (for example `data-id`) on `creator-seed-card` / `creator-seed-follow` so a specific card can be targeted rather than acted on positionally. Until added, E2E-02/04/05/06/07/09 fall back to `assert_text` or positional targeting | low | test-coverage | 04 browse-e2e backfill | open |
