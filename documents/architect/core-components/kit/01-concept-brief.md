# kit: concept brief

Install, license, and the kai CLI. How a buyer gets crowsnest onto their Mac.

## What it is

The Kit is the buyer facing distribution of crowsnest: a single downloadable tarball
(`crowsnest-v<version>-darwin-arm64.tar.gz`) plus a `kai` command line tool that installs,
licenses, updates, and runs the whole product on a buyer's own Mac. The buyer's whole
install experience is three commands:

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

No Node, Python, git, Xcode, or Homebrew is required on the buyer's machine; the bundle
carries pinned copies of node, python-build-standalone, and uv (versions recorded in
`packaging/platforms.json`). `kai kit init` is the step where the buyer's own credentials
go in (Instagram login, the Anthropic API key), and `kai up` starts the app and opens the
dashboard in a browser. Apple Silicon only for v1; `install.sh` refuses a real Intel Mac
with a refund pointer.

## Why it exists

crowsnest is sold as a one-time purchase that runs on the buyer's own machine, not a
hosted service. Two things follow from that. First, the install has to work for someone
who is not a developer, so it cannot assume any tooling is already present; the Kit exists
to make "curl, paste a key, `kai up`" the entire install path. Second, a downloadable
product needs a real gate against sharing a link: the tarball in R2 is never public, and
`install.sh` can only get a working download URL by presenting a license key that a
Cloudflare Worker validates against Polar first.

## Boundaries

The Kit owns getting the app, the database, and the Instagram sync sidecar onto disk,
licensed, configured, and running as background services, plus the day two operations of
`kai status`, `kai doctor`, and `kai update`. It does not own what the product does once it
is running. `kai kit init` collects the buyer's environment (Instagram credentials, the
Anthropic API key, the vault path) and creates the database, then hands off to
`kai up`; everything the user sees and does after the dashboard opens belongs to the
[onboarding](../onboarding/01-concept-brief.md) flow and the rest of the app, not to this
component.

The CLI surface is `kai login`, `kai status`, `kai kit init`, `kai up`, `kai start`,
`kai stop`, `kai doctor`, and `kai update`. Buyer state, database, config, and media, lives
at `~/.kai/state` outside the versioned install directory, symlinked into each version so an
update preserves it. The only platform Kit ships today is macOS on Apple Silicon; the only
macOS specific code is `src/cli/service-darwin.ts`, kept behind a small interface so another
platform is a new sibling module rather than edits scattered across the CLI.
