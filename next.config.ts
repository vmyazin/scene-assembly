import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Worktrees have their own dependencies; do not resolve through another session.
  turbopack: { root: process.cwd() },
  // The consent page decides real spend with one click; an attacker framing
  // /connect-agent in an invisible iframe could clickjack the Approve button
  // into confirming an agent connection the person never chose. Scoped to
  // this one route only — every other page still renders in a frame.
  async headers() {
    return [
      {
        source: "/connect-agent",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
