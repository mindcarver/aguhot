import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Playwright e2e and local dev reach the app via 127.0.0.1; Next dev blocks
  // cross-origin HMR requests by default, so allow the loopback origin.
  allowedDevOrigins: ["127.0.0.1"],
  // Workspace packages are transpiled by Next on demand; no explicit
  // transpilePackages list required for the 1.1 skeleton.
};

export default nextConfig;
