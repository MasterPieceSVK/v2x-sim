import type { NextConfig } from "next";

// Static export: `npm run build` writes a plain static site to out/,
// so the simulator can be hosted anywhere and needs no server.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
