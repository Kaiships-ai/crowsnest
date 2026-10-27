# crowsnest documentation

Product and design live in the repo root, outside this site's `docs_dir`, so they are linked from
GitHub rather than rendered: [PRODUCT.md](https://github.com/Kaiships-ai/crowsnest/blob/main/PRODUCT.md)
(what crowsnest is and must do) and [DESIGN.md](https://github.com/Kaiships-ai/crowsnest/blob/main/DESIGN.md)
(visual system, interaction model, shell).

## Architecture

`architecture/overview.md` is the entry point. Each page below holds the data a part owns, its
boundaries, and its invariants.

| Part | Page |
| --- | --- |
| Overview and process model | [overview](architecture/overview.md) |
| Data, persistence, multi-account, recovery | [data](architecture/data.md) |
| Background jobs and failure surfaces | [jobs-and-failures](architecture/jobs-and-failures.md) |
| External services | [external-services](architecture/external-services.md) |
| Connectors and keychain secrets | [connectors](architecture/connectors.md) |
| Vocabulary | [glossary](architecture/glossary.md) |
| kit | [kit](architecture/kit.md) |
| onboarding | [onboarding](architecture/onboarding.md) |
| feed | [feed](architecture/feed.md) |
| discover | [discover](architecture/discover.md) |
| analyze | [analyze](architecture/analyze.md) |
| remix | [remix](architecture/remix.md) |
| mine | [mine](architecture/mine.md) |
| publish | [publish](architecture/publish.md) |
| ig-sync | [ig-sync](architecture/ig-sync.md) |
| mcp | [mcp](architecture/mcp.md) |
| app (Lead Studio Electron shell) | [app](architecture/app.md) |
| boards (workspace board tabs) | [boards](architecture/boards.md) |

## Where things live

- Built-feature lists and browse-e2e test cases: `scripts/e2e/cases/<component>.md`, read by
  `scripts/e2e-coverage.sh` and `scripts/testid-audit.sh`.
- Plans still being worked on: `plans/`, flat, one file per plan. Frontmatter carries
  status and components. Shipped plans are deleted.
- Decisions still in force: [0001](decisions/0001-personal-tool-first.md), [0002](decisions/0002-data-and-action-brain.md).
- Running plans: `plans/2026-10-14-ig-sync-split-sync-engine.md`, `plans/connector-redesign.md` (plans are not rendered in the site).
- Backlog items are GitHub issues labeled `backlog` and `area:<part>`.
- Lessons that no single doc owns: [learnings](learnings.md).

## The bug board is generated, not committed

There is no committed status file, because it would be the one file every parallel session
conflicts on. Run scripts/plan-status.sh to print, on demand, each
component's open plans and open backlog count.

## Build the site

```bash
uv pip install mkdocs-material
mkdocs serve      # http://127.0.0.1:8000
mkdocs build      # static site/
```
