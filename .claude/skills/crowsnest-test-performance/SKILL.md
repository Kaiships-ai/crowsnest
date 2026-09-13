---
name: crowsnest-test-performance
description: Benchmark, diagnose, and optimize crowsnest web performance: Lighthouse scores, Web Vitals (LCP, CLS, INP), bundle size, and Next build output, with coverage and behavior intact. Trigger:/crowsnest-test-performance
---

# crowsnest test performance

Use evidence first. The goal is real, measured page and bundle improvement with
behavior and coverage intact, not guesswork tuning. A page is not slow, a bundle
is not bloated, and a regression is not real until snapshots, traces, or build
output support it.

## Workflow

1. Read the relevant local `AGENTS.md` and the touched component's
   `documents/architect/core-components/<component>/02-architecture.md` before
   editing. crowsnest is a Next.js breaking-changes fork; read the relevant
   guide under `node_modules/next/dist/docs/` before changing framework code.
2. Establish a baseline before changing code:
   - Bundle and route cost: `npm run build`, then read the printed route table,
     first-load JS per route, and the shared-chunk total.
   - Page runtime: run Lighthouse against a running server for the suspect route
     (see Benchmark commands). Prefer a production build (`npm run build` then
     `npm start`) over the dev server, which is slower and noisier.
   - Web Vitals: capture LCP, CLS, and INP from the Lighthouse run for the exact
     route and viewport.
3. Separate noise from real cost:
   - Run each measurement at least three times and keep the median; a single
     Lighthouse pass is noisy.
   - Compare like for like: same machine, same build mode, same route, same
     network and CPU throttling.
   - When a route regresses but the shared chunks did not, the cost is in that
     route's own tree; when every route grows, suspect a shared import.
4. Pick the next attack by return and risk:
   - High return: one route or component dominates first-load JS or LCP and has a
     clear root cause.
   - High leverage: one shared import (a barrel, an icon set, a date or chart
     library) inflates every route's shared chunk.
   - Lower risk: image sizing, font loading, static metadata, list virtualization,
     memoization of an expensive render.
   - Higher risk: data-fetch shape, server/client component boundaries, streaming
     and Suspense boundaries, or broad refactors.
5. Fix the root cause, not the symptom:
   - Split heavy client code behind `next/dynamic` or move it to a server
     component so it never ships to the client.
   - Import from a subpath instead of a barrel so tree-shaking can drop unused
     code.
   - Serve correctly sized, modern-format images through the framework's image
     handling; give fonts an explicit fallback and swap.
   - Cut render-blocking work and oversized RSC payloads; keep background loops
     and polling off a route that does not need them.
6. Preserve behavior and coverage:
   - Do not delete a slow integration proof unless the exact behavior is kept in
     a named, tested helper.
   - Keep one cheap smoke test or e2e journey when cross-component wiring matters.
   - State explicitly what incidental coverage, if any, was removed.
7. Re-benchmark the same command and route after the change and compute the
   absolute and percent gain.
8. Update the running report when this thread is tracking one: before and after
   numbers, commands, coverage notes, verification, and next attack order.
9. Stage only the files touched for this attack; commit and push only when the
   user asked.

## Metric collection

Collect at least one stable metric before and after, on the same machine and
command.

| Metric              | Use for                              | Preferred source                                   |
| ------------------- | ------------------------------------ | -------------------------------------------------- |
| first-load JS       | shipped client cost per route        | `npm run build` route table                        |
| shared chunk total  | broad barrel or shared-import loads  | `npm run build` shared-chunk summary               |
| LCP                 | perceived load speed                 | Lighthouse, per route and viewport                 |
| CLS                 | layout stability                     | Lighthouse                                          |
| INP                 | interaction responsiveness           | Lighthouse, or field measurement under real input  |
| TTFB                | server or data-fetch cost            | Lighthouse, or `curl -w` against the route         |
| Lighthouse perf     | user-visible composite               | `npx lighthouse` headless                          |

## Benchmark commands

Route and bundle sizes:

```bash
npm run build
```

Lighthouse against a production build (preferred):

```bash
npm run build
npm start &                 # serves via server.ts; note the port
npx lighthouse http://localhost:3000/<route> \
  --only-categories=performance \
  --preset=desktop \
  --output=json --output-path=.artifacts/perf/<route>.json \
  --chrome-flags="--headless"
```

Repeat with `--preset=mobile` for the throttled mobile profile. Run three times
and keep the median. Do not commit `.artifacts/` output.

TTFB spot check:

```bash
curl -sw 'ttfb=%{time_starttransfer}s total=%{time_total}s\n' -o /dev/null http://localhost:3000/<route>
```

## Common root causes

- A heavy client component shipped to a route that could render on the server.
- A barrel import (icons, UI kit, date or chart library) pulling the whole
  package into a route's shared chunk.
- No `next/dynamic` split for a rarely used, heavy widget.
- Unsized or unoptimized images causing layout shift and slow LCP.
- Fonts loaded without a fallback or swap, blocking first paint.
- Oversized RSC payloads streaming data the page does not render.
- A long list rendered without virtualization or pagination.
- An expensive render recomputed on every keystroke without memoization.
- Background polling or a scheduler left running on a route that does not need it.

## Verification

- Always re-run the exact benchmark that proves the change (build route table
  and the Lighthouse route).
- For source changes, run `npm run typecheck`, `npm run lint`, and the relevant
  `npm test -- <path>` before push.
- Run `npm run build` when touching dynamic imports, server/client boundaries,
  build output, images, or fonts.
- If a page's memory keeps growing across intervals or a worker OOMs, that is a
  heap question, not a page-speed one: route it to `crowsnest-test-heap-leaks`
  (planned). TODO: wire to crowsnest-test-heap-leaks once it exists. Do not call
  memory growth a leak until snapshots or retainers support it.
- Use the report format:

```markdown
| Metric          | Before |  After |         Gain |
| --------------- | -----: | -----: | -----------: |
| First-load JS   | `XkB`  | `YkB`  | `-ZkB` (`P%`)|
| LCP             | `Xs`   | `Ys`   |  `-Zs` (`P%`)|
| Lighthouse perf | `X`    | `Y`    |       `+Z`   |
```

## Handoff

Keep the final concise:

- Root cause.
- Route and bundle scope.
- Files changed.
- Before and after first-load JS, LCP, CLS, INP, and Lighthouse numbers where
  available.
- Coverage retained.
- Verification commands.
- Commit hash and push status.
