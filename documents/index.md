# crowsnest documentation

Two layers, modeled on the datahub standard.

- business-requirement: what crowsnest is and what it must do (product document, per-release BRD).
- architect: how it is built. High-level architecture, shared technical docs, and one folder per
  component under core-components.

## Components

Each component has the same five docs: 01-concept-brief, 02-architecture, 03-feature-description,
04-test-cases, 05-backlog-to-enhance.

| Component | Concept brief |
| --- | --- |
| kit | [01](architect/core-components/kit/01-concept-brief.md) |
| onboarding | [01](architect/core-components/onboarding/01-concept-brief.md) |
| feed | [01](architect/core-components/feed/01-concept-brief.md) |
| analyze | [01](architect/core-components/analyze/01-concept-brief.md) |
| remix | [01](architect/core-components/remix/01-concept-brief.md) |
| mine | [01](architect/core-components/mine/01-concept-brief.md) |
| publish | [01](architect/core-components/publish/01-concept-brief.md) |
| ig-sync | [01](architect/core-components/ig-sync/01-concept-brief.md) |
| llm | [01](architect/core-components/llm/01-concept-brief.md) |

## Where things live

- Implementation plans: planning/, flat, one file per plan, never moved. Frontmatter carries
  status and components. Placement and lifecycle are in the writing-plans skill.
- Frozen dated one-offs: archive/.

## The bug board is generated, not committed

There is no committed status file, because it would be the one file every parallel session
conflicts on. Run scripts/plan-status.sh (or the where-are-we skill) to print, on demand, each
component's open plans and open backlog count.

## Build the site

```bash
uv pip install mkdocs-material
mkdocs serve      # http://127.0.0.1:8000
mkdocs build      # static site/
```
