# kit: backlog to enhance

Bugs and enhancements for kit. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| KIT-1 | `kai kit init` saves an empty `IG_PASSWORD` on a real terminal, killing Instagram sync for every interactive install | high | bug | evidence/10-onboarding-bugs.md | done |
| KIT-2 | `kai kit init` echoes `ANTHROPIC_API_KEY` in plaintext on a real terminal instead of masking it | medium | bug | evidence/10-onboarding-bugs.md | done |
| KIT-3 | `kai update`'s default install URL points at a custom domain (`get.crowsnest.sh`) that is not set up; the live URL is the raw `workers.dev` subdomain | medium | bug | packaging-and-release.md | done |
| KIT-4 | The installer reads the cached license key from `~/.kai/state/entitlement.json`, but `kai login` writes it to `~/.kai/entitlement.json`, so update-path key reuse may not find it | medium | bug | code-review | done |
| KIT-5 | The cached entitlement file is trusted on shape alone, with no signature or live re-check, so every license-gated command after the first `kai login` is enforced against a local file rather than a fresh Polar answer | low | gap | code-review | open |
