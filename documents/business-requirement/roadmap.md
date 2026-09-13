# Crowsnest roadmap

What shipped, what is planned next, and what is later. This is a summary; the detail behind
every open item lives in each component's own `05-backlog-to-enhance.md` under
`architect/core-components/`, and this document points at those rather than repeating their
rows. Per-release scope (what exactly ships in a given version) belongs in `brd/`, one file
per release; this page is the standing overview across releases.

## Shipped: v0.2, the Kit and the core loop

The whole core loop, feed to remix to a planned post, then a handoff through the MCP server to
Reel Factory, is running product, packaged for a buyer to install and run alone on their own Mac.

- **The core loop.** Feed and filters, the video detail page and analysis, save to vault and
  generate idea, the six-stage remix studio, and the calendar and plan dialog. The finished remix
  hands off through the MCP server to Reel Factory, which produces the video. See
  `brd/crowsnest/02-use-case.md` for the full flows.
- **The Kit.** One-command install, a Polar license gate checked before the tarball is served
  and again by size and checksum after download, and the `kai` CLI (`login`, `kit init`, `up`,
  `start`, `stop`, `status`, `doctor`, `update`). Background services run under launchd and
  survive a reboot. Apple Silicon only. See `packaging/CHANGELOG.md` and
  `architect/shared/packaging-and-release.md`.

## Planned: v0.3

Two threads are named for the next release. Neither is detailed here; each component's own
docs carry the depth.

- **The onboarding redesign.** First run setup (license, Instagram login, keys) is documented
  today only as a gate the shell redirects to until it is done; the setup steps themselves
  were out of scope for the product description. The onboarding component's backlog already
  carries the shape of the redesign (moving Instagram login and keys into the dashboard with
  live validation) and two live bugs found in testing. See
  `architect/core-components/onboarding/05-backlog-to-enhance.md`.
- **The bug board.** Every component's `05-backlog-to-enhance.md` holds its own open items;
  as of this writing that is one blocker (onboarding), and a further set of medium and low
  severity bugs spread across feed, remix, mine, analyze, and ig-sync. Working through
  that board, starting with the blocker, is v0.3's other thread. Run
  `scripts/plan-status.sh` (or the crowsnest-status skill) for the current count; this document
  does not carry a snapshot, because a committed count is the one thing every session would
  conflict on (`documents/index.md`).

## Later

Named because the packaging and scope material already states these as future, not because a
date is set for any of them.

- **Intel Macs, Windows, and Linux.** The Kit is Apple Silicon only in v0.2; `install.sh`
  refuses a non-arm64 machine with a refund pointer today. Adding Windows or Linux is scoped
  as one new platform-specific file each (a systemd unit, a Windows service), not a rewrite of
  the release pipeline. See `architect/shared/packaging-and-release.md`.
- **TikTok and YouTube Shorts ingestion.** Multi-platform tracking is out of v0.2; the
  filter chips for both platforms were removed from the shipped UI because the backend could
  not back them, a truth-pass fix rather than a feature cut. The `platform` column stays in
  the schema so a later platform is additive and needs no migration. See
  `architect/core-components/ig-sync/05-backlog-to-enhance.md` for the one open item this
  already tracks (the platform chips that shipped ahead of the backend).

Nothing in the product description suggests the core loop itself behaves differently on a
future platform or a second tracked source; the open work for both items above is entirely in
packaging, the install script, and the sidecar, not in the feed or remix.

Verified against this repo commit `4f26fb9`.
