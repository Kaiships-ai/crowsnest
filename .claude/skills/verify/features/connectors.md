# Connectors and keychain secrets

Each outside source is a connector: a manifest (id, label, auth kind, the secrets it needs, the ledger counts it feeds) plus an adapter (test connection, pull). `src/server/connectors/registry.ts` finds every folder under `src/server/connectors/` on its own. Secrets are sealed by the macOS Keychain through Orca's `SecretStore`; on boot a legacy plaintext `secrets` row moves to `sealed_secrets`. Architecture: `documents/architecture/connectors.md`.

## Sub-features

- Bridge `listConnectors`: every connector, its status (`configured`, `needs-setup`, `not-connected`) and where each secret comes from (`keychain`, `db`, `env`, `none`), never a value.
- Bridge `testConnector(id)`: the adapter's connection check; a manifest-only connector answers not connected.
- Boot migration: legacy rows move to the keychain, a failed move keeps the row and logs `secrets.keychain_move_failed`.
- Umami: four Vault secrets (`UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`), Kiểm tra logs in and finds the website, Kéo lại stores each VN day in `umami_days` and each plan keyword's `visits` and `emails` in `reel_funnel`, which Phễu's gift-page step and Kênh tôi's Web column read. A partial pull stores nothing.

## How to get to it (user POV)

The Vault board shows it: "+" in the tab bar, Vault. See [boards.md](boards.md) and journey `vault-01`.

## Driving it

```bash
.claude/skills/verify/scripts/app-up.sh --seed
.claude/skills/verify/scripts/app-drive.sh connectors-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
.claude/skills/verify/scripts/keychain-lane.sh   # real login Keychain, lane-only item, deleted after
```

`umami-01` runs on `boards-lane.sh`, which also starts `fake-umami.mjs` (login `lane-umami` / `lane-umami-pass`, website `lane-site`, events in pages of 3 spread over the asked window: four `own01` sessions, one of them `utm_source=verify`, and one with no utm; `POST /__fail?page=N` makes page N answer 503). Run it after `own-01`, which expects the seed's 18 visits. It prints `ok: Vault: Sửa saves the four Umami fields and the row leaves chưa nối`, `ok: Kiểm tra logs in to Umami and finds the website`, `ok: Kéo lại pulls every page, the row reads running, and the lane DB holds the day and OWN01's 4 visits and 2 emails` (`umami_days` shows 1 test session dropped, clean 4 and raw 5), `ok: Phễu: the gift-page step and OWN01's row show the pulled visits`, `ok: Kênh tôi: the Web column of the OWN01 reel shows 4`, `ok: a 503 on events page 2 makes Kéo lại read partial, and nothing new is stored`, and saves `umami-01-vault`, `umami-01-funnel`, `umami-01-own` and `umami-01-partial`.

```bash
.claude/skills/verify/scripts/boards-lane.sh
.claude/skills/verify/scripts/app-drive.sh umami-01 [run-id]
.claude/skills/verify/scripts/app-down.sh
```

`connectors-01` prints `ok: the bridge lists every connector with its state` (Polar and ChatbotX `not-connected`, Umami `needs-setup` or `configured`), `ok: the seeded Graph token moved to the keychain on boot and no value crosses the bridge`, `ok: the lane DB holds no plaintext secret`, `ok: a manifest-only connector is never called`, and saves `connectors-01.png`. It reads the lane DB with `sqlite3` from the user data dir `app-up.sh` printed.

## Gotchas

- The lane runs Electron with `--use-mock-keychain`, so the seal there never touches the login Keychain. The real-Keychain proof is `keychain-lane.sh`: it bundles `src/server/secrets/store.ts` into an Electron main named `lead-studio-lane-<pid>`, migrates a legacy row on a throwaway DB in the gitignored verify data folder, checks the `.dump` holds no plaintext, and deletes the `lead-studio-lane-<pid> Safe Storage` item on exit. It refuses to run if that item already exists.
- The seed writes the Graph token as a legacy `secrets` row on purpose: the journey proves the boot migration moves it.
- Running `umami-01` before `own-01` on the same lane makes `own-01` fail: the pull replaces the seed's 18 OWN01 visits with 4.
- A board tab is reused, so a rerun of `umami-01` finds the Vault editor open; the journey clicks Sửa only when it is closed.
