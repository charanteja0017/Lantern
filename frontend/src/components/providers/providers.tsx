"use client";

import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./theme-provider";

/** Toasts follow the active theme; this was previously pinned to "dark". */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  // Same reasoning as the theme toggle: nothing theme-dependent may render
  // until the client knows which theme is active.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Toaster
      richColors
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="top-right"
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      <ThemedToaster />
    </ThemeProvider>
  );
}
