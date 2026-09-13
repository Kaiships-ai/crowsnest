# Optional local diagnostics

Offer this step only after an isolated candidate build is ready. It is opt-in,
disposable-target-only, loopback-only, and content-off. It never runs against the
tester's real state.

openclaw captured OTLP telemetry through a Docker collector and an installed
diagnostics plugin. crowsnest has no such plugin and no Docker requirement.
Diagnostics here mean capturing the candidate's own logs and any local metrics it
already emits, written under the private worksheet's `telemetry/` directory.

Say:

```text
Optional local diagnostics can capture this candidate build's own logs and local
metrics into a private directory beside the worksheet. Nothing is sent anywhere,
content capture stays off, and you will review the exact report draft before any
GitHub post.

Reply exactly `enable local diagnostics` to enable it, or `skip local diagnostics` to continue without it.
```

Do nothing until the tester chooses. If they skip it, record no diagnostic state
and continue to the worksheet.

When they enable it:

1. Create a `telemetry/` directory beside the private worksheet artifact. It is
   private run data, never worksheet or GitHub content.
2. Point the candidate's log output at that directory (for example, redirect its
   stdout and stderr, or set its log path to a file under `telemetry/`). Do not
   enable any exporter that sends to a hosted or network endpoint. If a local
   metrics endpoint is used, bind it to loopback only.

Keep capture running only while the candidate is under test.

## Treat telemetry as unsafe source material

At closeout, select at most three short snippets that directly corroborate a
worksheet note or finding. A permitted snippet is only an aggregate count, a
known operation name, a status, or a low-cardinality error category. Never copy
raw log bodies, timestamps, paths, session or request identifiers, IG handles,
prompts, responses, or credentials. Telemetry can strengthen an existing finding
but cannot create a new one. If relevance or redaction is uncertain, omit it.

## Version-match check (TODO: wire)

openclaw shipped a `check-update.mjs` that verified the installed skill copy
matched the canonical published version before validating. crowsnest skills live
in-repo and are not published, so there is no equivalent check to run. The useful
intent, confirming the built candidate's reported version equals the expected
candidate version so the tester is not validating a stale build, is worth a small
diagnostic. TODO: wire a version-match check (compare the candidate build's
reported version against the expected release version) once crowsnest exposes a
stable version string from the build.
