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
| App name and keychain item | Lead Studio, `Lead Studio Safe Storage` | `studio/src/main/startup/dev-instance-identity.ts` |
| Dev Electron bundle | `ai.kaiships.leadstudio.dev`, Lead Studio | `studio/config/scripts/dev-electron-bundle-identity.mjs` |
| Window title | Lead Studio | `studio/src/renderer/index.html`, `studio/src/main/window/createMainWindow.ts` |
| Package bin | `lead` | `studio/package.json` |

## Boundaries

- Orca code changes only in `studio/`. `git subtree pull --prefix app --squash` brings upstream changes, so edits there stay small and named.
- The root toolchain (npm, eslint, tsc, vitest, `scripts/check-doc-paths.mjs`) skips `studio/`. `studio/` has its own pnpm install and tests.
- `~/.orca` is shared with an installed Orca.app, as upstream shares it between `pnpm dev` and the packaged app.

## Invariants

- Lead Studio never opens the installed Orca.app profile, lock, socket or keychain item. Changing a value in the identity table must keep it distinct from Orca's.
- The in-terminal agent CLI stays `orca-dev`; it resolves the running instance through `ORCA_USER_DATA_PATH`. Dev mode is detected by `lead-studio` in that path (`studio/src/cli/handlers/orchestration/runtime-compatibility.ts`).

## Verify

The verify skill launches the app with Playwright `_electron.launch` and drives it with journeys. See `.claude/skills/verify/features/app-shell.md` and the cases in `scripts/e2e/cases/app.md`.
