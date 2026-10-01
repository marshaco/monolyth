import type { NextConfig } from "next";

// FastAPI backend. nginx routes /api/v1/* there in the docker setup (infra/nginx/nginx.conf);
// this rewrite does the same when the app is opened directly on :3000.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/v1/:path*` }];
  },
};

export default nextConfig;
