# crowsnest packaging

Turns the repo into a buyer-installable Kit. One tarball per platform, hosted on Cloudflare
R2, gated by the buyer's Polar license key, installed with one curl command.

## What is here

```
platforms.json        runtime pins (node, python-build-standalone, uv) per platform
build-bundle.sh       builds and self-tests one tarball
install.sh.template   the buyer installer, with __PLACEHOLDER__ tokens
gen-install.sh        fills the template with a release's version, sha256, size
release.sh            build + gen + upload to R2, one command
worker/               the download gate (Cloudflare Worker)
```

## Buyer flow

```
curl -fsSL https://get.crowsnest.sh/install.sh | sh
kai login KSA-XXXX
kai kit init
kai up
```

No Node, Python, git, Xcode, or Homebrew needed. Apple Silicon only for v1.

## How the gate works

The tarball in R2 is never public. `install.sh` POSTs the license key to the Worker, which
validates it against Polar (validate only, so it never burns an activation slot), then
returns a link backed by a 15 minute HMAC token. Only a valid, current key gets a working
download. The sha256 and byte size are baked into `install.sh` itself, so even a compromised
Worker or bucket cannot serve a tampered tarball that verifies.

## One-time setup (needs a Cloudflare account)

```
cd packaging/worker
npm install
wrangler login
wrangler r2 bucket create crowsnest-releases
wrangler secret put TOKEN_SECRET        # paste any long random string
npm run deploy                          # deploys the gate, prints its URL
```

Point `get.crowsnest.sh` (or any domain) at the Worker, and set `GATE_URL` / `INSTALL_URL`
in the installer to match (they default to https://get.crowsnest.sh).

Set the Polar org id and API host in `worker/wrangler.toml` under `[vars]`. Use the sandbox
values while testing.

## Cutting a release

```
packaging/release.sh 0.2.0
```

Builds the bundle, bakes `install.sh`, uploads the tarball + `install.sh` + `latest.json`
to R2. A buyer's `kai update` re-runs the installer and picks up the new version, preserving
their db and config.

## Adding a platform later

Add a key to `platforms.json` (its node, python, uv pins and wheel tag), add a wheelhouse
build for it, and run `release.sh 0.2.0 <platform>`. The installer and CI both read the same
file, so no script changes. The only macOS-specific code is `src/cli/service-darwin.ts`;
another OS gets a sibling module behind the same shape.
