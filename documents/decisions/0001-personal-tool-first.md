# Build for one user first, defer the sellable version

## Context

Kai wants to grow kaiships.ai, open source the clone, and sell a cheaper tool. The first is a personal tool. The sellable version is a different product. The data layer that suits one user (a self-hosted instagrapi sidecar on one burner account) does not suit customers, who would each need their own burner and would blame Crowsnest for bans. A paid vendor is what a sellable version needs.

## Decision

Crowsnest is built for one local user: SQLite, no auth, no tenancy. The sellable version is deferred, not cancelled.

## Consequences

- Instagram access stays behind the `SocialProvider` seam (`src/server/providers/types.ts`) and `src/server/ig/client.ts`. A hosted version swaps in a paid vendor there.
- Do not hardcode the single-user assumption deeper than it already is.
- Selling access to Instagram's private API, and open sourcing the clone, are risk calls for Kai to make deliberately before any v2 work starts.
