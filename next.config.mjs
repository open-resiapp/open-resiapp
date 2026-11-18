import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["next-auth", "@auth/core"],
  // Anti-framing + basic hardening on every response, also when the app runs
  // without Caddy (Railway, docker-compose.hub). Nothing in the app frames its
  // own pages: the MCP confirm view is served as a ui:// resource body and
  // rendered by the AI host, never loaded from a URL of this origin.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
