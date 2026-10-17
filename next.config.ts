import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
