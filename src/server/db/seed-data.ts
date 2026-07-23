// mulberry32 — deterministic across runs so tests can assert exact counts
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_CHANNELS = [
  { handle: "@buildinpublic.daily", displayName: "Build In Public Daily", followerCount: 342_000, baseViews: 180_000, niche: "ai-startups" },
  { handle: "@aitoolsforcreators", displayName: "AI Tools For Creators", followerCount: 1_150_000, baseViews: 640_000, niche: "ai-tools" },
  { handle: "@solofounderdiary", displayName: "Solo Founder Diary", followerCount: 88_000, baseViews: 45_000, niche: "founder-story" },
  { handle: "@shortformlab", displayName: "Short Form Lab", followerCount: 415_000, baseViews: 210_000, niche: "content-strategy" },
] as const;

export const CAPTION_POOL = [
  "3 mistakes killing your first 1,000 followers",
  "I automated my whole content pipeline with one prompt",
  "the AI tool nobody is talking about (yet)",
  "how this reel got 2M views in 48 hours",
  "stop editing videos manually. do this instead",
  "my exact system for daily posts as a solo founder",
  "this took 11 minutes and outperformed everything",
  "the hook formula behind every viral reel",
  "why your reels die at 200 views",
  "I studied 100 viral reels. here's the pattern",
];
// planted outliers: [channelIndex, multiplier]
export const PLANTED_OUTLIERS: [number, number][] = [[0, 12.4], [0, 3.2], [1, 38.0], [1, 6.8], [2, 22.4], [2, 2.6], [3, 9.1], [3, 4.4]];
