import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server in .next/standalone (used by the Docker image).
  output: "standalone",
  // node:sqlite is a Node built-in; keep it out of any bundling.
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
