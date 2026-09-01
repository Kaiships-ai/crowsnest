# crowsnest Kit changelog

Versions are the tag passed to `packaging/release.sh` and stamped into each bundle's VERSION
file (`kai doctor` prints it). Newest first.

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
