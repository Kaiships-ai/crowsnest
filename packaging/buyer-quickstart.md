# Buyer quickstart

Crowsnest is a Mac app you drive from your own AI agent. Crowsnest is the data and action
brain: it tracks Instagram channels, ranks outlier videos, analyzes them, and turns them into
drafts. Claude, Codex, or another agent is the reasoning brain: it reaches crowsnest over MCP
(Model Context Protocol) and does the thinking. The MCP flow is keyless, so no internal model
key of your own is needed anywhere in it.

This is the path from a fresh Mac to an agent that can call crowsnest.

## System requirements

- An Apple Silicon Mac (M1 or newer). The installer refuses an Intel Mac with a refund
  pointer, and crowsnest is macOS only for now.
- Free disk space for the download and its extraction. The installer checks and stops with the
  exact number if you are short.
- No Node, Python, git, Xcode, or Homebrew, and no `sudo`. The bundle carries its own runtimes
  under `~/.kai`.
- Your crowsnest license key, from your receipt.

## 1. Install crowsnest

Run the one-line installer. It prompts for your license key, verifies it, downloads the bundle,
and sets everything up under `~/.kai`.

```sh
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
```

If `~/.local/bin` was not already on your `PATH`, the installer adds it to your shell startup
file and tells you to open a new terminal so the `kai` command is found. When the installer
finishes it prints your next three commands, with your key already filled into the first.

## 2. Enter your license key

Claim an activation for this machine. This validates the key with Polar and caches the
entitlement at `~/.kai/state/entitlement.json`, so you only type the key once.

```sh
kai login <license-key>
```

A key is good for 2 activations (2 machines). If both are already in use, `kai login` says so,
and you deactivate one in the Polar customer portal, then run `kai login` again. Check the
cached state at any time with `kai status`.

## 3. Set up the kit

`kai kit init` writes your config, builds the local database, and then starts crowsnest and
registers MCP for you (steps 4 and 5 below run automatically at the end of init). Run `kai
login` first; init refuses to run without a cached license.

```sh
kai kit init
```

It asks two things:

- **Instagram account.** Use a throwaway account. The sidecar drives Instagram's private API,
  and accounts do get challenged or banned. If you give a username you are also asked for its
  password (not echoed to the screen). Leave the username blank to skip Instagram for now; the
  two must be set together or both left blank.
- **A sidecar token** is generated for you. You never type it.

Your answers are written to `.env.local` with owner-only permissions, since it holds the
Instagram password.

## 4. Start crowsnest

`kai kit init` already ran this, but you use it every time you want crowsnest running again.

```sh
kai up
```

This starts the two background services (the dashboard server on port 3000 and the Instagram
helper on port 8765), waits for the dashboard, checks the sidecar's health, and opens
`http://localhost:3000` in your browser.

Stop and restart the services with `kai stop` and `kai start`, and see their state with `kai
status`.

## 5. Register MCP with your agent

`kai kit init` also ran this once. Run it again any time to re-register or to print config for a
client it cannot write to directly.

```sh
kai mcp
```

`kai mcp` first probes the MCP endpoint at `http://localhost:3000/api/mcp` so you know it is
answering, then:

- **Claude Code.** Registered through the `claude` CLI at user scope (global, not tied to a
  folder), if `claude` is on your `PATH`. The manual form is also printed:
  `claude mcp add crowsnest --scope user --transport http http://localhost:3000/api/mcp`.
- **Codex.** Registered by writing an `[mcp_servers.crowsnest]` entry into `~/.codex/config.toml`.
- **Claude Desktop.** Config is printed for you to paste into
  `~/Library/Application Support/Claude/claude_desktop_config.json`. Claude Desktop cannot dial
  a raw HTTP MCP server, so the printed config uses the `mcp-remote` stdio shim.
- **Any other MCP client.** A generic streamable-HTTP config block is printed to paste into
  that client's own config.

To print all of the above without registering anything, run `kai mcp print`.

Restart your MCP client after registering so it picks up the new server.

## 6. Your first MCP call

With crowsnest running and your client restarted, ask your agent to make a read call. Two good
first calls:

- "Call the crowsnest_ig_status tool and tell me if the Instagram sidecar is ready." This
  confirms the endpoint answers and reports whether the sidecar is reachable and logged in.
- "Call crowsnest_channels and list the channels crowsnest is tracking." This returns the
  channels you plan from.

If the agent gets a result, the reasoning brain is now wired to the data brain. The full tool
surface is in [MCP tool reference](../documents/architecture/mcp.md).

## Troubleshooting

`kai doctor` runs a local health check and prints an `OK` or `!!` line for each of these:

- **version** and **mode**: which build this is, and whether it is a bundle or the dev repo.
- **native modules**: whether the prebuilt `better-sqlite3` loads on this machine.
- **python sidecar**: whether the Instagram helper's virtual environment exists and imports.
  If it is missing, rerun `kai kit init`.
- **config**: whether `.env.local` exists, and whether the Instagram username and password are
  correctly paired (both set, or both blank).
- **license**: whether an entitlement is cached. If not, run `kai login`.
- **services**: whether each background service is running or stopped.
- **sidecar health**: whether the running Instagram sidecar answers its health check. If it
  does not, see the output of `kai up` or the sidecar log.
- **mcp endpoint**: whether `http://localhost:3000/api/mcp` answers a tool listing. If the
  server is stopped, start it with `kai up`, then run `kai mcp`.

### Recovery

- **Update to the latest version:** `kai update`. It re-runs the installer, downloads the latest
  build, and reuses your cached license key, so you never retype it. Your database, config, and
  media are preserved across the update.
- **Roll back:** `kai rollback`. It reverts to the previously installed version. It refuses when
  the two versions' database migrations differ, because rolling back then would leave the
  database on a schema the older code does not expect.
