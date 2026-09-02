---
status: accepted
date: 2026-07-28
---

# Build v1 for one user, defer the sellable version

Kai wants three things from Crowsnest: grow kaiships.ai, open source the clone, and sell a cheaper version of Sandcastles. The first is a personal tool. The third is a business with customers, and it is a different codebase.

We are building v1 for Kai alone. Local, single user, SQLite, no auth, no tenancy. The sellable version is deferred, not cancelled.

## Why

The data layer decision that is right for a personal tool is the one that kills a sellable one. On 2026-07-26 the paid scraping vendors (Apify, HikerAPI) were dropped for a self hosted instagrapi sidecar. For one user that trade is good: cost goes to zero and the ban risk lands on one burner account Kai controls. For customers it inverts. Every customer needs their own burner, every customer gets challenged and banned, and it is Crowsnest they blame. Central proxying makes it worse, because one address enumerating creators for many accounts is the fastest way to get blocked. A paid vendor is what a sellable product needs, precisely because the vendor absorbs that risk and the cost scales per seat.

There is also nothing to sell yet. As of this decision the app had produced two scripts and had never played a video. Proving it on Kai's own Instagram growth is both the product validation and the marketing asset for any later sale.

## Considered options

- **Design for customers now.** Auth, multi tenancy, hosting and a paid data vendor enter scope immediately, and the UI rebuild waits behind them. Rejected: it spends months on plumbing for customers who do not exist.
- **Pick personal forever.** Rejected: Kai has a real intent to sell, and closing that door costs nothing to keep open.
- **Personal now, fork the data layer later.** Chosen.

## Consequences

- Keep the `SocialProvider` seam. A hosted version swaps instagrapi for a paid vendor behind that interface rather than rewriting the app.
- Keep Instagram access behind `src/server/ig/client.ts`. Do not let instagrapi specifics leak into services.
- Stop adding code that hardcodes the single user assumption more deeply than it already is.
- Selling access to Instagram's private API is a different risk class from using it yourself, and open sourcing publishes the terms of service violation under Kai's name. Both are Kai's calls, and both should be made deliberately before v2 starts, not discovered during it.
