import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Ensure Turbopack resolves from this app directory, not the parent repo
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
