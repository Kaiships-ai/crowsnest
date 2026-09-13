# kit completeness

Use this rubric when scoring Completeness for the `kit` surface: the buyer-facing
distribution of crowsnest, a single tarball plus the `kai` command line tool that
installs, licenses, configures, updates, and runs the product on a buyer's Mac.

## Category scope

- Install: one curl command fetches and unpacks a self-contained tarball carrying pinned
  node, python, and uv, with no host tooling and no sudo required.
- License gate: the tarball is private in R2; `install.sh` gets a working download only by
  presenting a license key a Cloudflare Worker validates against Polar.
- Configure: `kai kit init` takes the buyer's own credentials (Instagram, Anthropic key,
  vault location), then hands off to `kai up`.
- Run: `kai up` starts the app and opens the dashboard.
- Update and rollback: `kai update` re-runs the installer to the new version, preserving
  the buyer's database and config; a rollback path exists.
- Platform guard: Apple Silicon only for v1; a real Intel Mac is refused with a refund
  pointer.

## Completeness questions

- Does the one-line install work on a clean Mac with no Node, Python, git, Xcode, or
  Homebrew, and no sudo?
- Does the license gate refuse an install without a valid current key, and validate
  against Polar without burning an activation slot?
- Does `kai kit init` capture all required buyer credentials and create a working database
  before handing off to `kai up`?
- Does `kai up` reliably start the app and open the dashboard?
- Does `kai update` move to a new version while preserving the buyer's database and config,
  and is rollback available?
- Is the Intel Mac refusal present with a refund pointer, and are the runtime pins
  recorded per platform?
- Are the version's changes documented in the Kit changelog before a release can be cut?

## Evidence

- Workflow: `kit/01-concept-brief.md`, `kit/03-feature-description.md`;
  `documents/architect/shared/packaging-and-release.md`, `packaging/README.md`.
- Package and gate proof: `crowsnest-testing` references/package-and-docker.md.
- Known gaps: `kit/05-backlog-to-enhance.md`; the `01` status line flags the empty
  `IG_PASSWORD` onboarding bug blocking a live sync after install.
- Coverage: `kit/04-test-cases.md`, the `build-bundle.sh` self-test, vitest.
