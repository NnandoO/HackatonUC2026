import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async rewrites() {
    const api = (process.env.ANGIBELL_API_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
    return [
      { source: "/qr", destination: `${api}/qr` },
      { source: "/api/qr-status", destination: `${api}/api/qr-status` },
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
      { source: "/checkout/:path*", destination: `${api}/checkout/:path*` },
      { source: "/media/:path*", destination: `${api}/media/:path*` },
    ];
  },
};

export default nextConfig;
