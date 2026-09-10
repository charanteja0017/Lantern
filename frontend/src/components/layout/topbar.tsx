"use client";

import { Menu, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "@/components/common/command-palette";
import { NotificationsMenu } from "@/components/common/notifications-menu";
import { StrixLogo } from "@/components/common/logo";
import { config } from "@/lib/config";

function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent || navigator.platform || "";
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(ua));
  }, []);
  return isMac;
}

export function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();

  // The active theme is unknowable on the server, so the icon renders as an
  // invisible placeholder until mount. Both sides then agree on the first
  // pass, and the real icon appears without a layout shift.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isMac = useIsMac();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "/" && !paletteOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag === "input" || tag === "textarea" || tag === "select" || editable) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  const shortcut = isMac ? "⌘K" : "Ctrl K";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md md:gap-3 md:px-4">
      <Button
        onClick={onOpenNav}
        size="icon"
        variant="ghost"
        aria-label="Open navigation"
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Link
        href="/dashboard"
        className="flex items-center gap-2 md:hidden"
        aria-label={`${config.appName} home`}
      >
        <StrixLogo size={22} />
        <span className="text-sm font-semibold tracking-tight">{config.appName}</span>
      </Link>

      <button
        onClick={() => setPaletteOpen(true)}
        className="group relative hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-2/60 md:flex"
        aria-label="Open search"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate">Search runs, findings, pages…</span>
        <kbd className="pointer-events-none inline-flex items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px]">
          {shortcut}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 md:gap-2">
        <Button
          onClick={() => setPaletteOpen(true)}
          size="icon"
          variant="ghost"
          aria-label="Open search"
          className="md:hidden"
        >
          <Search className="h-4 w-4" />
        </Button>
        {config.demo ? (
          <Badge variant="primary" className="hidden md:inline-flex">
            Demo Mode
          </Badge>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {!mounted ? (
            <Sun className="h-4 w-4 opacity-0" aria-hidden />
          ) : resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
        <NotificationsMenu />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
