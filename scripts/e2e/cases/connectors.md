# Connectors cases

## Built features

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 1 | Connector registry | Lists every folder under `src/server/connectors/` as a connector with manifest, adapter and status | ● | `src/server/connectors/registry.ts` | none |
| 2 | Manifest-only connectors | Umami, Polar and ChatbotX are listed `not-connected` with the ledger counts they will feed | ● | `src/server/connectors/umami/index.ts`, `polar/index.ts`, `chatbotx/index.ts` | adapters land in W2 |
| 3 | Keychain secrets | Every secret is sealed by the Keychain through `SecretStore`; only ciphertext is stored | ● | `src/server/secrets/store.ts` | none |
| 4 | Boot migration | Legacy plaintext rows move to the keychain; a failed move keeps the row | ● | `src/server/start.ts`, `src/server/secrets/store.ts` | none |
| 5 | Bridge calls | `listConnectors` and `testConnector` | ● | `src/server/bridge/engine-calls.ts` | no board yet (W4 Vault) |

## connectors: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked. Journey `connectors-01` runs CONN-01, CONN-02 and CONN-05 on a seeded lane (`app-up.sh --seed`).

| ID | P | Needs | Claim | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- |
| CONN-01 | P0 | seed | The bridge lists six connectors; Umami, Polar and ChatbotX read `not-connected` | Call `listConnectors`. | Graph `configured`, the three manifest-only ones `not-connected`. | 🟢 `connectors-01` |
| CONN-02 | P0 | seed | The seeded legacy Graph token moves to the keychain on boot and leaves no plaintext in SQLite | Boot the lane, read `listConnectors`, query `secrets` and `sealed_secrets`. | Source `keychain`; `secrets` empty; no sealed row holds the plaintext. | 🟢 `connectors-01` |
| CONN-03 | P0 | none | A failed Keychain write keeps the legacy row and reports it; a mismatched read-back stores nothing | Migrate with a keychain whose seal throws, then one whose read-back differs. | Row intact, reported in `failed`. | 🟢 vitest (`store.test.ts`) |
| CONN-04 | P1 | none | A rerun of the migration is a no-op | Migrate twice. | Second report empty, sealed rows unchanged. | 🟢 vitest (`store.test.ts`) |
| CONN-05 | P1 | seed | A manifest-only connector is never called | `testConnector("polar")`. | `{ ok: false }` with "not connected". | 🟢 `connectors-01` |
| CONN-06 | P0 | none | A new connector is new files in one folder | Register `__fixtures__/sample-crm`. | Listed, tested, pulled, its secret read, with no core edit. | 🟢 vitest (`registry.test.ts`) |
| CONN-07 | P0 | none | No module but `connectors/secrets.ts` and boot imports the keychain store | Scan sources. | Only those two. | 🟢 vitest (`registry.test.ts`) |
| CONN-08 | P0 | real Keychain, lane-only app name | A seal and unseal through Electron safeStorage uses the real login Keychain under a lane-only item, deleted after | Run `.claude/skills/verify/scripts/keychain-lane.sh`. | Value round-trips; the item exists during the run and is gone after. | 🟢 `keychain-lane.sh` |
