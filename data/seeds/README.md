# Creator seed data

Curated starter lists of public Instagram creators, one JSON file per niche, loaded
into the `creator_seeds` table by the Discover seed loader.

## Shape

```json
{
  "niche": "fitness",
  "label": "Fitness",
  "creators": [
    { "handle": "jeffnippard", "why": "science-based hypertrophy breakdowns with rigorous citation of studies", "source": "https://www.instagram.com/jeffnippard/" }
  ]
}
```

- `niche` matches the filename stem and is one of the four allowed niches below.
- `label` is the human-readable niche name.
- `creators` is a list of `{ handle, why, source }`:
  - `handle` is the normalized Instagram handle, no leading `@`.
  - `why` is a one-line curation rationale — never a metric.
  - `source` is the URL the handle was taken from (an `instagram.com/<handle>/`
    profile link or a public listicle).

## Niches

- `fitness.json`
- `finance.json`
- `tech.json`
- `business.json`

## No-metrics rule

`why` must explain *what makes the account worth following* (content style, format,
expertise, angle) and must never cite a follower count, view count, engagement rate,
or any other number-as-stat. "form-check reels with strong retention hooks" is fine;
"1.2M followers" or "gets 500k views" is not.

## Verification

Handles are verified against the sidecar by `scripts/verify-seeds.ts` before commit.
