# Connectors

A connector is one outside source crowsnest reads from: Instagram Graph, the instagrapi sidecar, Groq, and later Umami, Polar and ChatbotX. Each is a manifest (what it is, as data) plus an adapter (the code that talks to it). The connector also owns the secrets the source needs, and those secrets are sealed by the macOS Keychain.

## Data it holds

- A manifest per connector (`ConnectorManifest` in `src/server/connectors/types.ts`): `id` (its folder name), `label`, `auth` (`oauth`, `api-key`, `browser-session`, `cli` or `mcp`), `secrets` (name, label, `perAccount`, `optional`) and `feeds`, the ledger counts it fills (`CountId` from `src/server/metrics/ledger.ts`).
- An adapter or `null` (`ConnectorAdapter`): `testConnection()` never throws; `pull()` returns a `PullResult` (`src/server/lib/pull-result.ts`). `null` is a manifest-only connector: listed with status `not-connected`, never called.
- `sealed_secrets`: `name`, `sealed`, `updated_at`. `sealed` is base64 ciphertext from Orca's `SecretStore` (`src/shared/secret-store.ts`, Electron safeStorage), whose key lives in the login Keychain as the app's Safe Storage item. A per-account Instagram password is keyed `IG_PASSWORD::<accountId>`.
- `secrets`: the legacy plaintext table. Nothing writes to it; the boot migration drains it.

| Connector | Auth | Secrets | Feeds | Adapter |
| --- | --- | --- | --- | --- |
| `instagram-graph` | oauth | `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID` | view, follow, bio_link_tap | `graphClient.checkToken`; pull is a due `measureOwnChannel` run |
| `ig-sidecar` | browser-session | `IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD` (also per account), `IG_SESSIONID`, all optional | none | `igClient.health`; pull is a library `runSync`, read back from its `sync_jobs` row |
| `groq` | api-key | `GROQ_API_KEY` | none | key present |
| `umami` | api-key | `UMAMI_API_KEY` | gift_page_visit, email | manifest only |
| `polar` | api-key | `POLAR_ACCESS_TOKEN` | checkout, purchase, revenue | manifest only |
| `chatbotx` | mcp | `CHATBOTX_API_KEY` | comment_keyword, dm | manifest only |

## Boundaries

- Owns: `src/server/connectors/` (types, `registry.ts`, `secrets.ts`, one folder per connector) and `src/server/secrets/store.ts`.
- Called by: the Graph client, the sidecar client and launcher, Groq transcription, IG accounts, the Settings secret actions, the engine bridge (`listConnectors`, `testConnector`, `pullAgain`, error scrubbing), the daily pull (`src/server/services/daily-pull.ts`), the `kai` CLI, and boot (`startInApp` in `src/server/start.ts` runs the migration).
- Calls: the source's own client through the adapter, and `SecretStore` for sealing.

## Invariants

- **Adding a connector is new files in one folder.** `registry.ts` finds `./*/index.ts` with `import.meta.glob`; there is no list to edit. A folder whose manifest id is not its folder name, or a secret two connectors declare, throws on boot. `registry.test.ts` checks the folders on disk against the registry and registers a sample connector from `__fixtures__/sample-crm/` with no core edit.
- **The engine reads a secret only through a manifest.** `readSecret(manifest, name)` in `connectors/secrets.ts` takes only a name the manifest declares. Only `connectors/secrets.ts` and `src/server/start.ts` import the keychain store; `registry.test.ts` fails on any other importer. The glob stays in `registry.ts`, so tsx scripts that read secrets never load it.
- **No secret value crosses the bridge.** `listConnectors` and `getSecretStatusAction` return status and source (`keychain`, `db`, `env`, `none`), never a value. No bridge call writes a secret.
- **A secret is stored sealed or not at all.** `setSecret` seals, reads the row back and unseals it, and only then drops a legacy row of the same name, in one transaction. When the Keychain cannot seal, it throws and nothing changes.
- **The boot migration keeps what it cannot move.** `migrateSecretsToKeychain` moves each legacy row; a failed seal or read-back leaves that row and is logged as `secrets.keychain_move_failed`. A rerun after a clean pass is a no-op.
- **Read order:** sealed value, then a legacy row not yet moved, then the env var of the same name. `IG_PROXY` and `IG_DEVICE_SEED` stay env only.
- **Outside Electron there is no Keychain.** A tsx script or the `kai` CLI has no `SecretStore`. It reads a legacy row the app has not migrated yet, or the env var. A secret the app has already sealed throws `SecretLockedError`, which says to run from Lead Studio or set the env var, unless the env var is set. A write throws, and `getOrCreateServiceToken` with no token says to open Lead Studio once or set `IG_SERVICE_TOKEN`.
- **A secret is sealed only when the store reports no protection gap.** If `describeProtectionGap()` names a gap, `setSecret` throws and the migration keeps the legacy row and reports it.

- **A pull reports what came back.** The daily pull and `pullAgain` record `complete`, `partial` (with what is missing), `failed`, or `skipped` (status not `configured`, or no `pull`). A pull only reads from its source.

## Key files

- `src/server/connectors/types.ts`, `registry.ts`, `secrets.ts`
- `src/server/connectors/<id>/index.ts` and `manifest.ts`
- `src/server/secrets/store.ts`
- `src/shared/secret-store.ts`, `src/main/host/electron-secret-store.ts`
