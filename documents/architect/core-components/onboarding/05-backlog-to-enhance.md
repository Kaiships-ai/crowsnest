# onboarding: backlog to enhance

Bugs and enhancements for onboarding. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ONB-1 | kai kit init saves IG_PASSWORD empty, so the IG sidecar crash-loops and sync is dead | blocker | bug | live test | done |
| ONB-2 | kai kit init echoes ANTHROPIC_API_KEY in plaintext during entry | medium | bug | live test | done |
| ENH-1 | Redesign the onboarding flow: move IG login and keys into the dashboard with live validation | high | enhancement | architecture review | done |
| ENH-2 | Dashboard AI status can read "routed through proxy" when generation actually fell back to direct Anthropic, since the badge derives from LLM_BASE_URL presence not live reachability | low | bug | code-review | open |
| ENH-3 | Settings Instagram section lets the session-token connect and the username/password submit run at once (no shared busy flag), unlike the first-run step which blocks both | low | enhancement | code-review | open |
| ENH-4 | Credentials login writes the secrets store twice on an immediate-ok result (the server action already persisted), and connect-step's challenge-failure branch clears credentialsPending but not the input fields | low | enhancement | code-review | open |
