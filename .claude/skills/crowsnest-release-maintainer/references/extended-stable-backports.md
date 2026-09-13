# Extended-stable backport preparation (not wired for crowsnest)

The upstream project keeps an `extended-stable` maintenance line: the trailing
completed month's `.33+` patches, prepared as one coordinated PR from a
maintenance branch, covering the npm package and its plugins but excluding the
app, website, and GitHub releases. Its defining discipline is treating any
backport that changes the public SDK or configuration surface as a visible
maintenance-risk warning that needs an explicit maintainer decision, not a clean
cherry-pick.

crowsnest has no extended-stable line, no maintenance branch, and no public
plugin SDK or config contract to guard. This concept is NOT yet wired for
crowsnest.

TODO: wire an extended-stable preparation procedure only if crowsnest adopts a
long-lived maintenance line with its own channel pointer. It would build on
[backport-discovery](backport-discovery.md) (also not wired) and would need a
maintenance-risk flag for any change to a buyer-facing contract. Until then, do
not prepare extended-stable patches; fix forward on `main`.
