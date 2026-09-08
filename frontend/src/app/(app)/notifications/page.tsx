"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearAll,
  loadNotifications,
  markAllRead,
  markRead,
  pushNotification,
  removeNotification,
  subscribe,
  type AppNotification,
  type NotificationKind,
} from "@/lib/notifications";
import { refreshLiveNotifications } from "@/lib/notifications-live";
import { formatRelativeTime } from "@/lib/utils";

const LIVE_REFRESH_INTERVAL_MS = 45_000;

const KIND_ICON: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const KIND_BADGE: Record<NotificationKind, "outline" | "success" | "warning" | "danger"> = {
  info: "outline",
  success: "success",
  warning: "warning",
  critical: "danger",
};

type Filter = "all" | "unread" | NotificationKind;

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setItems(loadNotifications());
    const unsubscribe = subscribe(() => setItems(loadNotifications()));

    setRefreshing(true);
    void refreshLiveNotifications({ force: true }).finally(() => setRefreshing(false));

    const interval = window.setInterval(() => {
      void refreshLiveNotifications();
    }, LIVE_REFRESH_INTERVAL_MS);

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

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await refreshLiveNotifications({ force: true });
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((n) => {
      if (filter === "unread" && n.read) return false;
      if (filter !== "all" && filter !== "unread" && n.kind !== filter) return false;
      if (
        needle &&
        !n.title.toLowerCase().includes(needle) &&
        !n.message.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [items, q, filter]);

  const unread = items.filter((n) => !n.read).length;

  const sendTest = () => {
    pushNotification({
      title: "Test notification",
      message: "Delivery check — if you can see this, the in-app notification pipeline is healthy.",
      kind: "info",
    });
    toast.success("Test notification queued.");
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Failed runs, throttling events, and high-severity findings pulled directly from the platform."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={unread > 0 ? "primary" : "outline"}>
              <BellRing className="h-3 w-3" />
              {unread} unread
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={refreshNow}
              disabled={refreshing}
              title="Pull the latest events from the backend"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => markAllRead()} disabled={unread === 0}>
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              Mark all read
            </Button>
            <Button size="sm" variant="outline" onClick={sendTest}>
              <Bell className="mr-1.5 h-3.5 w-3.5" />
              Send test
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                clearAll();
                toast.success("Notifications cleared.");
              }}
              disabled={items.length === 0}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear all
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by title or message…"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread only</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Bell className="h-6 w-6" />
              <div>
                {items.length === 0
                  ? refreshing
                    ? "Checking for new events…"
                    : "You're all caught up — no recent runs, throttling events, or high-severity findings."
                  : "No notifications match these filters."}
              </div>
            </div>
          ) : (
            filtered.map((n) => {
              const Icon = KIND_ICON[n.kind];
              return (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 border-b border-border p-4 text-sm last:border-b-0 ${
                    n.read ? "" : "bg-primary/5"
                  }`}
                >
                  <div
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2/60`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{n.title}</span>
                      <Badge variant={KIND_BADGE[n.kind]}>{n.kind}</Badge>
                      {!n.read && (
                        <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                          new
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{n.message}</p>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {n.href && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={n.href} onClick={() => markRead(n.id)}>
                          Open
                          <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                    {!n.read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markRead(n.id)}
                        title="Mark as read"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeNotification(n.id)}
                      title="Dismiss"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </>
  );
}
