# Tooling-feedback packet

Apply this procedure on the first tooling failure: git fetch or checkout,
`npm ci`, `npm run build`, copying the tester's state into the disposable
location, diagnostics setup, or cleanup. These are not candidate findings.

Copy [the tooling feedback asset](../assets/tooling-feedback.md) to
`.artifacts/crowsnest-release-validation/<version>-<timestamp>-tooling-feedback.md`.
Reuse the run's existing artifact timestamp when one exists. Update the same file
for later tooling failures; a run without a tooling failure has no packet.

Before every write, reduce the evidence to the minimum reproducible facts: the
release train or version, tested SHA when known, operating system and
architecture, relevant tool names and versions, failure stage, a sanitized
command shape with placeholders, expected behavior, a concise observed error
category, impact, and recovery state. Omit any field whose safe redaction is
uncertain.

Exclude credentials, tokens, usernames, hostnames, device identifiers, network
addresses, absolute paths, IG account handles or session tokens, raw config, raw
logs, and candidate feedback. Replace sensitive command arguments with
descriptive placeholders.

At closeout, refresh every failure's recovery state and set **Candidate result**
to the assigned terminal label, or to the applicable `Candidate not evaluated`
status when no candidate evaluation occurred. Replace every remaining template
placeholder, open the packet, and say:

```text
Optional tooling feedback: <absolute path>. Nothing was posted. You can review
this redacted packet and optionally report it to the named tooling project.
```

The packet is private optional-report material. Keep it out of the worksheet,
finding drafts, the report, any hidden payload, and the posting batch. Never post
it without a separate user request.

If tooling prevents candidate preparation and the tester ends validation, say
`Candidate not evaluated, tooling blocked preparation`, show the packet, and
stop. This is not a candidate terminal result. Produce no candidate report or
posting batch.
