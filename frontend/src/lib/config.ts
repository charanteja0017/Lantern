export const config = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "NovaHunter",
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ?? "AI-native offensive security control plane",
  brandDomain: process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "novahunter.ai",
  apiHost: process.env.NEXT_PUBLIC_API_HOST ?? "https://api.novahunter.ai",
  upstream: {
    name: "Strix Agent",
    repoUrl: process.env.NEXT_PUBLIC_UPSTREAM_REPO_URL ?? "https://github.com/usestrix/strix",
    org: "usestrix",
  },
  demo: (process.env.NEXT_PUBLIC_DEMO ?? "true").toLowerCase() === "true",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  clerk: {
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
    signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in",
    signUpUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up",
    afterSignIn: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/dashboard",
    afterSignUp: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/dashboard",
  },
} as const;

export const isDemoMode = () => config.demo;
export const hasClerk = () => Boolean(config.clerk.publishableKey);
