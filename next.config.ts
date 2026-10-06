import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node built-in; keep it out of any bundling.
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
