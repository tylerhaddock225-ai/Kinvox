import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "kinvoxtech.com" },
      { protocol: "https", hostname: "www.kinvoxtech.com" },
      { protocol: "https", hostname: "app.kinvoxtech.com" },
      { protocol: "https", hostname: "sandbox.kinvoxtech.com" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "kinvoxtech.com",
        "www.kinvoxtech.com",
        "app.kinvoxtech.com",
        "sandbox.kinvoxtech.com",
        "localhost:3000",
        "app.localhost:3000",
      ],
    },
  },
};

export default nextConfig;
