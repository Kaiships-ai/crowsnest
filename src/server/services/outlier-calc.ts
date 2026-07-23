export interface VideoForCalc { id: string; viewCount: number | null; postedAt: string }

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MIN_USABLE = 5;

export function computeChannelMedian(videos: VideoForCalc[], window = 20): number | null {
  const usable = videos
    .filter((v) => v.viewCount !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, window);
  if (usable.length < MIN_USABLE) return null;
  const m = median(usable.map((v) => v.viewCount as number));
  return m === 0 ? null : m;
}

export function scoreVideos(videos: VideoForCalc[], window = 20): Map<string, number | null> {
  const channelMedian = computeChannelMedian(videos, window);
  const out = new Map<string, number | null>();
  for (const v of videos) {
    out.set(v.id, channelMedian === null || v.viewCount === null
      ? null
      : Math.round((v.viewCount / channelMedian) * 10) / 10);
  }
  return out;
}
