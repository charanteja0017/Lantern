import { getProvider } from "@/lib/api";
import type { StrixProvider } from "@/lib/api/provider";
import type { Finding, RunSummary, Severity } from "@/lib/types";

import { reconcileLiveNotifications, type AppNotification } from "./notifications";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const MAX_RUNS = 40;
const MAX_FINDINGS = 20;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000;

function safeTime(iso?: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function firstTarget(targets: string[] | undefined): string {
  if (!targets || targets.length === 0) return "target";
  const t = targets[0];
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function runNotifications(runs: RunSummary[]): AppNotification[] {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const completedCutoff = Date.now() - COMPLETED_WINDOW_MS;
  const out: AppNotification[] = [];

  const recent = [...runs]
    .sort((a, b) => safeTime(b.updatedAt) - safeTime(a.updatedAt))
    .slice(0, MAX_RUNS);

  for (const r of recent) {
    const when = safeTime(r.updatedAt) || safeTime(r.createdAt);
    if (when < cutoff) continue;
    const whenIso = r.updatedAt || r.createdAt;
    const target = firstTarget(r.targets);

    if (r.status === "failed") {
      out.push({
        id: `live_run_failed_${r.id}`,
        title: `Run failed: ${r.name}`,
        message: `Scan against ${target} stopped before completion. Review the timeline for the root cause.`,
        kind: "critical",
        createdAt: whenIso,
        read: false,
        href: `/runs/${r.id}`,
        source: "live",
      });
      continue;
    }

    if (r.status === "throttled" || r.throttle) {
      const provider = r.throttle?.provider ?? "an LLM provider";
      const reason = r.throttle?.reason ?? "waiting for rate-limit headroom";
      out.push({
        id: `live_run_throttled_${r.id}`,
        title: `Run throttled — ${provider}`,
        message: `${r.name} is paused: ${reason}.`,
        kind: "warning",
        createdAt: whenIso,
        read: false,
        href: `/runs/${r.id}`,
        source: "live",
      });
      continue;
    }

    if (r.status === "completed" && when >= completedCutoff) {
      const sev = r.severityCounts ?? ({} as Record<Severity, number>);
      const highCritical = (sev.critical ?? 0) + (sev.high ?? 0);
      const total = r.stats?.vulnerabilities ?? 0;
      if (total > 0) {
        out.push({
          id: `live_run_completed_${r.id}`,
          title: `Scan completed: ${r.name}`,
          message:
            highCritical > 0
              ? `${total} finding${total === 1 ? "" : "s"} — ${highCritical} high or critical.`
              : `${total} finding${total === 1 ? "" : "s"} recorded.`,
          kind: highCritical > 0 ? "warning" : "success",
          createdAt: whenIso,
          read: false,
          href: `/runs/${r.id}`,
          source: "live",
        });
      } else {
        out.push({
          id: `live_run_completed_${r.id}`,
          title: `Scan completed: ${r.name}`,
          message: `No findings against ${target}.`,
          kind: "success",
          createdAt: whenIso,
          read: false,
          href: `/runs/${r.id}`,
          source: "live",
        });
      }
    }
  }

  return out;
}

function findingNotifications(findings: Finding[]): AppNotification[] {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const priority = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .filter((f) => safeTime(f.timestamp) >= cutoff)
    .sort((a, b) => {
      const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rank !== 0) return rank;
      return safeTime(b.timestamp) - safeTime(a.timestamp);
    })
    .slice(0, MAX_FINDINGS);

  return priority.map<AppNotification>((f) => ({
    id: `live_finding_${f.id}`,
    title: `${capitalize(f.severity)} finding: ${f.title}`,
    message: f.target
      ? `${f.target}${f.endpoint ? ` ${f.endpoint}` : ""}`
      : (f.description ?? "").slice(0, 140),
    kind: f.severity === "critical" ? "critical" : "warning",
    createdAt: f.timestamp,
    read: false,
    href: `/findings/${f.id}`,
    source: "live",
  }));
}

async function buildLiveNotifications(provider: StrixProvider): Promise<AppNotification[]> {
  const [runsResult, findingsResult] = await Promise.allSettled([
    provider.listRuns(),
    provider.listFindings(),
  ]);

  const runs = runsResult.status === "fulfilled" ? runsResult.value : [];
  const findings = findingsResult.status === "fulfilled" ? findingsResult.value : [];

  const merged = [...runNotifications(runs), ...findingNotifications(findings)];
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged.slice(0, 120);
}

// Simple coalescing guard so the menu and the page don't hammer the API when
// both mount together.
let inflight: Promise<void> | null = null;
let lastRefreshAt = 0;
const MIN_INTERVAL_MS = 10_000;

export async function refreshLiveNotifications(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (!options?.force && now - lastRefreshAt < MIN_INTERVAL_MS && !inflight) return;
  if (inflight) return inflight;

  const provider = getProvider();
  inflight = (async () => {
    try {
      const items = await buildLiveNotifications(provider);
      reconcileLiveNotifications(items, provider.mode);
      lastRefreshAt = Date.now();
    } catch {
      // Swallow — the UI falls back to whatever is cached in storage and the
      // next interval will retry.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
