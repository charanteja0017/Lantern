export type NotificationKind = "info" | "success" | "warning" | "critical";

/** Where the notification was produced:
 *  - "local" — user action in the UI (API key created, 2FA enabled, Send test)
 *  - "live"  — derived from backend state (failed runs, critical findings, throttling)
 *
 *  The store keeps both side-by-side so the bell reflects *everything* the user
 *  should know about, while refreshes from the backend only touch the "live"
 *  slice.
 */
export type NotificationSource = "local" | "live";

export type AppNotification = {
  id: string;
  title: string;
  message: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  href?: string;
  source: NotificationSource;
  /** Tag the provider mode the notification was fetched under so switching
   *  demo↔live drops stale entries that no longer reflect reality. */
  mode?: "demo" | "api";
};

const STORAGE_KEY = "strix.notifications";
const DISMISSED_LIVE_KEY = "strix.notifications.dismissed_live";
// Bump this whenever the notification storage shape or any stale seed data
// changes — existing users will have their local cache cleared on next load.
const STORAGE_VERSION_KEY = "strix.notifications.v";
// v3: introduced `source` + live reconciliation. Anything older contained
// only user-action items without a source tag and can safely be discarded.
// v4: adds dismissed-live id cache so cleared/dismissed live notifications
// do not immediately reappear on the next polling refresh.
const STORAGE_VERSION = "4";
const CHANNEL = "strix-notifications";
const DISMISS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function migrateStorage(): void {
  if (!isBrowser()) return;
  try {
    const current = window.localStorage.getItem(STORAGE_VERSION_KEY);
    if (current !== STORAGE_VERSION) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
    }
  } catch {
    /* ignore storage quota / access errors */
  }
}

function normalise(raw: unknown): AppNotification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is AppNotification => typeof x === "object" && x !== null && "id" in x)
    .map((n) => ({
      ...n,
      // Back-compat: items created before v3 were all user-action local.
      source: (n.source as NotificationSource | undefined) ?? "local",
    }));
}

export function loadNotifications(): AppNotification[] {
  if (!isBrowser()) return [];
  migrateStorage();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalise(JSON.parse(raw));
  } catch {
    return [];
  }
}

function loadDismissedLive(): Record<string, number> {
  if (!isBrowser()) return {};
  migrateStorage();
  try {
    const raw = window.localStorage.getItem(DISMISSED_LIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveDismissedLive(map: Record<string, number>): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(DISMISSED_LIVE_KEY, JSON.stringify(map));
}

function dismissKey(mode: "demo" | "api", id: string): string {
  return `${mode}:${id}`;
}

function pruneDismissed(map: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - DISMISS_RETENTION_MS;
  const next: Record<string, number> = {};
  for (const [k, ts] of Object.entries(map)) {
    if (ts >= cutoff) next[k] = ts;
  }
  return next;
}

function broadcast(): void {
  try {
    new BroadcastChannel(CHANNEL).postMessage({ type: "update" });
  } catch {
    /* ignore in browsers without BroadcastChannel */
  }
  window.dispatchEvent(new CustomEvent("strix:notifications-updated"));
}

export function saveNotifications(items: AppNotification[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  broadcast();
}

export function pushNotification(
  n: Omit<AppNotification, "id" | "createdAt" | "read" | "source"> &
    Partial<Pick<AppNotification, "source">>,
): AppNotification {
  const full: AppNotification = {
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    read: false,
    source: n.source ?? "local",
    ...n,
  };
  const items = loadNotifications();
  saveNotifications([full, ...items].slice(0, 200));
  return full;
}

export function markAllRead(): void {
  const items = loadNotifications().map((n) => ({ ...n, read: true }));
  saveNotifications(items);
}

export function markRead(id: string): void {
  const items = loadNotifications().map((n) => (n.id === id ? { ...n, read: true } : n));
  saveNotifications(items);
}

export function removeNotification(id: string): void {
  const current = loadNotifications();
  const victim = current.find((n) => n.id === id);
  if (victim?.source === "live") {
    const mode = victim.mode ?? "api";
    const dismissed = pruneDismissed(loadDismissedLive());
    dismissed[dismissKey(mode, victim.id)] = Date.now();
    saveDismissedLive(dismissed);
  }
  const items = current.filter((n) => n.id !== id);
  saveNotifications(items);
}

export function clearAll(): void {
  const current = loadNotifications();
  const dismissed = pruneDismissed(loadDismissedLive());
  for (const n of current) {
    if (n.source === "live") {
      const mode = n.mode ?? "api";
      dismissed[dismissKey(mode, n.id)] = Date.now();
    }
  }
  saveDismissedLive(dismissed);
  saveNotifications([]);
}

/** Replace the "live" slice with a freshly-computed batch while preserving
 *  the user's read state for ids that still appear, and dropping any stale
 *  live entries the backend no longer produces.
 *
 *  `local` notifications (API key created, 2FA enabled, toasts) are left
 *  completely untouched.
 *
 *  Also discards any live entries whose `mode` tag differs from the incoming
 *  batch — prevents carry-over when the user flips between demo and live.
 */
export function reconcileLiveNotifications(
  incoming: AppNotification[],
  mode: "demo" | "api",
): void {
  const current = loadNotifications();
  const dismissed = pruneDismissed(loadDismissedLive());
  saveDismissedLive(dismissed);
  const prevLiveById = new Map(
    current.filter((n) => n.source === "live").map((n) => [n.id, n] as const),
  );

  const refreshed: AppNotification[] = incoming
    .filter((n) => !dismissed[dismissKey(mode, n.id)])
    .map((n) => {
      const prev = prevLiveById.get(n.id);
      return {
        ...n,
        source: "live",
        mode,
        // Preserve read state across refreshes so users don't get re-nagged.
        read: prev?.read ?? n.read,
      };
    });

  const local = current.filter((n) => n.source === "local");
  const merged = [...refreshed, ...local]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 200);
  saveNotifications(merged);
}

export function subscribe(listener: () => void): () => void {
  if (!isBrowser()) return () => {};
  const handler = () => listener();
  window.addEventListener("strix:notifications-updated", handler);
  window.addEventListener("storage", handler);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = handler;
  } catch {
    /* ignore */
  }
  return () => {
    window.removeEventListener("strix:notifications-updated", handler);
    window.removeEventListener("storage", handler);
    channel?.close();
  };
}
