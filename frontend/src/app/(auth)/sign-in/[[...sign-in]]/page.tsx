import { SignIn } from "@clerk/nextjs";

import { StrixLogo } from "@/components/common/logo";
import { DemoBanner } from "@/components/common/demo-banner";
import { config, hasClerk } from "@/lib/config";
import { DemoSignInForm } from "../demo-form";

// Catch-all segment — Clerk's `<SignIn />` navigates to sub-paths like
// `/sign-in/factor-one`, `/sign-in/factor-two`, `/sign-in/sso-callback`, etc.
// The `[[...sign-in]]` optional catch-all makes all of them resolve to this
// page so Clerk can take over the inner routing.
export default function SignInPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <DemoBanner />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_0%,hsl(217_91%_60%/0.18),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(hsl(210_40%_96%/0.6)_1px,transparent_1px),linear-gradient(90deg,hsl(210_40%_96%/0.6)_1px,transparent_1px)] [background-size:40px_40px]"
      />

      <div className="relative flex min-h-[calc(100vh-40px)] items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <StrixLogo size={36} />
            <h1 className="text-xl font-semibold">{config.appName}</h1>
            <p className="text-sm text-muted-foreground">{config.tagline}</p>
          </div>

          {hasClerk() ? (
            <div className="flex justify-center">
              <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                fallbackRedirectUrl="/dashboard"
              />
            </div>
          ) : (
            <DemoSignInForm />
          )}
        </div>
      </div>
    </div>
  );
}
