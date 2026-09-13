---
name: crowsnest-update
description: Route routine updates of an installed crowsnest Kit through its installation owner, with best-effort recovery. Trigger:/crowsnest-update
disable-model-invocation: true
---

# Update crowsnest

Use for general requests to update an existing crowsnest install. Select the existing update path; do not create another deployer or scheduler. Release validation, publication, first installs, and the dev repo are outside this workflow.

## Resolve the owner

Identify the host, runtime user, state root (`~/.kai/state`), service (`com.crowsnest.server`), the running version dir under `~/.kai/app`, and the update owner from live inspection. The current repository or shell may belong to another install or to the dev checkout. Keep license keys and buyer state out of public artifacts.

Read the owner state and choose the matching path:

| Installation | Update path |
| --- | --- |
| Buyer Kit under `~/.kai` (bundle) | `kai update` re-runs the installer, which downloads the latest per-platform tarball, verifies its baked sha256 and byte size, flips `~/.kai/app/current`, then spawns a fresh `kai _postupdate` (db migrate, restart if it was running). Owner: `src/cli/kai.ts` `cmdUpdate`/`cmdPostUpdate`, `packaging/install.sh.template`. |
| Dev repo (source checkout) | `kai update` refuses ("for installed builds, not the dev repo"). Update with `git pull` on `main`, then `npm ci` and `npm run db:migrate` as needed. |
| Managed / other deployments | The deployment-specific runbook and existing owner. Do not apply the Kit installer inside a separately managed release. |

Follow the selected path's commands, backup/migration requirements, recovery, and cleanup. Do not mutate files a live server is using, or overwrite a dirty dev checkout.

"Latest" preserves the buyer's release channel. Report the actual serving version after the flip. Do not auto-accept an unapproved downgrade; a downgrade whose `drizzle/` migration set differs is refused by `kai rollback` because the database would be left on a schema the older code does not expect.

## Updates always work

`kai update` finishes best-effort on every install and never strands the buyer: on any failure the current version is untouched (the installer only flips `current` after a verified download), so a failed update is a safe no-op the buyer can retry.

The installer already on disk (baked `install.sh` in R2 plus the current version's `kai` binary) is what runs an update. You cannot fix an update bug by editing the installer or `kai.ts` in the repo, because the buyer runs the copy they already have. A fix ships in a new release and only helps the update after the one that carries it. So new-version code must key on markers already shipped by older installers: the cached key at `~/.kai/state/entitlement.json`, the `~/.kai/app/current` symlink, the `vX.Y.Z` version-dir layout, and the `drizzle/` migration set. Never assume a marker a past installer did not write.

## Interruption and recovery

An update includes a routine restart of the managed server. Eligible sessions resume automatically after `kai _postupdate` restarts a server that was running; do not ask again solely because work is active. Use the owner's graceful path. Do not kill the server to manufacture idleness or manually replay recovered work. If the owner lacks controlled interruption, report or repair that gap within scope; do not invent force flags.

## Verify

Prove the intended version is serving: check `~/.kai/app/current` resolves to the expected `vX.Y.Z`, `kai status` is healthy, migrations applied cleanly, and the app answers through its real ingress. A finished download or a healthy old process is not completion. Report the serving version and any remaining issues.
