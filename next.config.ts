import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server in .next/standalone (used by the Docker image).
  output: "standalone",
  // Next 16 writes AGENTS.md/CLAUDE.md for coding agents on `next dev`; this repo keeps its own docs instead.
  agentRules: false,
};

export default nextConfig;
