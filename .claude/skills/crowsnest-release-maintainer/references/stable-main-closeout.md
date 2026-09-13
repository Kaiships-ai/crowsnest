# Main closeout

This gate starts only after a stable publication. It is a narrow shipped-state
closeout, not permission to heal broader `main`. A stable release is not complete
until `main` carries the actual shipped release state.

1. Start from fresh latest `main`. Use a same-repository PR targeting `main`,
   with branch `release/<version>-main-closeout` and title
   `chore(release): close out <version> on main`. `<version>` is the published
   stable `YYYY.M.PATCH` (or `YYYY.M.PATCH-N` correction) without the `v` prefix.
   Audit the `release/YYYY.M.PATCH` branch against `main` and forward-port only
   the real fixes that are absent from `main`. Do not blindly merge release-only
   test or validation adapters into newer `main`.
2. Set `main` to the shipped version, not a speculative next train. Run
   `scripts/release-prep.sh` only if you need the version bump plus changelog
   sync; otherwise apply the version change and changelog directly and keep the
   working tree clean.
3. Make `packaging/CHANGELOG.md` on `main` match the tagged release under the
   shipped `## <version>` heading. If `main` already carries an approved notes
   section for this version, preserve that prose and verify it matches the shipped
   accounting; do not overwrite it with regenerated notes. Leave other release
   entries unchanged.
4. Do not add `YYYY.M.PATCH+1`, a beta version, or an empty future changelog
   section to `main` until the operator explicitly starts that next release
   train.
5. Run the full local gate before pushing: `npm run build`, `npm run test`,
   `npm run lint`, `npm run typecheck`, and keep the working tree clean. Push,
   then verify `origin/main` contains the shipped version and changelog before
   calling the release done.

crowsnest has no immutable closeout manifest, rollback-drill variables, or app
asset attachments like the upstream project. TODO: wire a closeout evidence
record if the release ever needs a machine-readable shipped-state snapshot.
Because there are no native app assets, there is no `apps: pending` or appcast
state to track; the closeout is complete when `main` shows the shipped version
and changelog and the R2 artifacts are verified.
