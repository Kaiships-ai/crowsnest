# Connectors

A connector is one outside source crowsnest reads from: Instagram Graph, the instagrapi sidecar, Groq, Umami, and later Polar and ChatbotX. Each is a manifest (what it is, as data) plus an adapter (the code that talks to it). The connector also owns the secrets the source needs, and those secrets are sealed by the macOS Keychain.

## Data it holds

- A manifest per connector (`ConnectorManifest` in `src/server/connectors/types.ts`): `id` (its folder name), `label`, `auth` (`oauth`, `api-key`, `browser-session`, `cli` or `mcp`), `secrets` (name, label, `perAccount`, `optional`) and `feeds`, the ledger counts it fills (`CountId` from `src/server/metrics/ledger.ts`).
- An adapter or `null` (`ConnectorAdapter`): `testConnection()` never throws; `pull()` returns a `PullResult` (`src/server/lib/pull-result.ts`). `null` is a manifest-only connector: listed with status `not-connected`, never called.
- `sealed_secrets`: `name`, `sealed`, `updated_at`. `sealed` is base64 ciphertext from Orca's `SecretStore` (`src/shared/secret-store.ts`, Electron safeStorage), whose key lives in the login Keychain as the app's Safe Storage item. A per-account Instagram password is keyed `IG_PASSWORD::<accountId>`.
- `secrets`: the legacy plaintext table. Nothing writes to it; the boot migration drains it.
- `umami_days`: one row per Asia/Ho_Chi_Minh day that a complete Umami pull counted: `raw` and `clean` counts (visitors, pageviews, custom events, paths, utm query strings, and per `utm_campaign` the pageviews, gift-page visits, `gift_signup`, `checkout_click` and `purchase`), `test_sessions_dropped`, `final` (1 once a pull ran after the day ended) and `fetched_at`. `clean` drops every session that touched a test marker, as `ksa_sync.py` does: a `utm_campaign` with a whole-token `test`, `utm_source=verify`, or a `/__test-purchase` or `/__diag` path.

| Connector | Auth | Secrets | Feeds | Adapter |
| --- | --- | --- | --- | --- |
| `instagram-graph` | oauth | `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID` | view, follow, bio_link_tap | `graphClient.checkToken`; pull is a due `measureOwnChannel` run, partial when a post's insights, the comments or the breakdowns failed or the run stopped early |
| `ig-sidecar` | browser-session | `IG_SERVICE_TOKEN`, `IG_USERNAME`, `IG_PASSWORD` (also per account), `IG_SESSIONID`, all optional | none | `igClient.health`; pull is a library `runSync`, read back from its `sync_jobs` row |
| `groq` | api-key | `GROQ_API_KEY` | none | key present |
| `umami` | api-key | `UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_USERNAME`, `UMAMI_PASSWORD` | gift_page_visit, email | login, then the website by id; pull is `pullUmami` |
| `polar` | api-key | `POLAR_ACCESS_TOKEN` | checkout, purchase, revenue | manifest only |
| `chatbotx` | mcp | `CHATBOTX_API_KEY` | comment_keyword, dm | manifest only |

## Boundaries

- Owns: `src/server/connectors/` (types, `registry.ts`, `secrets.ts`, one folder per connector) and `src/server/secrets/store.ts`.
- Called by: the Graph client, the sidecar client and launcher, Groq transcription, IG accounts, the Settings secret actions, the engine bridge (`listConnectors`, `testConnector`, `pullAgain`, `getVaultBoard`, `setConnectorSecret`, error scrubbing), the daily pull (`src/server/services/daily-pull.ts`), the `kai` CLI, and boot (`startInApp` in `src/server/start.ts` runs the migration).
- Calls: the source's own client through the adapter, and `SecretStore` for sealing.

## Invariants

