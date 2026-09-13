# Cleanup and report approval

When the tester says `finish validation`:

1. If readiness is verified, read the worksheet and ask only for a missing
   promotion vote or final feedback. If readiness was blocked, do not read a
   worksheet: use the recorded candidate identity and the blocking build finding,
   then ask only for missing promotion feedback.
2. Collect a small **Test environment** profile for the visible report. Include
   only the OS name and version, CPU architecture, logical core count, and memory
   rounded to the nearest whole GiB, plus the node and npm versions used to build.
   Read each value with a narrow command; omit an unavailable value rather than
   collecting a broader profile. Never read the hostname, username, device serial,
   network addresses, or raw command output.
3. If local diagnostics were active, stop the candidate first so its logs flush,
   then read only the private `telemetry/` files. Follow the redaction rules in
   [local diagnostics](local-diagnostics.md): at most three short corroborating
   snippets, label them **Local telemetry evidence** below the finding, and keep
   them out of any hidden payload.
4. Tear down the isolated build: remove the run-owned checkout, its disposable
   `HOME`, and the disposable data directory once no command is using them. Never
   mutate the tester's real state. If the tester's IG session or database was
   copied in, follow the restoration plan agreed when it was copied.
5. Assign exactly one terminal result, in this precedence:
   - **Candidate failed:** any functional or readiness failure.
   - **Candidate passed, but cleanup failed:** behavior passed but teardown did
     not complete. Record the detail privately, not in the public report.
   - **Candidate passed with presentation warnings:** behavior and cleanup
     passed, but a non-blocking visual, wording, or output-format warning was
     reported.
   - **Fully clean completion:** behavior passed, cleanup completed, no warnings.

   Candidate failure outranks cleanup failure, which outranks presentation
   warnings. Do not add a fifth label or collapse these into pass/fail. If there
   is neither a readiness failure nor a tester-authored surface result, say
   `Candidate not evaluated, no tester-authored result`, assign no terminal
   result, and stop after cleanup without a report or posting batch.
6. Complete each finding draft with the final sanitized evidence.
7. Synthesize one final report draft from the version and SHA, tested surfaces
   with non-empty notes, findings, tester feedback, and the promotion vote. List
   **Found but fixed** items with their verified fix URL. Begin with:

   ```md
   - Version: <version>
   - Tested commit: <full SHA>
   - Terminal result: <exact terminal result label>

   ## Test environment

   - OS: <name and version>
   - CPU: <architecture>, <logical core count> logical cores
   - Memory: <whole GiB> GiB
   - Build: node <version>, npm <version>
   ```

   Omit any unavailable value; do not substitute other device facts.
8. Sanitize the report: remove local paths, secrets, IG session tokens or account
   handles, user identifiers, raw logs, and setup or cleanup detail. Keep the
   allow-listed **Test environment** values.
9. If a structured payload is wanted for dashboards, read and apply the
   [structured report contract](structured-report.md) before opening the batch.
10. If a tooling packet exists or cleanup failed, read and apply
    [the tooling-feedback packet procedure](tooling-feedback.md); do not turn a
    tooling failure into a candidate finding.
11. Open the report and every issue or comment draft together and say:

    ```text
    I opened every proposed GitHub post for review. Nothing has been sent.
    Reply exactly `approve validation posts` to publish this batch, or tell me what to change.
    ```

    On edits, revise and reopen the same files. Never write to GitHub from
    `finish validation` alone.
12. On `approve validation posts`, re-read and privacy-check every file, publish
    each issue and comment, read each write back, insert the resulting URLs into
    the report, and post or update the campaign report comment when a campaign
    issue exists. Return the report URL and every finding URL.

This skill collects release feedback; it does not make the go/no-go decision.
