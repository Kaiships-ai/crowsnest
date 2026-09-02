# kit: concept brief

`documents/architect/core-components/kit/`

Status: shipped and installable, blocked for a live Instagram sync by an onboarding bug that writes an empty IG_PASSWORD.

## 1. What it is

The Kit is the buyer facing distribution of crowsnest: a single downloadable tarball (`crowsnest-v<version>-darwin-arm64.tar.gz`) plus a `kai` command line tool that installs, licenses, configures, updates, and runs the whole product on a buyer's own Mac. The buyer's whole install experience is four lines.

```
curl -fsSL https://crowsnest-gate.kaiships.workers.dev/install.sh | sh
kai login <KSA-key>
kai kit init
kai up
```

No Node, Python, git, Xcode, or Homebrew is required on the buyer's machine, and no sudo. The bundle carries pinned copies of node, python build standalone, and uv, with versions recorded in `packaging/platforms.json`. `kai kit init` is the step where the buyer's own credentials go in (Instagram login, the Anthropic API key), and it hands off to `kai up`, which starts the app and opens the dashboard in a browser. Apple Silicon only for v1; `install.sh` refuses a real Intel Mac with a refund pointer.

## 2. Why it exists

crowsnest is sold as a one time purchase that runs on the buyer's own machine, not a hosted service. Two things follow from that. First, the install has to work for someone who is not a developer, so it cannot assume any tooling is already present; the Kit exists to make curl, paste a key, `kai up` the entire install path, with the app's own runtime bundled rather than expected on the host. Second, a downloadable product needs a real gate against sharing a link: the tarball in R2 is never public, and `install.sh` can only get a working download URL by presenting a license key that a Cloudflare Worker validates against Polar first.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Entitlement | The cached proof that a license key is active on this machine (`key`, `activation_id`, `customer_id`, `validated_at`), written to `~/.kai/entitlement.json` at mode 0600 by `kai login`. Every later license gated command reads this file instead of calling Polar again. |
| Activation | A Polar concept: claiming one of a license's two machine slots. `kai login` is the only command that spends one; the download gate validates a key without activating it. |
| Gate worker | The Cloudflare Worker (`crowsnest-gate.kaiships.workers.dev`, `packaging/worker/`) that serves the public `install.sh`, validates a license key against Polar, and mints a short lived signed URL for the private R2 tarball. It never activates a key. |
| Download token | The 15 minute HMAC signed token the gate worker mints for one tarball object; `GET /dl?token=...` streams the bytes from R2 through the token, not through any AWS style access key. |
| Version directory and current symlink | Each install lands at `~/.kai/app/v<version>`; `~/.kai/app/current` is a symlink flipped to the newest good version once extraction finishes, so a killed install never leaves a half extracted tree live. |
| Buyer state | `~/.kai/state`, holding the database, `.env.local`, and media, symlinked into whichever version directory is `current`. This is what lets `kai update` swap versions without touching the buyer's data. |
| Runtime pins | `packaging/platforms.json`, the one file that records the exact node, python build standalone, and uv versions bundled per platform; CI and the installer template both read it. |
| LaunchAgent | The macOS mechanism (`src/cli/service-darwin.ts`) that keeps the Next.js server and the Instagram sidecar running across a reboot or a closed terminal, set `RunAtLoad` and `KeepAlive`. |

## 4. How it fits in the system

The Kit sits in front of every other component: nothing else in crowsnest runs until the Kit has put the app on disk, proven a license, written `.env.local`, and created the database. `kai kit init` calls the same migration and bootstrap scripts the dev repo uses, then hands off to `kai up`, which is the last thing the Kit does before the rest of the app takes over; everything the buyer sees after the dashboard opens belongs to [onboarding](../onboarding/01-concept-brief.md) and the rest of the app, not to this component. The Kit's own two long lived services, the Next.js server and the Instagram sidecar, are the runtime that every other component depends on being up; if either fails to start, that failure is visible only through `kai status` and `kai doctor`, not through anything in the app's own UI.

## 5. Dependency map

### Upstream (what the Kit depends on)

| Dependency | Why |
| --- | --- |
| Polar (`api.polar.sh`, org `ef96ed5d-6721-403c-98a8-184d43d13334`) | The license source of truth: activation, validation, and the customer portal's two machine slot limit. |
| Cloudflare Workers and R2 | The gate worker and the private `crowsnest-releases` bucket that hold the tarball, `install.sh`, and `latest.json`. |
| GitHub Actions (`macos-15` runner) | Builds and uploads a release on a `git tag v<version>` push. |
| `packaging/platforms.json` | The one file naming the exact node, python build standalone, and uv versions to bundle. |
| launchd (macOS) | Keeps the Next.js server and the Instagram sidecar running across a reboot; see `src/cli/service-darwin.ts`. |

### Downstream (what depends on the Kit)

| Consumer | What it reads or relies on |
| --- | --- |
| Every other component | Needs the Kit to have installed, licensed, configured, and started the Next.js server before any of it can run. |
| ig-sync | Needs the Kit to have started the Instagram sidecar service and written valid `IG_USERNAME`/`IG_PASSWORD`/`IG_SERVICE_TOKEN` values into `.env.local`. |
| onboarding | Starts only after `kai kit init` hands off to `kai up` and the dashboard opens. |
| Anthropic hosted analysis paths | Need the `ANTHROPIC_API_KEY` value the Kit optionally wrote during `kit init`. |

### External

| Dependency | Role |
| --- | --- |
| Polar | License activation, validation, and the customer portal buyers manage their key from. |
| Cloudflare Workers, R2, KV | The gate worker's runtime, the tarball's private storage, and an optional per key rate limit store. |
| GitHub Actions | Builds the release bundle and runs the release workflow. |
| node, python build standalone, uv | Pinned runtimes bundled into the tarball so the buyer's machine needs none of them preinstalled. |

## 6. Boundaries

The Kit owns getting the app, the database, and the Instagram sync sidecar onto disk, licensed, configured, and running as background services, plus the day two operations of `kai status`, `kai doctor`, and `kai update`. It does not own what the product does once it is running: `kai kit init` collects the buyer's environment (Instagram credentials, the Anthropic API key, the vault path) and creates the database, then hands off to `kai up`; everything the user sees and does after the dashboard opens belongs to [onboarding](../onboarding/01-concept-brief.md) and the rest of the app, not to this component.

The CLI surface is `kai login`, `kai status`, `kai kit init`, `kai up`, `kai start`, `kai stop`, `kai doctor`, and `kai update`. Buyer state (database, config, media) lives at `~/.kai/state`, outside the versioned install directory, symlinked into each version so an update preserves it. The only platform the Kit ships today is macOS on Apple Silicon; the only macOS specific code is `src/cli/service-darwin.ts`, kept behind a small interface (`services`, `start`, `stop`, `running`, `installed`) so another platform is a new sibling module rather than edits scattered across the CLI.
