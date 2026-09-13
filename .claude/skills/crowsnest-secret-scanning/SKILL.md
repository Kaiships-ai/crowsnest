---
name: crowsnest-secret-scanning
description: Scan the crowsnest repo and PRs for leaked secrets, then triage and remediate any findings. Trigger:/crowsnest-secret-scanning
disable-model-invocation: true
---

# crowsnest secret scanning

Detect leaked secrets in the repo and in PR diffs (license keys, Polar/Cloudflare tokens, provider API keys, session files), triage GitHub Secret Scanning alerts, and drive redaction, rotation, and cleanup.

TODO: port from openclaw-secret-scanning-maintainer. Map to crowsnest secrets (Polar license, R2/Cloudflare, 9router, IG session). Flesh out later.
