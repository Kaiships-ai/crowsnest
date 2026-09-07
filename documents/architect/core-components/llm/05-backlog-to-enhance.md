# llm: backlog to enhance

Bugs and enhancements for llm. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| TC-01 | browse-e2e journeys E2E-02, E2E-04, and E2E-07 have no testids to target: add `data-testid` to the Analyze button and analysis result hook (`video-analyze-button`, `video-analysis-hook`) and the Re-analyze button (`video-reanalyze-button`) in `video-detail.tsx`, and to the proxy-down block panel (`remix-generation-blocked`) in `generation-blocked.tsx`, before those journeys can be scripted | low | test-coverage | browse-e2e-backfill | open |
| BUG-01 | `ReanalyzeButton` in `video-detail.tsx` renders unconditionally with no `hasKey` check, unlike `AnalyzeButton` which shows the "Add your Claude API key" alert in place of its button. On an already-analyzed video with no `ANTHROPIC_API_KEY` configured, Re-analyze stays live and clickable, so clicking it attempts a request and would surface a raw error toast instead of the pre-emptive configuration state BEH-01 and BEH-05 expect everywhere else. Fixed: `ReanalyzeButton` now takes a `hasKey` prop, threaded down from `HookStructureTab`'s caller (the same `hasLlmKey` `AnalysisGate` already receives); with no key it renders a disabled button with a tooltip carrying the same "Add ANTHROPIC_API_KEY in Settings" message instead of a live one. See `src/components/video/video-detail.test.tsx` | medium | bug | browse-e2e-backfill | fixed |
