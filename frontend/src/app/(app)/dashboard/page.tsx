"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bug,
  Coins,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/common/status-badge";
import { SeverityBadge } from "@/components/common/severity-badge";
import { MiniAreaChart } from "@/components/charts/area-chart";
import { MiniBarChart } from "@/components/charts/bar-chart";
import { SeverityDonut } from "@/components/charts/severity-donut";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";
import { cn, formatCost, formatNumber, formatRelativeTime } from "@/lib/utils";

function useDashboard() {
  return useProviderData(
    async (p) => {
      const [overview, runs, findings] = await Promise.all([
        p.getDashboardOverview(),
        p.listRuns(),
        p.listFindings(),
      ]);
      return { overview, runs, findings };
    },
    [],
    // Refresh the dashboard every 8s so counts, active-run tiles and new
    // findings appear without manual refresh. Pauses when the tab is hidden.
    { pollMs: 8000 },
  );
}

export default function DashboardPage() {
  const { data, loading, error, refetch } = useDashboard();

  if (loading) return <PageLoading label="Loading dashboard…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!data) return null;

  const { overview, runs, findings } = data;
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "throttled");
  const criticalCount = overview.findings.bySeverity.critical;
  const highCount = overview.findings.bySeverity.high;

  // Anything the operator would want to act on before reading a single chart.
  const alerts = [
    criticalCount > 0 && {
      key: "critical",
      tone: "critical" as const,
      icon: AlertTriangle,
      text: `${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} awaiting triage`,
      href: "/findings?sev=critical",
      cta: "Triage",
    },
    overview.throttle.active && {
      key: "throttle",
      tone: "warning" as const,
      icon: Zap,
      text: `LLM throttling active on ${overview.throttle.providers.join(", ")} — runs auto-resume`,
      href: "/admin/rate-limits",
      cta: "Inspect",
    },
  ].filter(Boolean) as {
    key: string;
    tone: "critical" | "warning";
    icon: React.ComponentType<{ className?: string }>;
    text: string;
    href: string;
    cta: string;
  }[];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Real-time view of all agents, runs, findings, and quota state across your workspace."
        actions={
          <Link href="/runs/new">
            <Button>
              <Activity className="h-4 w-4" />
              New scan
            </Button>
          </Link>
        }
      />

      {/* -------------------------------------------------------------------
          Needs attention. Previously an operator had to scroll past four
          charts to discover a critical finding or an active throttle; both
          now lead the page and link straight to the filtered view.
          ------------------------------------------------------------------- */}
      {alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((a) => {
            const Icon = a.icon;
            return (
              <div
                key={a.key}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg border p-3",
                  a.tone === "critical"
                    ? "border-severity-critical/30 bg-severity-critical/10"
                    : "border-severity-medium/30 bg-severity-medium/10",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    a.tone === "critical"
                      ? "text-severity-critical"
                      : "text-severity-medium",
                  )}
                  aria-hidden
                />
                <span className="flex-1 text-sm">{a.text}</span>
                <Link href={a.href}>
                  <Button variant="outline" size="sm">
                    {a.cta}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Active runs"
          value={String(overview.runs.active)}
          detail={
            activeRuns.length
              ? `${formatNumber(activeRuns.reduce((n, r) => n + r.stats.agents, 0))} agents working`
              : "Nothing running"
          }
          tone={activeRuns.length ? "live" : "default"}
        />
        <StatCard
          icon={Bug}
          label="Findings"
          value={String(overview.findings.total)}
          detail={
            criticalCount + highCount > 0
              ? `${criticalCount} critical · ${highCount} high`
              : "None above medium"
          }
          tone={criticalCount > 0 ? "danger" : "default"}
        />
        <StatCard
          icon={Coins}
          label="Tokens (24h)"
          value={formatNumber(overview.tokens.used24h)}
          detail={`${formatCost(overview.tokens.cost24h)} spent`}
          tone="default"
        />
        <StatCard
          icon={Zap}
          label="LLM throttle"
          value={overview.throttle.active ? "Active" : "Idle"}
          detail={
            overview.throttle.active
              ? `${Math.round(overview.throttle.tpmUsage * 100)}% TPM on ${overview.throttle.providers[0]}`
              : "All providers healthy"
          }
          tone={overview.throttle.active ? "warning" : "default"}
        />
      </div>

      {/* -------------------------------------------------------------------
          Live state, promoted above the trend charts. What is happening now
          outranks what happened this week on an operations console.
          ------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Active runs
                {activeRuns.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-normal text-live">
                    <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-live" />
                    live
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>Scans currently streaming.</CardDescription>
            </div>
            <Link href="/runs">
              <Button variant="ghost" size="sm">
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-2/60 text-muted-foreground">
                  <Activity className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground">
                  No active runs right now.
                </p>
                <Link href="/runs/new">
                  <Button variant="outline" size="sm">
                    Start a scan
                  </Button>
                </Link>
              </div>
            ) : (
              activeRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:border-primary/30 hover:bg-surface-2/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {r.targets.join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                    <span>{r.stats.agents} agents</span>
                    <span>{formatNumber(r.stats.tokens)} tok</span>
                    <span
                      className={cn(
                        r.stats.vulnerabilities > 0 && "text-severity-high",
                      )}
                    >
                      {r.stats.vulnerabilities} findings
                    </span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Latest findings</CardTitle>
              <CardDescription>Most recent across all runs.</CardDescription>
            </div>
            <Link href="/findings">
              <Button variant="ghost" size="sm">
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {findings.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-live/30 bg-live/10 text-live">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Nothing discovered yet.
                </p>
              </div>
            ) : (
              findings.slice(0, 5).map((f) => (
                <Link
                  key={f.id}
                  href={`/findings/${f.id}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:border-primary/30 hover:bg-surface-2/60"
                >
                  <SeverityBadge severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{f.target ?? "—"}</span> ·{" "}
                      {formatRelativeTime(f.timestamp)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Token consumption</CardTitle>
              <CardDescription>Hourly tokens across all active runs (last 24h).</CardDescription>
            </div>
            <Badge variant="primary">{formatNumber(overview.tokens.used24h)} tokens</Badge>
          </CardHeader>
          <CardContent>
            <MiniAreaChart data={overview.tokens.hourly} xKey="hour" yKey="tokens" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Findings by severity</CardTitle>
            <CardDescription>Workspace-wide distribution.</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityDonut counts={overview.findings.bySeverity} />
            {/* Each tile links into the filtered triage view, so the donut is
                a way in rather than a read-only picture. */}
            <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
              {(
                Object.keys(overview.findings.bySeverity) as (keyof typeof overview.findings.bySeverity)[]
              ).map((k) => (
                <Link
                  key={k}
                  href={`/findings?sev=${k}`}
                  className="rounded-md border border-border bg-surface/60 py-1.5 transition-colors hover:border-primary/30 hover:bg-surface-2/60"
                >
                  <div className="font-semibold tabular-nums">
                    {overview.findings.bySeverity[k]}
                  </div>
                  <div className="uppercase tracking-wider text-muted-foreground">{k}</div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Runs last 7 days</CardTitle>
            <CardDescription>Volume of launched scans.</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBarChart data={overview.runs.weekly} xKey="day" yKey="count" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Findings last 7 days</CardTitle>
            <CardDescription>New findings per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniBarChart
              data={overview.findings.weekly}
              xKey="day"
              yKey="count"
              color="hsl(var(--sev-high))"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate-limit pressure</CardTitle>
            <CardDescription>Current TPM/RPM utilization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">TPM</span>
                <span className="tabular-nums">
                  {Math.round(overview.throttle.tpmUsage * 100)}%
                </span>
              </div>
              <Progress
                value={overview.throttle.tpmUsage * 100}
                indicatorClassName={
                  overview.throttle.tpmUsage > 0.8
                    ? "bg-severity-medium"
                    : "bg-primary"
                }
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">RPM</span>
                <span className="tabular-nums">
                  {Math.round(overview.throttle.rpmUsage * 100)}%
                </span>
              </div>
              <Progress value={overview.throttle.rpmUsage * 100} />
            </div>
            <Link href="/admin/rate-limits">
              <Button variant="outline" size="sm" className="w-full">
                View provider details <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /**
   * A fact derived from the data. The previous version hardcoded
   * "+2 vs yesterday" on the active-runs tile regardless of the real numbers.
   */
  detail?: string;
  tone?: "default" | "live" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-muted-foreground",
    live: "text-live",
    warning: "text-severity-medium",
    danger: "text-severity-critical",
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {detail ? <div className={cn("mt-1 truncate text-xs", toneClass)}>{detail}</div> : null}
        </div>
        <div
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2/60",
            toneClass,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
