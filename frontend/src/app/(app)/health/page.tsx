"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Globe2,
  HardDrive,
  KeyRound,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
  Cpu,
  Server,
  Timer,
  Zap,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { PageError, PageLoading } from "@/components/common/page-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/lib/api";
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/utils";
import type {
  EndpointMetric,
  EnvVarRow,
  ServiceCheck,
  SystemHealthSnapshot,
  SystemStatus,
} from "@/lib/types";

type RefreshInterval = 0 | 5 | 15 | 60;

const REFRESH_CHOICES: { value: RefreshInterval; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 5, label: "5s" },
  { value: 15, label: "15s" },
  { value: 60, label: "60s" },
];

const SERVICE_ICONS: Record<string, typeof Activity> = {
  postgres: Database,
  redis: Zap,
  runs_dir: HardDrive,
  docker_socket: Boxes,
  clerk: ShieldCheck,
  frontend: Globe2,
};

const SERVICE_LABELS: Record<string, string> = {
  postgres: "Postgres",
  redis: "Redis",
  runs_dir: "Runs filesystem",
  docker_socket: "Docker socket",
  clerk: "Clerk (auth)",
  frontend: "Frontend (Next.js)",
};

export default function HealthPage() {
  const [snap, setSnap] = useState<SystemHealthSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshEvery, setRefreshEvery] = useState<RefreshInterval>(15);
  const [showSecrets, setShowSecrets] = useState(false);
  const [endpointFilter, setEndpointFilter] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getProvider().getSystemHealth();
      setSnap(next);
      setError(null);
      setLastLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!refreshEvery) return;
    const id = window.setInterval(load, refreshEvery * 1000);
    return () => window.clearInterval(id);
  }, [refreshEvery, load]);

  if (initialLoading) return <PageLoading label="Probing services…" />;
  if (error && !snap) return <PageError error={error} onRetry={load} />;
  if (!snap) return null;

  const criticalIssues = snap.services.filter(
    (s) => s.status === "down" || s.status === "degraded",
  );

  return (
    <>
      <PageHeader
        title="Health"
        description="Live status of every moving part: API, Postgres, Redis, filesystem, Clerk, LLM governor, and the Next.js frontend."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 p-1 text-xs">
              <span className="px-1.5 text-muted-foreground">Refresh</span>
              {REFRESH_CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setRefreshEvery(c.value)}
                  className={`rounded px-2 py-0.5 transition-colors ${
                    refreshEvery === c.value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={refreshing}
              aria-label="Refresh now"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        }
      />

      <OverviewStrip
        snap={snap}
        refreshEvery={refreshEvery}
        refreshing={refreshing}
        lastLoadedAt={lastLoadedAt}
      />

      {criticalIssues.length > 0 ? (
        <Card className="border-amber-400/40 bg-amber-400/5">
          <CardContent className="flex flex-col gap-2 p-3 text-xs text-amber-200 md:flex-row md:items-center md:justify-between md:p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                {criticalIssues.length} service
                {criticalIssues.length > 1 ? "s" : ""} need attention:{" "}
                <span className="font-medium text-foreground">
                  {criticalIssues
                    .map((s) => SERVICE_LABELS[s.name] ?? s.name)
                    .join(", ")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          icon={Server}
          title="Services"
          subtitle="Each probe reports status, latency and a short detail line."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snap.services.map((svc) => (
            <ServiceTile key={svc.name} service={svc} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Gauge}
          title="API traffic"
          subtitle="Rolling window of request counts, latency and error rates per endpoint."
        />
        <TrafficOverview snap={snap} />
        <EndpointsTable
          metrics={snap.metrics}
          totalEndpoints={snap.endpoints.length}
          filter={endpointFilter}
          onFilterChange={setEndpointFilter}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={Cpu}
          title="Process & runtime"
          subtitle="API process fingerprint, active scan subprocesses and auth wiring."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ProcessCard snap={snap} />
          <AuthCard snap={snap} />
        </div>
        <ActiveRunsCard snap={snap} />
      </section>

      <section className="space-y-3">
        <SectionHeader
          icon={KeyRound}
          title="Configuration audit"
          subtitle="Environment variables the API reads, with secrets redacted by default."
          trailing={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSecrets((s) => !s)}
            >
              {showSecrets ? (
                <>
                  <EyeOff className="h-4 w-4" /> Hide previews
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" /> Show previews
                </>
              )}
            </Button>
          }
        />
        <EnvTable rows={snap.env} showSecrets={showSecrets} />
      </section>
    </>
  );
}

// ------------------------------------------------------------------
// Overview strip
// ------------------------------------------------------------------

function OverviewStrip({
  snap,
  refreshEvery,
  refreshing,
  lastLoadedAt,
}: {
  snap: SystemHealthSnapshot;
  refreshEvery: RefreshInterval;
  refreshing: boolean;
  lastLoadedAt: number | null;
}) {
  const statusTone = statusToneClasses(snap.status);
  const healthyCount = snap.services.filter((s) => s.status === "healthy").length;
  const degradedCount = snap.services.filter(
    (s) => s.status === "degraded" || s.status === "down",
  ).length;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex items-center gap-4">
          <div
            className={`relative flex h-14 w-14 items-center justify-center rounded-xl border ${statusTone.ring}`}
          >
            {snap.status === "healthy" ? (
              <CheckCircle2 className={`h-6 w-6 ${statusTone.icon}`} />
            ) : snap.status === "degraded" ? (
              <AlertTriangle className={`h-6 w-6 ${statusTone.icon}`} />
            ) : (
              <AlertTriangle className={`h-6 w-6 ${statusTone.icon}`} />
            )}
            {refreshing ? (
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-primary/60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
            ) : null}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(snap.status)} className="uppercase">
                {snap.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {healthyCount}/{snap.services.length} healthy
                {degradedCount > 0 ? ` · ${degradedCount} degraded/down` : ""}
              </span>
            </div>
            <div className="mt-1 text-sm font-medium">
              API {snap.process.version} · {snap.process.environment}
              <span className="text-muted-foreground">
                {" "}
                on {snap.process.hostname || "?"}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 md:gap-5">
          <MiniStat
            icon={Timer}
            label="Uptime"
            value={formatDuration(snap.process.uptimeSeconds * 1000)}
          />
          <MiniStat
            icon={Activity}
            label="Requests"
            value={formatNumber(snap.totals.total)}
            sub={
              snap.totals.errors5xx > 0
                ? `${snap.totals.errors5xx} errors`
                : "0 errors"
            }
            tone={snap.totals.errors5xx > 0 ? "danger" : "default"}
          />
          <MiniStat
            icon={RefreshCw}
            label="Last refresh"
            value={lastLoadedAt ? formatRelativeTime(new Date(lastLoadedAt).toISOString()) : "—"}
            sub={refreshEvery ? `auto · every ${refreshEvery}s` : "auto off"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger";
}) {
  const toneClass = tone === "danger" ? "text-red-300" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface/40 p-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2/60 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
        {sub ? <div className={`truncate text-[11px] ${toneClass}`}>{sub}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Service tiles
// ------------------------------------------------------------------

function ServiceTile({ service }: { service: ServiceCheck }) {
  const tone = statusToneClasses(service.status);
  const Icon = SERVICE_ICONS[service.name] ?? Server;
  const label = SERVICE_LABELS[service.name] ?? service.name;
  const meta = service.meta ?? {};
  const metaPairs = Object.entries(meta).slice(0, 6);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-md border ${tone.ring}`}
            >
              <Icon className={`h-4 w-4 ${tone.icon}`} />
            </div>
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {service.name}
              </div>
            </div>
          </div>
          <Badge variant={statusVariant(service.status)}>{service.status}</Badge>
        </div>

        <div className="text-xs text-muted-foreground">
          {service.detail || "—"}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {service.latencyMs != null ? (
            <span className="tabular-nums">
              <Timer className="mr-1 inline h-3 w-3" />
              {service.latencyMs.toFixed(1)} ms
            </span>
          ) : null}
          {metaPairs.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {metaPairs.map(([k, v]) => (
                <MetaChip key={k} k={k} v={v} />
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MetaChip({ k, v }: { k: string; v: unknown }) {
  if (v == null) return null;
  if (k === "disk" && typeof v === "object") {
    const d = v as {
      usedPercent?: number;
      freeBytes?: number;
      totalBytes?: number;
    };
    if (d.usedPercent == null || d.totalBytes == null) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-2/60 px-1.5 py-0.5 tabular-nums">
        disk {d.usedPercent.toFixed(0)}% · {formatBytes(d.freeBytes ?? 0)} free
      </span>
    );
  }
  const display =
    typeof v === "object" ? JSON.stringify(v) : String(v);
  if (!display || display === "{}") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-2/60 px-1.5 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate font-mono text-foreground">{display}</span>
    </span>
  );
}

// ------------------------------------------------------------------
// Traffic
// ------------------------------------------------------------------

function TrafficOverview({ snap }: { snap: SystemHealthSnapshot }) {
  const perRouteSorted = [...snap.metrics].sort((a, b) => b.count - a.count);
  const busiest = perRouteSorted[0];
  const slowest = [...snap.metrics].sort((a, b) => b.latencyMsP95 - a.latencyMsP95)[0];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <TrafficStat
        icon={Activity}
        label="Total requests"
        value={formatNumber(snap.totals.total)}
      />
      <TrafficStat
        icon={AlertTriangle}
        label="5xx errors"
        value={formatNumber(snap.totals.errors5xx)}
        tone={snap.totals.errors5xx > 0 ? "danger" : "default"}
        sub={`${(snap.totals.errorRate * 100).toFixed(2)}% rate`}
      />
      <TrafficStat
        icon={Zap}
        label="Busiest"
        value={busiest ? `${busiest.method} ${busiest.path}` : "—"}
        sub={busiest ? `${formatNumber(busiest.count)} hits` : undefined}
        mono
      />
      <TrafficStat
        icon={Timer}
        label="Slowest (p95)"
        value={slowest ? `${slowest.latencyMsP95.toFixed(0)} ms` : "—"}
        sub={slowest ? `${slowest.method} ${slowest.path}` : undefined}
        mono
      />
    </div>
  );
}

function TrafficStat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
  mono = false,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger";
  mono?: boolean;
}) {
  const toneClass = tone === "danger" ? "text-red-300" : "text-foreground";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-2/60 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div
            className={`truncate text-sm font-semibold ${toneClass} ${
              mono ? "font-mono" : "tabular-nums"
            }`}
          >
            {value}
          </div>
          {sub ? (
            <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Endpoints table
// ------------------------------------------------------------------

function EndpointsTable({
  metrics,
  totalEndpoints,
  filter,
  onFilterChange,
}: {
  metrics: EndpointMetric[];
  totalEndpoints: number;
  filter: string;
  onFilterChange: (next: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return metrics;
    return metrics.filter(
      (m) =>
        m.path.toLowerCase().includes(q) || m.method.toLowerCase().includes(q),
    );
  }, [metrics, filter]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">Endpoint metrics</CardTitle>
          <CardDescription>
            {metrics.length} active of {totalEndpoints} registered routes
          </CardDescription>
        </div>
        <div className="w-full md:max-w-xs">
          <Input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Filter by method or path…"
            className="h-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="hidden grid-cols-[80px_minmax(0,1fr)_90px_90px_90px_90px_120px] items-center gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground md:grid">
          <div>Method</div>
          <div>Path</div>
          <div className="text-right">Requests</div>
          <div className="text-right">Errors</div>
          <div className="text-right">p50</div>
          <div className="text-right">p95</div>
          <div className="text-right">Last seen</div>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No requests seen yet for the current filter.
          </div>
        ) : (
          <ul>
            {filtered.map((m) => (
              <li key={`${m.method} ${m.path}`}>
                <div className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2/40 md:grid-cols-[80px_minmax(0,1fr)_90px_90px_90px_90px_120px] md:items-center md:gap-3">
                  <div>
                    <MethodPill method={m.method} />
                  </div>
                  <div className="truncate font-mono text-xs">{m.path}</div>
                  <div className="tabular-nums text-xs md:text-right">
                    {formatNumber(m.count)}
                  </div>
                  <div className="text-xs md:text-right">
                    <ErrorChip count={m.errors5xx} rate={m.errorRate} />
                  </div>
                  <div className="tabular-nums text-xs text-muted-foreground md:text-right">
                    {m.latencyMsP50.toFixed(1)} ms
                  </div>
                  <div className="tabular-nums text-xs text-muted-foreground md:text-right">
                    {m.latencyMsP95.toFixed(1)} ms
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    {formatRelativeTime(new Date(m.lastSeenAt * 1000).toISOString())}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MethodPill({ method }: { method: string }) {
  const tone =
    method === "GET"
      ? "border-primary/40 bg-primary/10 text-primary"
      : method === "POST"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : method === "DELETE"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-border bg-surface-2/60 text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tone}`}
    >
      {method}
    </span>
  );
}

function ErrorChip({ count, rate }: { count: number; rate: number }) {
  if (count === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className="inline-flex items-center rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-200">
      {count} · {(rate * 100).toFixed(1)}%
    </span>
  );
}

// ------------------------------------------------------------------
// Process / auth / active runs
// ------------------------------------------------------------------

function ProcessCard({ snap }: { snap: SystemHealthSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API process</CardTitle>
        <CardDescription>
          Fingerprint of the FastAPI worker currently serving this request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs md:grid-cols-2">
          <Kv k="Version" v={snap.process.version} />
          <Kv k="Environment" v={snap.process.environment} />
          <Kv k="Hostname" v={snap.process.hostname || "—"} />
          <Kv k="Python" v={snap.process.python} />
          <Kv
            k="Uptime"
            v={formatDuration(snap.process.uptimeSeconds * 1000)}
          />
          <Kv
            k="Started"
            v={formatRelativeTime(snap.process.startedAt)}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function AuthCard({ snap }: { snap: SystemHealthSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Authentication
        </CardTitle>
        <CardDescription>
          Clerk verification state, admin allowlist size, API key registry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs md:grid-cols-2">
          <Kv
            k="Clerk"
            v={
              <Badge variant={snap.auth.enabled ? "success" : "warning"}>
                {snap.auth.enabled ? "enabled" : "disabled"}
              </Badge>
            }
          />
          <Kv k="Issuer" v={snap.auth.issuer || "—"} mono />
          <Kv k="JWKS" v={snap.auth.jwksUrl || "—"} mono />
          <Kv k="Audience" v={snap.auth.audience || "—"} mono />
          <Kv k="Admin emails" v={String(snap.auth.adminEmailCount)} />
          <Kv k="API keys" v={String(snap.auth.apiKeyCount)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function ActiveRunsCard({ snap }: { snap: SystemHealthSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" /> Active scan processes
        </CardTitle>
        <CardDescription>
          Subprocesses this worker currently owns via the run launcher.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {snap.activeRuns.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-6 text-xs text-muted-foreground">
            <MinusCircle className="h-3.5 w-3.5" /> No active runs on this worker.
          </div>
        ) : (
          <ul>
            {snap.activeRuns.map((r) => (
              <li
                key={r.run_id}
                className="flex flex-col gap-1 border-t border-border px-5 py-3 first:border-t-0 text-xs md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse-dot" />
                  <span className="font-mono">{r.run_id}</span>
                  <span className="text-muted-foreground">pid {r.pid}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{r.targets.join(", ") || "—"}</span>
                  <span>·</span>
                  <span>
                    started{" "}
                    {formatRelativeTime(
                      new Date(r.started_at * 1000).toISOString(),
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Environment audit
// ------------------------------------------------------------------

function EnvTable({
  rows,
  showSecrets,
}: {
  rows: EnvVarRow[];
  showSecrets: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_80px_minmax(0,1fr)_80px] items-center gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground md:grid">
          <div>Variable</div>
          <div>Set?</div>
          <div>Value</div>
          <div className="text-right">Class</div>
        </div>
        <ul>
          {rows.map((row) => (
            <li
              key={row.key}
              className="grid grid-cols-1 gap-1 border-b border-border px-4 py-3 text-xs last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_80px_minmax(0,1fr)_80px] md:items-center md:gap-3"
            >
              <div className="truncate font-mono">{row.key}</div>
              <div>
                {row.set ? (
                  <Badge variant="success">set</Badge>
                ) : (
                  <Badge variant="default">unset</Badge>
                )}
              </div>
              <div className="truncate font-mono text-muted-foreground">
                {renderEnvValue(row, showSecrets)}
              </div>
              <div className="md:text-right">
                <Badge variant={row.secret ? "warning" : "outline"}>
                  {row.secret ? "secret" : "public"}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function renderEnvValue(row: EnvVarRow, showSecrets: boolean): string {
  if (!row.set) return "—";
  if (row.secret) {
    return showSecrets && row.preview ? row.preview : "••••••";
  }
  return row.value || "—";
}

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  trailing,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <span className="text-xs text-muted-foreground md:ml-2">{subtitle}</span>
        ) : null}
      </div>
      {trailing ? <div>{trailing}</div> : null}
    </div>
  );
}

function Kv({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {k}
      </dt>
      <dd
        className={`max-w-[70%] truncate text-right ${
          mono ? "font-mono" : "tabular-nums"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

function statusVariant(
  status: SystemStatus,
): "success" | "warning" | "danger" | "default" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "down") return "danger";
  return "default";
}

function statusToneClasses(status: SystemStatus): {
  ring: string;
  icon: string;
} {
  if (status === "healthy")
    return {
      ring: "border-emerald-400/40 bg-emerald-400/10",
      icon: "text-emerald-300",
    };
  if (status === "degraded")
    return {
      ring: "border-amber-400/40 bg-amber-400/10",
      icon: "text-amber-300",
    };
  if (status === "down")
    return {
      ring: "border-red-500/40 bg-red-500/10",
      icon: "text-red-300",
    };
  return {
    ring: "border-border bg-surface-2/60",
    icon: "text-muted-foreground",
  };
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
