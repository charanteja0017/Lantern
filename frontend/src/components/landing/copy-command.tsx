"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyCommand({
  command,
  className,
  tone = "dark",
}: {
  command: string;
  className?: string;
  tone?: "dark" | "light";
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-2 rounded-md border border-border pr-1 font-mono text-xs backdrop-blur-sm",
        tone === "dark" ? "bg-surface-2/70" : "bg-background/70",
        className,
      )}
    >
      <Terminal className="ml-2 h-3.5 w-3.5 text-primary" />
      <code className="select-all whitespace-nowrap py-1.5 text-muted-foreground">{command}</code>
      <button
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-surface/70 hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
