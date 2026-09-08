"use client";

import { ClerkProvider as ClerkBaseProvider, useAuth } from "@clerk/nextjs";
import { useEffect, useLayoutEffect, useRef } from "react";

import { config, hasClerk } from "@/lib/config";
import { setAuthTokenGetter } from "@/lib/api/auth-token";

// Exposes the live Clerk session token to the non-React ApiProvider.
//
// We register *once* Clerk is loaded and route every call through a ref so
// re-renders (which can produce a new `getToken` identity) never tear the
// getter down. Tearing it down would briefly return `null` and produce a
// 401 on whichever fetch happened to race that window.
function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth();
  const getTokenRef = useRef(getToken);
  useLayoutEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(() => getTokenRef.current());
    return () => setAuthTokenGetter(null);
  }, [isLoaded]);
  return null;
}

function ThemedClerk({ children }: { children: React.ReactNode }) {
  return (
    <ClerkBaseProvider
      publishableKey={config.clerk.publishableKey}
      signInUrl={config.clerk.signInUrl}
      signUpUrl={config.clerk.signUpUrl}
      signInFallbackRedirectUrl={config.clerk.afterSignIn}
      signUpFallbackRedirectUrl={config.clerk.afterSignUp}
      appearance={{
        variables: {
          colorPrimary: "hsl(217 91% 60%)",
          colorBackground: "hsl(222 47% 6%)",
          colorInputBackground: "hsl(222 40% 11%)",
          colorInputText: "hsl(210 40% 96%)",
          colorText: "hsl(210 40% 96%)",
          colorTextSecondary: "hsl(215 20% 65%)",
          borderRadius: "0.625rem",
          fontFamily: "var(--font-sans), system-ui, sans-serif",
        },
        elements: {
          card: "shadow-xl border border-border",
          headerTitle: "font-semibold tracking-tight",
          socialButtonsBlockButton:
            "border border-border bg-surface hover:bg-surface-2 transition-colors",
          formButtonPrimary:
            "bg-primary hover:bg-primary/90 text-primary-foreground font-medium",
          footerActionLink: "text-primary hover:text-primary/80",
        },
      }}
    >
      <ClerkTokenBridge />
      {children}
    </ClerkBaseProvider>
  );
}

// Public wrapper. When Clerk isn't configured (demo mode / bare development),
// render children as-is so nothing Clerk-related ever runs.
export function ClerkProvider({ children }: { children: React.ReactNode }) {
  if (!hasClerk()) return <>{children}</>;
  return <ThemedClerk>{children}</ThemedClerk>;
}
