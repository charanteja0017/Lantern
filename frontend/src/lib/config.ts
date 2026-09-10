export const config = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Lantern",
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ?? "Self-hosted AI security testing",
  brandDomain: process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "lantern.local",
  apiHost: process.env.NEXT_PUBLIC_API_HOST ?? "http://localhost/api",
  upstream: {
    name: "Strix Agent",
    repoUrl: process.env.NEXT_PUBLIC_UPSTREAM_REPO_URL ?? "https://github.com/usestrix/strix",
    org: "usestrix",
  },
  demo: (process.env.NEXT_PUBLIC_DEMO ?? "true").toLowerCase() === "true",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
} as const;

export const isDemoMode = () => config.demo;
