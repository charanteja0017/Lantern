/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit a minimal self-contained build so the Docker image only needs
  // the `.next/standalone` output (faster cold starts, smaller runtime image).
  output: "standalone",
  // Next.js 16: Turbopack is the default bundler. Keep the legacy webpack
  // build option as a fallback via `next build --webpack` if ever needed.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBase) return [];
    return [{ source: "/api/backend/:path*", destination: `${apiBase}/:path*` }];
  },
};

export default nextConfig;
