# Connectors and keychain secrets

Each outside source is a connector: a manifest (id, label, auth kind, the secrets it needs, the ledger counts it feeds) plus an adapter (test connection, pull). `src/server/connectors/registry.ts` finds every folder under `src/server/connectors/` on its own. Secrets are sealed by the macOS Keychain through Orca's `SecretStore`; on boot a legacy plaintext `secrets` row moves to `sealed_secrets`. Architecture: `documents/architecture/connectors.md`.

## Sub-features

- Bridge `listConnectors`: every connector, its status (`configured`, `needs-setup`, `not-connected`) and where each secret comes from (`keychain`, `db`, `env`, `none`), never a value.
- Bridge `testConnector(id)`: the adapter's connection check; a manifest-only connector answers not connected.
- Boot migration: legacy rows move to the keychain, a failed move keeps the row and logs `secrets.keychain_move_failed`.

## How to get to it (user POV)

No board shows it yet; the Vault board (W4 B1) will read `listConnectors`.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh connectors-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`connectors-01` prints `ok: the bridge lists every connector with its state`, `ok: the seeded Graph token moved to the keychain on boot and no value crosses the bridge`, `ok: the lane DB holds no plaintext secret`, `ok: a manifest-only connector is never called`, and saves `connectors-01.png`. It reads the lane DB with `sqlite3` from the user data dir in `data/verify/app/state.json`.

## Gotchas

- The lane runs Electron with `--use-mock-keychain`, so the seal there never touches the login Keychain. The real-Keychain proof is a separate lane-only run, not this journey.
- The seed writes the Graph token as a legacy `secrets` row on purpose: the journey proves the boot migration moves it.
