# Crowsnest release-validation tooling feedback

> Private, redacted, optional-report packet. This is not candidate feedback and
> must never be posted automatically or included in the release campaign.

## Run context

- Version: {{VERSION}}
- Tested commit: {{CANDIDATE_SHA_OR_NOT_REACHED}}
- Candidate result: {{CANDIDATE_RESULT_OR_NOT_EVALUATED}}
- Platform: {{OS_AND_ARCHITECTURE}}
- Tool versions: {{RELEVANT_TOOL_VERSIONS}}

## Tooling findings

Repeat the following block for each distinct tooling failure (git fetch or
checkout, npm ci, npm run build, state copy, diagnostics setup, cleanup).

### {{SHORT_FAILURE_TITLE}}

- Tooling area: {{LIKELY_REPORT_TARGET}}
- Stage: {{FAILURE_STAGE}}
- Sanitized reproduction: `{{COMMAND_WITH_PLACEHOLDERS}}`
- Expected: {{EXPECTED_BEHAVIOR}}
- Observed: {{SANITIZED_OBSERVED_BEHAVIOR}}
- Impact: {{IMPACT_ON_VALIDATION}}
- Recovery state: {{RECOVERY_STATE}}

## Reporting choice

Nothing in this file has been posted. Review it before optionally reporting the
tooling issue to the area named above.
