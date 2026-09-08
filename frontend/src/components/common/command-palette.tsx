"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bug,
  FileText,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  User,
  Users,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getProvider } from "@/lib/api";
import type { Finding, RunSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Navigate" | "Runs" | "Findings";
};

const NAV_ITEMS: Item[] = [
  { id: "nav-dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "Navigate" },
  { id: "nav-runs", label: "Runs", href: "/runs", icon: Activity, group: "Navigate" },
  { id: "nav-new-scan", label: "New scan", href: "/runs/new", icon: PlayCircle, group: "Navigate", hint: "Start a fresh pentest" },
  { id: "nav-findings", label: "Findings", href: "/findings", icon: Bug, group: "Navigate" },
  { id: "nav-reports", label: "Reports", href: "/reports", icon: FileText, group: "Navigate" },
  { id: "nav-analytics", label: "Analytics", href: "/analytics", icon: BarChart3, group: "Navigate" },
  { id: "nav-notifications", label: "Notifications", href: "/notifications", icon: Bell, group: "Navigate" },
  { id: "nav-docs", label: "API docs", href: "/docs", icon: BookOpen, group: "Navigate", hint: "REST reference & examples" },
  { id: "nav-settings", label: "Workspace settings", href: "/settings", icon: Settings, group: "Navigate" },
  { id: "nav-profile", label: "Your profile", href: "/profile", icon: User, group: "Navigate" },
  { id: "nav-api-keys", label: "API keys", href: "/profile?tab=keys", icon: KeyRound, group: "Navigate" },
  { id: "nav-admin", label: "Admin home", href: "/admin", icon: ShieldAlert, group: "Navigate" },
  { id: "nav-admin-orgs", label: "Admin · Organizations", href: "/admin/organizations", icon: Users, group: "Navigate" },
  { id: "nav-admin-rl", label: "Admin · Rate limits", href: "/admin/rate-limits", icon: Activity, group: "Navigate" },
  { id: "nav-admin-audit", label: "Admin · Audit log", href: "/admin/audit", icon: Shield, group: "Navigate" },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const provider = getProvider();
    Promise.allSettled([provider.listRuns(), provider.listFindings()]).then(
      ([r, f]) => {
        if (r.status === "fulfilled") setRuns(r.value);
        if (f.status === "fulfilled") setFindings(f.value);
      },
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  const results = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const matchesNav = NAV_ITEMS.filter(
      (i) => !q || i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q),
    );
    const matchesRuns: Item[] = runs
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.targets.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 8)
      .map((r) => ({
        id: `run-${r.id}`,
        label: r.name,
        hint: `${r.status} · ${r.targets.join(", ")}`,
        href: `/runs/${r.id}`,
        icon: Activity,
        group: "Runs" as const,
      }));
    const matchesFindings: Item[] = findings
      .filter(
        (f) =>
          !q ||
          f.title.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.severity.toLowerCase().includes(q) ||
          f.cve?.toLowerCase().includes(q) ||
          f.cwe?.toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((f) => ({
        id: `find-${f.id}`,
        label: f.title,
        hint: `${f.severity.toUpperCase()}${f.cve ? " · " + f.cve : ""}${f.cwe ? " · " + f.cwe : ""}`,
        href: `/findings/${f.id}`,
        icon: Bug,
        group: "Findings" as const,
      }));

    if (!q) return [...matchesNav, ...matchesRuns, ...matchesFindings];
    return [...matchesNav, ...matchesRuns, ...matchesFindings];
  }, [query, runs, findings]);

  useEffect(() => {
    setActive((prev) => (prev >= results.length ? 0 : prev));
  }, [results.length]);

  const grouped = useMemo(() => {
    const groups: Record<string, Item[]> = {};
    for (const item of results) {
      (groups[item.group] ??= []).push(item);
    }
    return groups;
  }, [results]);

  const select = (i: number) => {
    const item = results[i];
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(active);
    } else if (e.key === "Escape") {
      onOpenChange(false);
    }
  };

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search runs, findings, and pages. Use arrow keys to navigate and Enter to open.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search runs, findings, pages…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </span>
        </div>
        <div className="max-h-96 overflow-y-auto p-1 scrollbar-thin">
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No matches for &quot;{query}&quot;
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {items.map((item) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const Icon = item.icon;
                  const isActive = idx === active;
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => select(idx)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                        isActive
                          ? "bg-primary/15 text-foreground"
                          : "text-muted-foreground hover:bg-surface-2/60",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-foreground">{item.label}</span>
                      {item.hint && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
            <Kbd>↵</Kbd>
            open
          </span>
          <span>{results.length} result{results.length === 1 ? "" : "s"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-surface-2/60 px-1 py-0.5 font-mono text-[10px]">
      {children}
    </span>
  );
}
