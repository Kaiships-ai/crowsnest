# Packaging and release operations

How the crowsnest Kit ships to buyers, and what is live. Apple Silicon only for v1.

## Buyer install

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

No Node, Python, git, Xcode, or Homebrew on the buyer machine. The bundle carries its own.

## What is live

- Gate worker: `crowsnest-gate.kaiships.workers.dev` (Cloudflare account `8745b6916d47f1b2411136b18c77333a`). Validates the license key against production Polar (`api.polar.sh`, org `ef96ed5d-6721-403c-98a8-184d43d13334`), then streams the tarball from R2 behind a 15 minute HMAC token. Validate only, so a download never spends an activation slot.
- R2 bucket: `crowsnest-releases`. Holds `install.sh`, `latest.json`, and `releases/v<version>/crowsnest-v<version>-darwin-arm64.tar.gz`.
- Merged: PR #31 (packaging + CLI), PR #32 (release CI). Both on main.

## Cutting a release

```
git tag v0.2.1 && git push origin v0.2.1
```

The `release` workflow (`.github/workflows/release.yml`) runs on a `macos-15` runner: builds the arm64 bundle, bakes `install.sh` with the fresh size and sha256, uploads the tarball, `install.sh`, and `latest.json` to R2. It refuses a version with no matching `## <version>` section in `packaging/CHANGELOG.md`.

## Secrets

- GitHub Actions repo secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers R2 Storage: Edit). Set them in the repo settings UI, not the CLI paste prompt, which mangles the value.
- Worker secret: `TOKEN_SECRET`, set with `wrangler secret put TOKEN_SECRET`. Signs the download tokens.

## Runtime pins

All in `packaging/platforms.json`, one key per platform: node 22.23.1, python-build-standalone 3.12.14, uv 0.12.8. Adding a platform is a new key plus its wheels, not a script change. The only macOS-specific code is `src/cli/service-darwin.ts`.

## CLI commands

`kai login`, `kai status`, `kai kit init`, `kai up`, `kai start`, `kai stop`, `kai doctor`, `kai update`. Buyer state (db, config, media) lives at `~/.kai/state` and is symlinked into each version dir, so updates preserve it.

## Open, not done

- IG sync and AI analysis are untested with real credentials. The buyer test left both blank.
- The keyless LLM path (no 9router proxy) is unverified. The app defaults `CLAUDE_MODEL` to `claude-sonnet-5`, which reaches the real Anthropic API, but a live analysis run has not confirmed it end to end.
- Intel Macs and Windows or Linux are future. install.sh refuses non-arm64 with a refund pointer.
- The install URL is the raw `workers.dev` subdomain. A custom domain (for example `get.crowsnest.sh`) is cosmetic and not set up.
