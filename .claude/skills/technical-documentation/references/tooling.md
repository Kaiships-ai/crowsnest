# Documentation tooling guide

Source: https://www.mintlify.com/blog/top-7-api-documentation-tools-of-2025

Use this file when deciding build/review expectations for the docs platform. Crowsnest
docs are built with mkdocs-material (`mkdocs.yml`, `docs_dir: documents`); treat that as
the fixed stack and do not propose a migration without a documented reason.

## Tool-selection checkpoints

- Existing stack lock-in: crowsnest is on mkdocs-material; do not force migration for
  minor gains.
- Content depth: how much task-critical detail belongs inline vs linked to reference.
- Collaboration model: docs-as-code (Markdown in the repo), reviewed in the same PR as the
  code change.
- Runtime quality: search, navigation, and copy-ready code snippets.
- AI readiness: structured content, stable paths, machine-friendly layout yet human
  readable.
- Human readiness: reading complexity, reading UX, navigation depth, minimize jargon.

## Apply in brownfield mode (default)

- Prioritize compatibility with mkdocs-material and the current `documents/` IA.
- Use available mkdocs-material components and style conventions (admonitions, tabs, code
  fences) before introducing new patterns.
- Propose changes to `mkdocs.yml` nav only when current constraints block a critical
  outcome.

## Apply in evergreen mode

- Favor templates that make routine updates low-friction (the five-doc lego block for
  components).
- Standardize section templates to reduce drift.
- Capture ownership, update cadence, and stale-content detection rules.

## Review implications

- Check whether content uses mkdocs-material primitives correctly (admonitions, tabs, code
  fences, nav entries).
- Flag docs that are technically correct but hard to scan in mkdocs-material.
- Recommend platform-specific improvements only when they reduce cognitive load.
