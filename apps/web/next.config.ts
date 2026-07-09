import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are transpiled by Next on demand; no explicit
  // transpilePackages list required for the 1.1 skeleton.
};

export default nextConfig;
