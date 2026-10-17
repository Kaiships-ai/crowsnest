import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `/?tab=...` is redirected in src/proxy.ts: a rule here would carry the query along.
  async redirects() {
    return [
      ...["/persona", "/ideas", "/vault", "/mine"].map((p) => ({ source: `${p}/:path*`, destination: "/", permanent: false })),
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
