"use client";

import { KeyRound, LogOut, Menu, Moon, Search, Settings, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useClerk, useUser } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/common/command-palette";
import { NotificationsMenu } from "@/components/common/notifications-menu";
import { StrixLogo } from "@/components/common/logo";
import { config, hasClerk } from "@/lib/config";

const STORAGE_KEY = "strix.profile";

type Profile = { fullName: string; username: string; email: string; initials: string };

const DEFAULT_PROFILE: Profile = {
  fullName: "Harsha K.",
  username: "harsha",
  email: "harsha@strix.local",
  initials: "HS",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return chars.join("") || "SX";
}

function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent || navigator.platform || "";
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(ua));
  }, []);
  return isMac;
}

// User menu when Clerk is configured — real sign-in/out via Clerk SDK.
function ClerkUserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  if (!isLoaded) {
    return (
      <div
        aria-hidden
        className="h-8 w-8 animate-pulse rounded-full bg-surface-2"
      />
    );
  }

  const fullName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const avatarUrl = user?.imageUrl ?? null;
  const userInitials = initials(fullName);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    router.push("/sign-in");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Open user menu"
          className="rounded-full outline-none ring-primary/30 transition-shadow focus-visible:ring-2"
        >
          <Avatar>
            {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
            <AvatarFallback>{userInitials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 text-xs">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{fullName}</div>
              <div className="truncate text-[11px] text-muted-foreground">{email}</div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User className="h-4 w-4" />
            Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile?tab=keys">
            <KeyRound className="h-4 w-4" />
            API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleSignOut();
          }}
          className="text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// User menu when Clerk isn't configured — localStorage-driven demo profile.
function DemoUserMenu() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Profile>;
          setProfile({
            fullName: parsed.fullName ?? DEFAULT_PROFILE.fullName,
            username: parsed.username ?? DEFAULT_PROFILE.username,
            email: parsed.email ?? DEFAULT_PROFILE.email,
            initials:
              parsed.initials ??
              (parsed.fullName ? initials(parsed.fullName) : DEFAULT_PROFILE.initials),
          });
        }
        setAvatarUrl(window.localStorage.getItem("strix.avatar"));
      } catch {
        /* ignore */
      }
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  const onSignOut = () => {
    toast.success("Signed out. (Demo mode — Clerk will handle this in live mode.)");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Open user menu"
          className="rounded-full outline-none ring-primary/30 transition-shadow focus-visible:ring-2"
        >
          <Avatar>
            {avatarUrl && <AvatarImage src={avatarUrl} alt={profile.fullName} />}
            <AvatarFallback>{profile.initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 text-xs">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={profile.fullName} />}
              <AvatarFallback>{profile.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {profile.fullName}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{profile.email}</div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User className="h-4 w-4" />
            Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile?tab=keys">
            <KeyRound className="h-4 w-4" />
            API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="text-destructive">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const { theme, setTheme } = useTheme();
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
  // `hasClerk()` is derived from NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, which is
  // inlined at build time, so this branch is effectively a static split —
  // safe to choose between two components with different hook shapes.
  const clerkEnabled = hasClerk();

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
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
        <NotificationsMenu />

        {clerkEnabled ? <ClerkUserMenu /> : <DemoUserMenu />}
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
