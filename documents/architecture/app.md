# App

Lead Studio is the Electron app crowsnest is becoming. It lives in `studio/`, not `app/`, because Next.js ignores `src/app` when a root `app/` directory exists. It is Orca (MIT, Lovecast Inc) brought in as a squashed `git subtree` from Orca commit `b46be798ed4`. It runs locally with `npm run studio` and is not packaged. Today it is Orca's workspace under a new identity: terminal, chat, browser tab, split panes and the agent table. Crowsnest boards and the server move into it in later steps.

## What it holds

The app keeps its state in its own user data dir, `~/Library/Application Support/lead-studio` in dev. The single-instance lock and the runtime CLI socket (`o-<pid>-*.sock`) live there, so they follow the dir. Nothing in it is crowsnest data yet. `data/crowsnest.db` stays with the Next.js server.

## Identity

| Key | Value | Where |
| --- | --- | --- |
| App id | `ai.kaiships.leadstudio` | `studio/config/electron-builder.config.cjs`, `studio/src/shared/local-build-compatibility-contract.json` |
| Product name and URL scheme | Lead Studio, `leadstudio://` | `studio/config/electron-builder.config.cjs` |
| Dev user data dir | `lead-studio` | `studio/src/main/startup/configure-process.ts`, `studio/src/cli/runtime/launch-user-data-path.ts`, `studio/config/scripts/orca-dev.mjs` |
| App name and keychain item | dev: Lead Studio Dev, `Lead Studio Dev Safe Storage`; packaged: Lead Studio | `studio/src/main/startup/dev-instance-identity.ts` |
| Dev Electron bundle | `ai.kaiships.leadstudio.dev`, Lead Studio Dev | `studio/config/scripts/dev-electron-bundle-identity.mjs` |
| Window title | Lead Studio | `studio/src/renderer/index.html`, `studio/src/main/window/createMainWindow.ts` |
| CLI command | `lead` (packaged, `/usr/local/bin/lead`), `lead-dev` (dev, the shim in `<user data>/cli/bin`) | `studio/package.json`, `studio/src/main/cli/cli-install-constants.ts`, `studio/src/main/runtime/orchestration/cli-command.ts` |
| Home dir | `~/.lead-studio`: agent hook scripts, keybindings, the hook install lock, API key and credential files | `studio/src/main/agent-hooks/installer-utils.ts`, `studio/src/main/agent-hooks/runtime-home-hook-command.ts`, `studio/src/main/keybindings/keybinding-file.ts` |

## Boundaries

- Orca code changes only in `studio/`. `git subtree pull --prefix studio --squash` brings upstream changes, so edits there stay small and named.
- The root toolchain (npm, eslint, tsc, vitest, `scripts/check-doc-paths.mjs`) skips `studio/`. `studio/` has its own pnpm install and tests.
- Agent config files that are not Orca's own, such as `~/.claude/settings.json`, are shared with Orca.app. Both apps write a managed hook entry there and each install replaces the other's entry, since the matcher keys on the script name, not its folder. Each entry runs its own app's script, and the script posts to the hook endpoint in the terminal's env, so a hook from either app still reaches the app that owns the terminal.
- Remote and WSL hosts keep Orca's `~/.orca` layout and the `orca` command there.

## Invariants

- Lead Studio never opens or writes the installed Orca.app profile, lock, socket, keychain item, `~/.orca` or `/usr/local/bin/orca`. Changing a value in the identity table must keep it distinct from Orca's. Lane 2 in `scripts/e2e/cases/app.md` checks that `~/.orca` is unchanged after `npm run studio`.
- Agents in a Lead Studio terminal run `lead-dev`, which reaches this instance through `ORCA_USER_DATA_PATH`. Dev mode is detected by `lead-studio` in that path (`studio/src/cli/handlers/orchestration/runtime-compatibility.ts`). Orca's bundled agent skill guides still say `orca`.

## Verify

The verify skill launches the app with Playwright `_electron.launch` and drives it with journeys. See `.claude/skills/verify/features/app-shell.md` and the cases in `scripts/e2e/cases/app.md`.
