# Installed skill check

Not wired for crowsnest today. This is an adapted stub.

openclaw ran a `check-update.mjs` at the start of validation to compare the
installed skill copy (fetched from the ClawHub registry) against the canonical
published version and, when a newer one existed, offered to upgrade the skill
before validating. It then stopped the run so the fresh instructions would load
in a new task.

crowsnest skills live in-repo under `.claude/skills/` and are not published to a
registry, so there is nothing to check against and no update command to run. Skip
this step: there is no installed-skill update prompt.

TODO: wire an installed-skill check only if this skill is ever distributed
outside the repo. A separate, still-useful intent, confirming the built candidate
reports the expected release version so the tester is not validating a stale
build, is captured as a TODO in [local diagnostics](local-diagnostics.md).