- **Adding a connector is new files in one folder.** `registry.ts` finds `./*/index.ts` with `import.meta.glob`; there is no list to edit. A folder whose manifest id is not its folder name, or a secret two connectors declare, throws on boot. `registry.test.ts` checks the folders on disk against the registry and registers a sample connector from `__fixtures__/sample-crm/` with no core edit.
- **The engine reads a secret only through a manifest.** `readSecret(manifest, name)` in `connectors/secrets.ts` takes only a name the manifest declares. Only `connectors/secrets.ts` and `src/server/start.ts` import the keychain store; `registry.test.ts` fails on any other importer. The glob stays in `registry.ts`, so tsx scripts that read secrets never load it.
- **No secret value crosses the bridge.** `listConnectors` and `getSecretStatusAction` return status and source (`keychain`, `db`, `env`, `none`), never a value. The one bridge call that writes a secret is `setConnectorSecret(connectorId, field, value)` in `src/server/actions/secrets-actions.ts`: it refuses a connector or a field the manifest does not declare and a blank value, seals the value with `writeSecret`, and returns only `{ ok }` or `{ ok: false, error }`. It accepts a manifest-only connector, so a key can be saved before its adapter exists. `engine-calls.test.ts` saves a sentinel value and checks that no bridge read returns it.
- **A secret is stored sealed or not at all.** `setSecret` seals, reads the row back and unseals it, and only then drops a legacy row of the same name, in one transaction. When the Keychain cannot seal, it throws and nothing changes.
- **The boot migration keeps what it cannot move.** `migrateSecretsToKeychain` moves each legacy row; a failed seal or read-back leaves that row and is logged as `secrets.keychain_move_failed`. A rerun after a clean pass is a no-op.
- **Read order:** sealed value, then a legacy row not yet moved, then the env var of the same name. `IG_PROXY` and `IG_DEVICE_SEED` stay env only.
- **Outside Electron there is no Keychain.** A tsx script or the `kai` CLI has no `SecretStore`. It reads a legacy row the app has not migrated yet, or the env var. A secret the app has already sealed throws `SecretLockedError`, which says to run from Lead Studio or set the env var, unless the env var is set. A write throws, and `getOrCreateServiceToken` with no token says to open Lead Studio once or set `IG_SERVICE_TOKEN`.
- **A secret is sealed only when the store reports no protection gap.** If `describeProtectionGap()` names a gap, `setSecret` throws and the migration keeps the legacy row and reports it.

- **An Umami pull stores only a complete pull.** `pullUmami` (`src/server/connectors/umami/pull.ts`) logs in, then reads `/api/websites/:id/events` page by page from the oldest day that is not final, or on the first pull from the oldest plan with a keyword (at most a year back), to now. Only when every page came back does it write, in one transaction, each day's counts to `umami_days` and two `reel_funnel` rows per plan keyword (`source` `umami`, `agent` `umami`): `visits`, the clean pageviews of a `/get/` page in sessions whose first `utm_campaign` is the keyword (case-insensitive), and `emails`, their `gift_signup` events, each summed over every stored day. Both are counts, so they add across days and keywords. A failed page after the first is `partial` and a failed login or first page is `failed`; either writes nothing, so the boards keep the last complete numbers, the Sources card reads Partial or Error, and every number from that source is marked where it shows.
- **A pull reports what came back.** The daily pull and `pullAgain` record `complete`, `partial` (with what is missing), `failed`, or `skipped` (status not `configured`, or no `pull`). The daily pull writes its `daily_pulls` row; `pullAgain` leaves the slot row alone and keeps its outcome in memory. `lastPulls()` in `daily-pull.ts` returns the newer of the two per connector, so a restart forgets a manual pull and falls back to the slot row. A pull only reads from its source.

## Settings > Sources

`LeadSourcesPane` in `src/renderer/src/components/settings/LeadSourcesPane.tsx` is the Sources pane in Settings (id `lead-sources`, group Set Up), laid out like Orca's Integrations pane. It calls `getVaultBoard` (`src/server/queries/vault-board.ts`) and groups the connectors into Instagram, Funnel and Tools, each with a header and a one-line description. Each card is Orca's `IntegrationCardShell`: icon, name, one line on what the source gives, and the status pill in Orca's tones (`SOURCE_STATE`): `running` and `stale` read Connected, `partial` Partial, `error` Error, `not-connected` Not configured.

- One primary action: Connect when not configured, else Edit key. Both open `SourceKeyDialog` (`LeadSourceKeyDialog.tsx`), shaped like Orca's Linear key dialog: one password field per secret the manifest declares, saved with `setConnectorSecret`. No value is ever read back; a saved secret shows "Saved · paste to replace".
- The body says in plain words what the state means and what to do. A failed or partial pull says so first; the pull's raw detail sits under it, small, never as the headline. A connected card shows the last pull, the next 05:00 pull, and for `instagram-graph` the Graph calls left in the rolling hour.
- Learn more (when the source has public docs), Re-check (`testConnector`), and Pull again (`pullAgain`) only for a connected source that can pull.

`getVaultBoard` decides `state`: status not `configured` is `not-connected`; a configured connector with no `pull` is `running`; otherwise the last pull from `lastPulls()` decides: `failed` is `error`, `partial` is `partial`, `complete` in the current 05:00 slot is `running`, and anything else is `stale`. The sidebar's Sources row and every "not connected" badge on a board open this pane (`openLeadSourcesSettings`).

## Key files

- `src/server/connectors/types.ts`, `registry.ts`, `secrets.ts`
- `src/server/connectors/<id>/index.ts` and `manifest.ts`
- `src/server/connectors/umami/pull.ts` (HTTP and storage) and `days.ts` (day split and counts)
- `src/server/secrets/store.ts`
- `src/shared/secret-store.ts`, `src/main/host/electron-secret-store.ts`
