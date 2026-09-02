# E2 workspace out of the vault spec

Status: draft, awaiting Kai's wireframe approval before build.
Roadmap: E2 is step 3 of 4 (E1 harness, D1 create-run tracking, E2 workspace out of vault, E3 commands and skills into Crowsnest).

## Goal

Move the studio workspace off the vault's disk and into Crowsnest's own `data/` tree. Today every sandbox and every render is written under `VAULT_PATH/Studio/workspace`. E2 moves them to `data/workspace`, the same local-data convention the repo already uses for the sqlite db and media.

## Non-goals

- No change to what the cook does or how it is spawned. That is E1 and E3.
- No plugin dir, no command move, no brief.md. That is E3.

## Current state (grounded)

- `src/server/studio/paths.ts:11` computes the workspace root as `path.join(config.VAULT_PATH, "Studio", "workspace")`. `sandboxDir(slug)` is `<workspace>/videos/<slug>` (`paths.ts:13-15`); `rendersDir(dateISO, slug)` is `<workspace>/renders/<dateISO>-<slug>` (`paths.ts:17-19`).
- `src/server/terminal/render-watch.ts:13-15` recomputes its own renders root inline as `path.join(config.VAULT_PATH, "Studio", "workspace", "renders")`. It does not import `rendersDir`.
- Only two writers touch the workspace: the cook, via `sandboxDir(slug)` and `mkdirSync` at `ws.ts:52-55` (the pty cwd), and the render watcher, via `mkdirSync(rendersRoot())` at `render-watch.ts:32`.
- `rendersDir` has no production caller; only `paths.test.ts:12` asserts it.
- `ws.ts:47` guards `if (!existsSync(config.VAULT_PATH))` before creating the sandbox.
- The repo already roots local data under `data/`: `CROWSNEST_DB_PATH` default `data/crowsnest.db` (`config.ts:86`), `MEDIA_ROOT` default `data/media` (`config.ts:58`), plus `data/9router.pid`, `data/sidecar.pid`, `data/tmp`. These resolve from the process cwd, not from the vault.
- Tests that assert the vault workspace path: `paths.test.ts:11-12` (mocks `VAULT_PATH: "/vault"`), `render-watch.test.ts:7,10` (its own root helper and a `VAULT_PATH` mock), `ws.test.ts:46,74` (mocks `VAULT_PATH`, asserts cwd is `sandboxDir(slugify("My Great Post"))`).

## What E2 builds

### 1. A workspace root off the vault

Add a config value for the workspace root, defaulting to `data/workspace`, matching the `MEDIA_ROOT`/`CROWSNEST_DB_PATH` pattern in `config.ts`. Call it `WORKSPACE_ROOT` (final name settled in the plan).

### 2. Repoint the path helpers

- `paths.ts` `workspace()` roots from `config.WORKSPACE_ROOT` instead of `path.join(config.VAULT_PATH, "Studio", "workspace")`. `sandboxDir` and `rendersDir` keep their `videos/<slug>` and `renders/<dateISO>-<slug>` shapes under the new root.
- `render-watch.ts` `rendersRoot()` roots from the same `config.WORKSPACE_ROOT` + `renders`. Better: have it call the shared helper from `paths.ts` instead of recomputing inline, so there is one source of truth. The plan decides whether to export a `rendersRoot()` from `paths.ts` and have render-watch import it.

### 3. Fix the vault-existence guard

`ws.ts:47` checks `existsSync(config.VAULT_PATH)` before creating the sandbox. After E2 the sandbox no longer lives in the vault, so this guard is about command discovery, not the sandbox path. See the dependency note below: until E3, the cook still needs the vault for the command, so the guard may stay, but its meaning changes. The plan settles whether the guard stays, moves, or is replaced by a workspace-root check.

### 4. Update the tests

`paths.test.ts`, `render-watch.test.ts`, and `ws.test.ts` mock `VAULT_PATH` and assert vault workspace paths. Update them to mock/assert the new `WORKSPACE_ROOT` path. The `ws.test.ts` cwd assertion at line 74 changes to the new sandbox path.

## Dependency on E3 (the ordering risk, read this)

Moving the sandbox out of the vault breaks the cook's command discovery. Today the cook finds `/ksa:cooking` only because its cwd (`sandboxDir`) is inside the vault, so claude walks up and loads the vault's `.claude/commands`. Once the sandbox is `data/workspace/videos/<slug>`, the walk-up never reaches the vault, and `/ksa:cooking` is gone. E3 is what restores the command via a Crowsnest plugin dir passed to the harness profile.

So E2 cannot ship alone without breaking the cook between E2 and E3. Two ways to handle it, to settle with Kai:

- Land E2 and E3 as one branch, so the command move and the sandbox move arrive together. Cleanest, but it makes E3 the real end of the workspace-separation work.
- Ship E2 with an interim bridge: keep command discovery pointed at the vault while the sandbox lives outside it, using the harness profile (for example `--add-dir VAULT_PATH` or an interim `--plugin-dir` at the vault's command location) until E3 replaces it with the Crowsnest plugin dir. This keeps the build order as four separate steps but adds throwaway wiring.

Recommendation: fold E2 into the E3 branch and treat "workspace out of the vault" and "commands into Crowsnest" as one landing, since the second is what makes the first safe. If Kai wants them separate, take the interim-bridge path and mark the bridge for removal in E3.

## Acceptance criteria

1. A cook writes its sandbox under `data/workspace/videos/<slug>`, not under the vault.
2. The render watcher polls `data/workspace/renders` and still captures a finished MP4, served at `/api/media/<id>`.
3. `paths.test.ts`, `render-watch.test.ts`, `ws.test.ts` pass against the new root.
4. With the E3 command move (or the interim bridge) in place, a full cook still runs end to end and finds `/ksa:cooking`.
5. Nothing writes under `VAULT_PATH/Studio/workspace` anymore (grep the running paths).

## Files touched (anticipated)

- `src/server/config.ts` (WORKSPACE_ROOT)
- `src/server/studio/paths.ts` (workspace root, maybe export rendersRoot)
- `src/server/terminal/render-watch.ts` (root from shared helper)
- `src/server/terminal/ws.ts` (the guard)
- `src/server/studio/paths.test.ts`, `src/server/terminal/render-watch.test.ts`, `src/server/terminal/ws.test.ts`
