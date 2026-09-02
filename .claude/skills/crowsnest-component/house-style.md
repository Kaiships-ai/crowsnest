# Component doc house style

This is the quality bar every one of the five component docs under `documents/architect/core-components/<name>/` must meet, adapted from the funflow `pats` reference docs to crowsnest's Next.js plus SQLite/drizzle stack. It does not add a sixth doc and does not change the writing rule owned by `document-component`.

## 01-concept-brief.md

- **Status header.** A one-line header naming the component and its path, followed by `Status:` only. No `Date:` field, per the evergreen rule.
- **What it is.** A short prose section explaining the component in plain terms.
- **Why it exists.** The motivating problem or user need, in prose.
- **Key-concepts table.** A two-column table (Concept, Description) covering the vocabulary a reader needs before the rest of the docs make sense.
- **How it fits in the system.** Prose, optionally with a small diagram, placing the component among its neighbors.
- **Dependency map.** Three separate tables:
  - Upstream: what this component depends on.
  - Downstream: what depends on this component.
  - External: third-party packages, services, or OS-level dependencies it relies on.

## 02-architecture.md

- **Status header**, same rule as `01-concept-brief.md`: `Status:` only, no `Date:` field.
- **Module-structure table.** Columns: File, Export, Role. One row per file that carries meaningful logic.
- **Drizzle ER diagram.** A mermaid `erDiagram` block reflecting the real tables in `src/server/db/schema.ts` and their relations. Follow the mermaid rendering conventions in `references/drizzle-er-and-sequence.md` (no unquoted semicolons in message text, no HTML entities or literal comparison operators in condition labels, every message has an explicit arrow, single-line messages).
- **Indexes table.** Columns: Table, Index, Notes. Every index that exists on the real schema, plus why it exists.
- **Data flow.** Prose or a small diagram walking a request or job through the component's files.
- **Key decisions.** A short list of the design choices worth recording and why they were made.
- **DB-operation sequence diagrams.** Mermaid `sequenceDiagram` blocks for the component's real database-touching operations, in the same notation as `references/drizzle-er-and-sequence.md`, naming the table per query step.
- **An "open, not verified" section.** Any claim in the doc that has not been proven against the running app or a passing test goes here, named plainly, so the doc never states an unverified claim as fact elsewhere.

## 03-feature-description.md

- **Numbered feature list.** Every user-facing feature the component ships, numbered.
- **Per feature**, five parts:
  - Who uses it.
  - What it does.
  - How to access it.
  - Business rules.
  - Limitations.
- **User-guide subsection per feature, added after implementation.** Text only, no images. This doc feeds the mkdocs site directly, so the user-guide text must read as end-user documentation, not engineering notes.

## 04-test-cases.md

- One section per lens, covering all four lenses from `references/test-cases-format.md`: behavior, route and action, browse-e2e, security-lite.
- Each lens is a table of cases, in the format `references/test-cases-format.md` defines.

## 05-backlog-to-enhance.md

- One table only. Columns: ID, Title, Severity, Type, Source, Status.
- Rows with Status `open` are the live board; `scripts/plan-status.sh` counts them. Close an item by changing its Status cell, or by removing the row.

## Writing rule

Every deliverable follows the same rule: no em or en dashes, no curly quotes, sentence-case headings, grounded to real code, no invented facts.

Evergreen rule: these docs state the current system as fact. No dated "verified on" evidence framing, no `Date:` header field, no ticket IDs as inline citations. Verify live, then write the result as plain fact.
