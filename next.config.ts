import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Persona, Ideas, Vault and the old /mine were folded away; old links land on Tuần này. `/?tab=...`
  // (the old Dashboard) is handled in the landing page, since a redirect here would carry
  // the query along. `/sources` is the Nguồn entry; its first tab is the Feed.
  async redirects() {
    return [
      ...["/persona", "/ideas", "/vault", "/mine"].map((source) => ({ source, destination: "/", permanent: false })),
      { source: "/sources", destination: "/feed", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      // uploadPlanVideoAction takes a real mp4 Reel through a Server Action, and the
      // default body cap is 1MB, which rejects any real video before the action runs.
      // Keep this in step with MAX_VIDEO_BYTES in src/server/media/video-file.ts.
      bodySizeLimit: "200mb",
    },
  },
};

export default nextConfig;
