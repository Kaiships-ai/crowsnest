# Connectors and keychain secrets

Each outside source is a connector: a manifest (id, label, auth kind, the secrets it needs, the ledger counts it feeds) plus an adapter (test connection, pull). `src/server/connectors/registry.ts` finds every folder under `src/server/connectors/` on its own. Secrets are sealed by the macOS Keychain through Orca's `SecretStore`; on boot a legacy plaintext `secrets` row moves to `sealed_secrets`. Architecture: `documents/architecture/connectors.md`.

## Sub-features

- Bridge `listConnectors`: every connector, its status (`configured`, `needs-setup`, `not-connected`) and where each secret comes from (`keychain`, `db`, `env`, `none`), never a value.
- Bridge `testConnector(id)`: the adapter's connection check; a manifest-only connector answers not connected.
- Boot migration: legacy rows move to the keychain, a failed move keeps the row and logs `secrets.keychain_move_failed`.

## How to get to it (user POV)

The Vault board shows it: "+" in the tab bar, Vault. See [boards.md](boards.md) and journey `vault-01`.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh connectors-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
.claude/skills/verify/scripts/keychain-lane.sh   # real login Keychain, lane-only item, deleted after
```

`connectors-01` prints `ok: the bridge lists every connector with its state`, `ok: the seeded Graph token moved to the keychain on boot and no value crosses the bridge`, `ok: the lane DB holds no plaintext secret`, `ok: a manifest-only connector is never called`, and saves `connectors-01.png`. It reads the lane DB with `sqlite3` from the user data dir `app-up.sh` printed.

## Gotchas

- The lane runs Electron with `--use-mock-keychain`, so the seal there never touches the login Keychain. The real-Keychain proof is `keychain-lane.sh`: it bundles `src/server/secrets/store.ts` into an Electron main named `lead-studio-lane-<pid>`, migrates a legacy row on a throwaway DB in the gitignored verify data folder, checks the `.dump` holds no plaintext, and deletes the `lead-studio-lane-<pid> Safe Storage` item on exit. It refuses to run if that item already exists.
- The seed writes the Graph token as a legacy `secrets` row on purpose: the journey proves the boot migration moves it.
