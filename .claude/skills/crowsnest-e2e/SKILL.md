---
name: crowsnest-e2e
description: Use when designing, testing, fixing, or extending the crowsnest web UI, including UI stress-test galleries with feedback inputs, Playwright end-to-end checks against a mocked Next API backend, screenshots and videos, or agent-verifiable browser proof. Trigger:/crowsnest-e2e
---

# crowsnest-e2e

Real browser flows against deterministic, mocked backend data. This is the safety net for UI migration: pin behavior with a green Playwright suite against a mocked API first, then change the internals freely.

The old `scripts/e2e/*.sh` bash smoke lane still runs (`npm run e2e`). Grow the Playwright lane alongside it and retire a bash script only once a green Playwright spec covers the same path. Do not delete the bash lane before its replacement is green.

## UI stress test

For substantial UI changes, build a local HTML stress-test gallery early so the user can compare states and give feedback against concrete examples. Skip it for small copy or icon edits where a gallery adds no useful comparison.

1. Derive examples from the affected components and their data contracts. Cover normal, loading, empty, error, unavailable, permission, selected, and expanded states, plus long text and dense content where they stress the layout. Show mutually exclusive states separately; label proposed states the current implementation does not support.
2. Build one browser-openable HTML overview with stable example IDs, short state labels, and enough context per example. Prefer real components and deterministic mock fixtures. Label static or approximate renderings and link to the running UI for interactions they cannot reproduce. Keep generated galleries in scratch, do not commit them by default.
3. Give every example a labeled feedback input. Persist feedback across refreshes with a gallery-specific storage key and stable example IDs. Include a Copy feedback action that exports the IDs, state labels, and comments as text.
4. Open the gallery in the preview browser and share its path. Keep the same gallery and example IDs during iteration, preserving comments as examples change. Apply feedback to both the gallery and the implementation.
5. Before requesting feedback, inspect the rendered examples at relevant viewport sizes and verify feedback survives a refresh and exports with the correct labels. Report any unsupported states or preview limitations.

The gallery supports design review; it does not replace focused behavior tests or inspected before and after proof from the running UI.

## Test shape

- Playwright specs live under `e2e/**/*.e2e.spec.ts`.
- `e2e/helpers/mock-backend.ts` installs the mocked backend: it intercepts fetch to the Next API routes (`**/api/**`) with `page.route` and serves typed fixtures, so a spec is deterministic and keyless.
- Keep scenarios deterministic. Do not use live provider keys, real Instagram or channel credentials, or a real database unless the user explicitly asks for live proof.
- Prefer unit or component tests (vitest) for narrow rendering logic. Use this lane when the proof should cover routing, app boot, data fetching, and visible UI behavior together.

## Commands

```bash
npm run test:e2e            # run the Playwright lane
npm run test:e2e -- <spec>  # target one spec
npx playwright install chromium   # one-time browser download
```

Trusted development proof runs locally against the mocked backend. A real database or live services need an explicit reason and per-task approval, per `crowsnest-testing`.

## Mock pattern

Install the mock before navigating, then assert both the intercepted request and the visible UI. Against the running app, point the spec at the dev server; for a pure harness check, drive a fixture page.

```ts
import { test, expect } from "@playwright/test";
import { installMockBackend } from "./helpers/mock-backend";

test("feed shows the mocked outlier row", async ({ page }) => {
  const backend = await installMockBackend(page, {
    "/api/feed": { outliers: [{ id: "v1", title: "Mocked outlier" }] },
  });
  await page.goto("/feed");
  await expect(page.getByText("Mocked outlier")).toBeVisible();
  expect(backend.calls("/api/feed")).toHaveLength(1);
});
```

Extend `installMockBackend` with more routes or typed responses as new flows need more backend surface.

## Visual proof

For appearance changes, capture inspected before and after evidence. For other behavior, deterministic assertions are enough; a video and screenshot set are not mandatory when assertions already demonstrate the change.

- Keep assertions deterministic; do not commit generated screenshots or videos (they belong in scratch or the Playwright report).
- Use `browser.newContext({ recordVideo: { dir, size }, viewport })`, `page.screenshot({ path })`, and close the context before reporting the video path.
- Treat recording as validation, not only demo capture. If the recorder fails or shows surprising behavior, stop, fix the behavior, add or update a regression test, then rerecord.
- If visual proof is blocked, state the exact blocker and still report the textual e2e evidence.

For narrated captions or eased zooms, use the `proof-video` skill.
