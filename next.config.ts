import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/urpick", destination: "/urpick/", permanent: false }];
  },
  async rewrites() {
    return [{ source: "/urpick/", destination: "/urpick/index.html" }];
  },
};

export default nextConfig;
