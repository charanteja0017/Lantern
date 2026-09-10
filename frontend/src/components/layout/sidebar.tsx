"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bug,
  FileText,
  Github,
  HeartPulse,
  LayoutDashboard,
  PlayCircle,
  Settings,
  ShieldAlert,
  X,
} from "lucide-react";
import { StrixLogo } from "@/components/common/logo";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";

/**
 * Navigation is grouped by what the operator is trying to DO, not by a flat
 * alphabet of destinations. Fourteen equal-weight links previously sat in two
 * buckets; three small groups of three are scannable without reading each
 * label. "New scan" left this list entirely — it is an action, not a place,
 * and now lives in the primary button above the nav.
 */
const navGroups: {
  heading: string;
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
}[] = [
  {
    heading: "Operate",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/runs", label: "Runs", icon: Activity },
      { href: "/findings", label: "Findings", icon: Bug },
    ],
  },
  {
    heading: "Analyze",
    items: [
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/docs", label: "API Docs", icon: BookOpen },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const adminNav = [
  { href: "/admin", label: "Admin Home", icon: ShieldAlert },
  { href: "/health", label: "Health", icon: HeartPulse },
  { href: "/admin/rate-limits", label: "Rate Limits", icon: Activity },
  { href: "/admin/audit", label: "Audit Log", icon: FileText },
];

const allNavItems = [...navGroups.flatMap((g) => g.items), ...adminNav];

function useActiveMatcher() {
  const pathname = usePathname();
  const allHrefs = allNavItems.map((i) => i.href);
  const bestMatch = allHrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return (href: string) => href === bestMatch;
}

function NavSection({
  heading,
  items,
  isActive,
  onNavigate,
}: {
  heading: string;
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </div>
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors",
                  active
                    ? "bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]"
                    : "hover:bg-surface-2/60 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SidebarBrand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <StrixLogo size={26} />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">{config.appName}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Security Control Plane
        </div>
      </div>
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="space-y-2 border-t border-border p-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>v0.1.0</span>
        <span className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {config.demo ? "demo" : "live"}
        </span>
      </div>
      <a
        href={config.upstream.repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[10px] leading-tight text-muted-foreground transition-colors hover:text-foreground"
        title={`Agent core: ${config.upstream.repoUrl}`}
      >
        <Github className="h-3 w-3 shrink-0" />
        <span className="truncate">
          Agent core: <span className="font-mono">{config.upstream.org}/strix</span>
        </span>
      </a>
    </div>
  );
}

function NewScanAction({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="px-3 pt-3">
      <Link
        href="/runs/new"
        onClick={onNavigate}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-glow transition-colors hover:bg-primary/90"
      >
        <PlayCircle className="h-4 w-4" />
        New scan
      </Link>
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useActiveMatcher();
  return (
    <nav className="flex-1 overflow-y-auto p-3 scrollbar-thin">
      {navGroups.map((group, i) => (
        <div key={group.heading} className={i > 0 ? "mt-5" : undefined}>
          <NavSection
            heading={group.heading}
            items={group.items}
            isActive={isActive}
            onNavigate={onNavigate}
          />
        </div>
      ))}
      <div className="mt-5">
        <NavSection
          heading="Administration"
          items={adminNav}
          isActive={isActive}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <SidebarBrand />
      <NewScanAction />
      <SidebarNav />
      <SidebarFooter />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    onOpenChange(false);
  }, [pathname, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange]);

  return (
    <div
      className={cn(
        "md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[82%] max-w-[18rem] flex-col border-r border-border bg-surface shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <StrixLogo size={24} />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">{config.appName}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Security Control Plane
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <NewScanAction onNavigate={() => onOpenChange(false)} />
        <SidebarNav onNavigate={() => onOpenChange(false)} />
        <SidebarFooter />
      </aside>
    </div>
  );
}
