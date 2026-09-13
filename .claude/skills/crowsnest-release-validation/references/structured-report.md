# Structured release report

Apply this contract only if a machine-readable payload is wanted for dashboards,
and only after the tester approves the complete posting batch. The visible
Markdown remains the human report; append one hidden payload so a dashboard can
consume the same evidence without parsing prose.

TODO: wire a consumer for this payload. crowsnest has no release-validation
dashboard today, so this contract is optional. If nothing consumes it, skip the
hidden payload and keep only the visible report from
[cleanup and report approval](report-closeout.md).

## Build the current run

Derive the payload from the sanitized worksheet and the approved finding drafts.
Turn each distinct tester observation into one finding: a positive check is
`pass`, candidate misbehavior is `problem`, useful neutral context is
`observation`. Include only surfaces with non-empty **Testing notes**. Do not
infer severity. The visible **Test environment** profile and the terminal result
label are visible metadata only and never enter the payload.

Append this envelope after the visible Markdown:

```md
<!-- crowsnest-release-validation-report:v2
<compact JSON object>
-->
```

The object has this shape:

```json
{
  "schemaVersion": 2,
  "kind": "crowsnest-release-validation-report",
  "campaign": {
    "train": "YYYY.M.PATCH"
  },
  "revision": 1,
  "updatedAt": "ISO-8601 timestamp",
  "currentRunId": "random UUID",
  "runs": [
    {
      "runId": "random UUID",
      "submittedAt": "ISO-8601 timestamp",
      "version": "candidate version",
      "testedCommit": "full tested SHA",
      "source": {
        "version": "privacy-safe source version",
        "commit": null
      },
      "build": {
        "result": "pass",
        "findings": []
      },
      "surfaces": [
        {
          "id": "dashboard",
          "name": "Dashboard",
          "findings": []
        }
      ],
      "overallFeedback": "tester feedback",
      "promotionVote": "yes"
    }
  ]
}
```

Allowed `build.result` values are `pass`, `problem`, `blocked`, and `unknown`.
Allowed `promotionVote` values are `yes`, `no`, and `unknown`. Use `null` for an
unknown source commit. Surface `id` values are the crowsnest surfaces (for
example `dashboard`, `ig-connect`, `transcription-mcp`, `kit-installer`,
`db-migrate-backup`); use `unmapped` when none fits.

Every `findings` item has:

```json
{
  "surfaceId": "ig-connect",
  "result": "problem",
  "summary": "Session lost after restart",
  "expected": "The connected session persists across restart",
  "observed": "A fresh connect was required",
  "disposition": "new_issue",
  "issueUrl": "https://github.com/Kaiships-ai/crowsnest/issues/123"
}
```

`surfaceId`, `result`, and `summary` are required. Omit `expected` and `observed`
when the tester did not provide them. For a problem, `disposition` is
`new_issue`, `existing_issue`, or `fixed`. A published finding requires its public
URL in `issueUrl`; a fixed finding instead requires `fixUrl`. Positive and
neutral observations omit disposition and URLs.

## Keep one payload per tester

When a campaign issue exists, resolve the authenticated login with `gh api user`,
find that login's comment carrying the exact v2 marker, and either create it with
`revision: 1` or append the current run and increment `revision`. Multiple
matches, invalid JSON, or a different train is a conflict: stop and show the URLs.

## Validate before publishing

The payload is public. No string may contain local paths, secrets, IG handles or
session tokens, user identifiers, raw logs, or setup and cleanup details.
Serialize compact JSON, escape `<`, `>`, and `&` inside strings as Unicode
escapes, and parse it back with `jq -e` before posting. After create or update,
read the comment back and require the visible Markdown, marker, JSON, run id,
version, tested SHA, finding URLs, and promotion vote to match exactly.
