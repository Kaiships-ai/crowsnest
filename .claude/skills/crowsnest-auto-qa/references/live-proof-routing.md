# Crowsnest live proof routing

Determine the actual current command and owner from root `AGENTS.md`,
`CLAUDE.md`, the owning component doc, `package.json` scripts, and the existing
`scripts/e2e` harness. Do not preserve stale invocation details as product
contracts.

## Seeded dev server (default proof)

Prove UI and route behavior against the seeded, mocked build, the same isolation
the e2e harness uses, never the operator's live app:

- Fixture database at `CROWSNEST_DB_PATH=data/e2e.db`, seeded by
  `scripts/seed-e2e.ts` (`scripts/verify-seeds.ts` confirms the seed shape).
- Dev server on a free port such as `:3001`, started the way `scripts/e2e/run.sh`
  does. Never stop, restart, reconfigure, or bind the operator's running dev
  server, their real database (`data/crowsnest.db`), or a live Instagram session.

Run the browse-e2e journeys with `npm run e2e` and the Playwright lane with
`npm run test:e2e` (see `crowsnest-e2e`). Derive scenarios from the component's
`04-test-cases.md` and the seeded journeys. Count a scenario only when the run
reports the expected user-visible outcome, not merely that a page loaded.

Inspect the actual rendered surface, not a fixture that bypasses the UI. A
screenshot, a successful navigation, or a 200 response is not passing proof when
the page shows an error, a blank surface, or the wrong result. Preserve only
screenshots that show the requested working surface. For a captioned recording
treated as validation, use `proof-video`.

## Instagram sync and live services

For an Instagram sync or own-channel claim, use `scripts/verify-live.sh` with a
burner account and a running sidecar (`scripts/ig-service.sh`,
`scripts/import-session.sh`); `scripts/live-sync.ts` drives a real sync. A mocked
sync, a skipped step, or an earlier head is not live proof. The sidecar uses
session-file auth, so a blank sidecar password is by design and a 401 means a
stale token row, not a missing secret.

Use an isolated authorized credential only through the approved local workflow.
Never emit its value, persist it in a report, commit it, or include it in a test
artifact. Redact handles unless the operator asks for local debugging. Live
proof needs an explicit reason and per-task approval, per `crowsnest-testing`.

## Data, migrations, and packaging

For a data-layer or migration claim, run the real path against isolated state:
`npm run db:migrate`, and `scripts/backup-db.ts` for backup and recovery
(`scripts/backup-db.test.ts` covers it). Unit tests alone do not prove a
migration.

For a Kit or packaging claim, exercise the real current packaging path
(`scripts/release-prep.sh`, `packaging/`); unit tests alone do not prove a built
distribution. For a publish-path claim, `scripts/publish-evidence.ts` produces
the real dry-run and Graph-token proofs under `evidence/publish/`.

## Execution host

Trusted development proof runs locally against the seeded, mocked backend, per
`crowsnest-testing`. A real database, live provider, or live Instagram service
needs an explicit reason and per-task approval. Place any generated proof under
`.artifacts/` or `evidence/`; never commit media or evidence output. For an
untrusted contributor's source, follow the root source-trust rules and never
expose real credentials or the operator's database to unreviewed code.
