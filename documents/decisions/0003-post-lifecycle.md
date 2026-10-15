# 0003: Crowsnest tracks each post from idea to 48-hour numbers

## Context

Kai's weekly content routine runs across agent skills, a hand-edited `posts.csv` sheet in the kaiship-business repo, ChatbotX DM flows, OpenMontage, Skool and the website. No single place says where a post stands. Three failures followed: own-channel measurement stopped when the Graph token expired and nothing alerted, most DM flows were never tested with a second account, and `planned_posts` was never used. Crowsnest already holds the data a post needs (source videos, scripts, `planned_posts`, `own_posts` and their insights), so it is the natural place for the post record.

## Decision

Crowsnest keeps one row per post, from idea to 48-hour numbers. It stays a data core with a thin orchestration layer on top; reasoning stays in the agent, as in [0002](0002-data-and-action-brain.md).

- A post is done when it is published, its DM funnel is tested with a second account, and its 48-hour numbers are stored. Anything short of that is not done.
- Views rank both source reels and Kai's own reels. Saves read as usefulness and comments as lead pull; neither replaces views as the ranking signal.
- Leads go to the Skool community. The website only sells.
- Other tools keep their jobs. OpenMontage renders video, ChatbotX sends DMs, Skool holds leads, the website and Polar sell. Crowsnest records the links and results each tool hands back.

## Consequences

- `planned_posts` is the post record. Its existing `publishedOwnPostId` link to `own_posts` carries the 48-hour numbers; the funnel test result needs a field of its own.
- The MCP server needs a write path for a post, so the routine's skills can update the record instead of `posts.csv`.
- A failed own-channel measurement must be visible, not only logged, because the 48-hour numbers are part of done.
- The routine's skills move to crowsnest one step at a time; see the content machine plan under `documents/plans/`.
