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
        // Same pointers as the <head> links, for a client that only reads
        // headers (curl -I, a fetch tool) and never parses the HTML.
        source: "/",
        headers: [
          {
            key: "Link",
            value: '</docs/mcp.md>; rel="service-doc"; type="text/markdown", </llms.txt>; rel="describedby"; type="text/plain"',
          },
        ],
      },
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
