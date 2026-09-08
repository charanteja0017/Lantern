// The profile page is entirely user-specific — it reads Clerk identity,
// local storage, and backend whoami() — so it must not be statically
// prerendered at build time. Statically rendering it would invoke
// `useUser()` outside of `<ClerkProvider>` (which is mounted conditionally
// on `hasClerk()`) and fail the build with:
//
//     Error: useUser can only be used within the <ClerkProvider /> component.
//
// Route Segment Config must live in a Server Component, so this file is a
// thin server wrapper that force-disables static generation and delegates
// the actual UI to the colocated client component.
export const dynamic = "force-dynamic";

import ProfileClient from "./profile-client";

export default function ProfilePage() {
  return <ProfileClient />;
}
