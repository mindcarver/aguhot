import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Playwright e2e and local dev reach the app via 127.0.0.1; Next dev blocks
  // cross-origin HMR requests by default, so allow the loopback origin.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
