# Crowsnest release validation

## Run identity

- Version: {{VERSION}}
- Tested commit: {{CANDIDATE_SHA}}
- Isolation mode: isolated checkout at the candidate SHA
- Source version: {{SOURCE_VERSION}}
- Source commit: {{SOURCE_COMMIT}}
- Campaign issue: {{ISSUE_URL}}
- Build result: pending
- Terminal result: pending

## Build findings

> Populated by the agent with candidate problems observed while building or
> starting the isolated checkout (npm ci, npm run build, first start). git,
> mktemp, disk, and other setup plumbing problems are tooling failures, not
> release findings.

- None yet.

## Surfaces

> One row per surface. **What changed** and **Recommended testing** are guidance.
> **Testing notes** is the only evidence: a surface counts as tested only when
> your notes appear there. Escape table pipes and use `<br>` between notes.
> Replace {{CROWSNEST}} with the command that invokes the candidate build and
> {{RESTART}} with its restart command.

### Dashboard and onboarding

| **What changed**        | {{DASHBOARD_CHANGE}}                                     |
| ----------------------- | ------------------------------------------------------- |
| **Recommended testing** | {{DASHBOARD_TEST}}                                       |
| **Testing notes**       |                                                         |

### Instagram connect and session

| **What changed**        | {{IG_CHANGE}}                                           |
| ----------------------- | ------------------------------------------------------- |
| **Recommended testing** | {{IG_TEST}}                                             |
| **Testing notes**       |                                                         |

### Transcription and MCP

| **What changed**        | {{TRANSCRIPTION_CHANGE}}                                |
| ----------------------- | ------------------------------------------------------- |
| **Recommended testing** | {{TRANSCRIPTION_TEST}}                                  |
| **Testing notes**       |                                                         |

### Kit installer

| **What changed**        | {{KIT_CHANGE}}                                          |
| ----------------------- | ------------------------------------------------------- |
| **Recommended testing** | {{KIT_TEST}}                                            |
| **Testing notes**       |                                                         |

### Database migration and backup

| **What changed**        | {{DB_CHANGE}}                                           |
| ----------------------- | ------------------------------------------------------- |
| **Recommended testing** | {{DB_TEST}}                                             |
| **Testing notes**       |                                                         |

## Additional surfaces tested

> The agent adds a section here only when you test a surface not already listed.

## Final feedback

- Overall feedback:
- Polished enough to promote: yes / no
