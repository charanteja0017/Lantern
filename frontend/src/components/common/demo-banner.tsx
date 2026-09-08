"use client";

import { Sparkles } from "lucide-react";
import { config } from "@/lib/config";

export function DemoBanner() {
  if (!config.demo) return null;
  return (
    <div className="relative border-b border-border bg-gradient-to-r from-primary/15 via-primary/5 to-transparent">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-1.5 text-[11px] md:px-4 md:text-xs">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-primary">Demo Mode</span>
        <span className="truncate text-muted-foreground md:whitespace-normal">
          <span className="md:hidden">Simulated data — read-only preview.</span>
          <span className="hidden md:inline">
            All data shown here is simulated. Set{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">NEXT_PUBLIC_DEMO=false</code> and
            point <code className="rounded bg-surface-2 px-1 py-0.5">NEXT_PUBLIC_API_BASE_URL</code>{" "}
            at your NovaHunter backend for real operations.
          </span>
        </span>
      </div>
    </div>
  );
}
