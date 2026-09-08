"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearAll,
  loadNotifications,
  markAllRead,
  markRead,
  removeNotification,
  subscribe,
  type AppNotification,
  type NotificationKind,
} from "@/lib/notifications";
import { refreshLiveNotifications } from "@/lib/notifications-live";
import { formatRelativeTime } from "@/lib/utils";

// Keep the bell quietly in sync with the backend. 60s is a good compromise
// between freshness and not hammering the API while the tab is idle.
const LIVE_REFRESH_INTERVAL_MS = 60_000;

const KIND_ICON: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const KIND_COLOR: Record<NotificationKind, string> = {
  info: "text-sky-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  critical: "text-red-300",
};

export function NotificationsMenu() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(loadNotifications());
    const unsubscribe = subscribe(() => setItems(loadNotifications()));

    // Kick a fresh fetch immediately so a brand-new session never renders the
    // empty state when real events exist in the backend.
    void refreshLiveNotifications({ force: true });

    const interval = window.setInterval(() => {
      void refreshLiveNotifications();
    }, LIVE_REFRESH_INTERVAL_MS);

    // Also refresh the moment the tab becomes visible again — users coming
    // back after lunch should see the latest state, not a stale snapshot.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshLiveNotifications({ force: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const unread = items.filter((n) => !n.read).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {mounted && unread > 0 && (
            <span className="absolute right-1 top-1 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow-[0_0_0_2px_hsl(var(--background))]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <DropdownMenuLabel className="flex items-center justify-between p-3">
          <div>
            <div className="text-sm font-medium">Notifications</div>
            <div className="text-[11px] text-muted-foreground">
              {unread === 0 ? "All caught up" : `${unread} unread`}
            </div>
          </div>
          <button
            onClick={() => markAllRead()}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-2/60 hover:text-foreground"
          >
            <CheckCheck className="mr-1 inline h-3 w-3" />
            Mark all read
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            items.slice(0, 12).map((n) => {
              const Icon = KIND_ICON[n.kind];
              return (
                <div
                  key={n.id}
                  className={`group flex gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0 ${
                    n.read ? "" : "bg-primary/5"
                  }`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${KIND_COLOR[n.kind]}`} />
                  <div className="min-w-0 flex-1">
                    {n.href ? (
                      <Link
                        href={n.href}
                        className="block"
                        onClick={() => markRead(n.id)}
                      >
                        <div className="truncate font-medium">{n.title}</div>
                      </Link>
                    ) : (
                      <div className="font-medium">{n.title}</div>
                    )}
                    <div className="line-clamp-2 text-xs text-muted-foreground">{n.message}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{formatRelativeTime(n.createdAt)}</span>
                      {!n.read && <span className="text-primary">• unread</span>}
                    </div>
                  </div>
                  <button
                    aria-label="Dismiss"
                    onClick={() => removeNotification(n.id)}
                    className="invisible h-6 w-6 shrink-0 rounded text-muted-foreground hover:bg-surface-2/60 hover:text-destructive group-hover:visible"
                  >
                    <Trash2 className="mx-auto h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between p-2">
          <Button variant="ghost" size="sm" onClick={() => clearAll()}>
            <Trash2 className="mr-1 h-3 w-3" />
            Clear all
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/notifications">View all</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
