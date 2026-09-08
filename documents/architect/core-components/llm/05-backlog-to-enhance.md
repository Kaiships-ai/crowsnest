# llm: backlog to enhance

Bugs and enhancements for llm. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| TC-01 | browse-e2e journey E2E-04 has no testid to target: add `data-testid` to the proxy-down block panel (`remix-generation-blocked`) in `generation-blocked.tsx` before it can be scripted. The `video-analyze-button`, `video-analysis-hook`, and `video-reanalyze-button` testids this row originally also tracked were retired in P0 slice 2a along with the in-app Analyze and Re-analyze buttons (E2E-07 is retired; E2E-02 is repointed to the remix hooks stage, whose generate-trigger testid is tracked with remix's own browse-e2e) | low | test-coverage | browse-e2e-backfill | open |
| BUG-01 | `ReanalyzeButton` in `video-detail.tsx` rendered unconditionally with no `hasKey` check, unlike `AnalyzeButton` which showed the "Add your Claude API key" alert in place of its button. On an already-analyzed video with no `ANTHROPIC_API_KEY` configured, Re-analyze stayed live and clickable, so clicking it attempted a request and would surface a raw error toast instead of the pre-emptive configuration state expected everywhere else. Fixed in-flight by giving `ReanalyzeButton` a `hasKey` prop. Superseded: P0 slice 2a then retired the `ReanalyzeButton` and the entire in-app Analyze/Re-analyze path, so no live surface carries this gate any more and the fix is moot. Analysis is now agent-authored through `crowsnest_save_analysis`, which needs no key | medium | bug | browse-e2e-backfill | retired |
