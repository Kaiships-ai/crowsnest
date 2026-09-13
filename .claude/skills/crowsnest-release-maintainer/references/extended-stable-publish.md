# Extended-stable publication (not wired for crowsnest)

The upstream project publishes its `.33+` extended-stable line through a
dedicated sequence, separate from the regular release: a distinct channel
selector, its own validation profile, and a publication path that deliberately
creates no GitHub release and no app assets. It is only reached after the
extended-stable backport flow has landed its coordinated PR.

crowsnest has a single release path (`scripts/release-prep.sh` then
`.github/workflows/release.yml`, publishing to Cloudflare R2) and one channel
pointer (`latest.json`). There is no extended-stable line to publish. This
concept is NOT yet wired for crowsnest.

TODO: wire an extended-stable publication path only if crowsnest adopts a
maintenance line with its own channel pointer. It would need a separate channel
object (a second `latest.json` or a channel field), its own validation gate, and
would reuse the R2 upload rather than any registry dist-tag. Until then, use
[regular-release](regular-release.md) for every crowsnest release.
