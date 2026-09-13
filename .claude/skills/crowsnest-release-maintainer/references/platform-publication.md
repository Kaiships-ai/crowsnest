# Platform publication (not wired for crowsnest)

The upstream project publishes native app assets (macOS with a Sparkle appcast,
a Windows Hub installer, and an Android APK) as independent tasks that run
alongside the npm and GitHub release without blocking it. Each platform has its
own signing, notarization, and promotion gates.

crowsnest ships one artifact: the `darwin-arm64` Kit bundle (a tarball plus
`install.sh`) published to Cloudflare R2 by `.github/workflows/release.yml`. It is
not a signed native app, there is no auto-updater feed or appcast, and there are
no Windows or Android assets. This concept is NOT yet wired for crowsnest.

TODO: wire a platform-publication reference only if crowsnest starts shipping a
signed native app, a code-signed installer, or an auto-update feed. Signing,
notarization, and a Sparkle-style appcast would each need their own gate and
credential contract. Until then, the Kit tarball and `install.sh` on R2 are the
whole distribution surface; see [regular-release](regular-release.md) and
[publication-recovery](publication-recovery.md).
