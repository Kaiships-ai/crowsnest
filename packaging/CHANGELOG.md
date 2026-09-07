# crowsnest Kit changelog

Versions are the tag passed to `packaging/release.sh` and stamped into each bundle's VERSION
file (`kai doctor` prints it). Newest first.

## Unreleased

## 0.3.0 (release-ready, not yet published)

Mac-first, MCP-first. Crowsnest is the data and action brain reached over MCP; Claude,
Codex, or another agent is the reasoning brain. The core content workflow is keyless.

Buyer install and MCP
- `kai mcp` registers the MCP server with Claude Code (via its CLI) and Codex (via
  ~/.codex/config.toml), and prints config for Claude Desktop and any generic MCP client.
  `kai kit init` runs it at the end, so setup finishes with MCP wired up.
- `kai doctor` gains an MCP endpoint check (a real tools/list, not just a port probe).

MCP content machine
- New keyless, provenance-stamped persistence: `crowsnest_save_artifact` and
  `crowsnest_artifacts` cover angles, an outlier library, an idea bank (100+ ideas in one
  artifact), a Week 01 to 04 monthly plan, and briefs. The MCP surface is now 29 tools.
- The full flow runs over MCP plus the agent's own reasoning, with no internal API key.
  Retired the internal-model analyze and auto-analyze from the normal path (the in-app
  dashboard idea button remains an optional, key-gated convenience, off the MCP core path).

Multi-account sync (minimal, honest slice)
- Accounts have their own session, cooldown, and proxy or device identity (ig_accounts).
  Channels are assigned to an account stickily. The scheduler groups a sync by account and
  keeps one account's cooldown or failure from stopping the others. Minimal Settings UI to
  add, view, pause, resume, and remove accounts. Known limit: sync runs accounts
  sequentially with isolated per-account state; live bounded-parallel across accounts needs
  live per-account credentials and is the documented next step.

Dashboard and UI
- Dashboard rebuilt around the content-machine workflow: a next-action recommendation,
  data freshness and account health, research sources, highest-value outliers, and the
  content pipeline (the artifacts the agent persisted, with provenance). Analytics kept but
  demoted to a secondary section.
- Finished the radix-ui to base-ui migration and dropped the radix-ui dependency.

Removed
- Removed the in-app create studio (cook/serve) and its create_runs table; remixing now
  hands off to Reel Factory through the MCP server.

Migration notes
- Two additive schema migrations: 0028 (content_artifacts) and 0029 (ig_accounts plus a
  nullable channels.account_id). Both are additive; `kai update` runs them automatically and
  the single-account sync path is unchanged.

## 0.2.0

First packaged release. Apple Silicon only.

- One-command install: `curl -fsSL <gate>/install.sh | sh`. Bundles its own Node, Python,
  and uv, so a buyer installs nothing else.
- License gate: the key is validated against Polar before the tarball is served, and the
  tarball is verified by size and sha256 after download.
- Commands: `kai login`, `kai kit init`, `kai up`, `kai start`, `kai stop`, `kai status`,
  `kai doctor`, `kai update`.
- Background services run under launchd and survive reboot. The server binds loopback only,
  so no macOS firewall prompt.
- App source no longer hardcodes the build machine's home path (vault default, the claude
  binary, the watch script now resolve per user).
