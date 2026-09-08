// Next.js 16 `proxy.ts` convention (replaces the deprecated `middleware.ts`).
// Runs on the Edge for every request matched by `config.matcher` below.
//
// Guards the authenticated app routes with Clerk when Clerk is configured,
// and is a no-op when it is not (demo / bare-development deployments).

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Clerk is "on" only when BOTH the publishable key (build-time, inlined into
// the bundle) AND the secret key (runtime) are present. Either one missing
// means we can't actually verify sessions, so fall back to pass-through.
const hasClerk = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
);

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  "/favicon.ico",
  "/favicon.svg",
]);

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        await auth.protect();
      }
    })
  : function passthrough(_req: NextRequest) {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
