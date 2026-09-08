"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, Bug, Coins, Zap } from "lucide-react";

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
import { formatCost, formatNumber, formatRelativeTime } from "@/lib/utils";

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Activity}
          label="Active runs"
          value={String(overview.runs.active)}
          delta="+2 vs yesterday"
          tone="primary"
        />
        <StatCard
          icon={Bug}
          label="Findings"
          value={String(overview.findings.total)}
          delta={`${overview.findings.bySeverity.critical} critical`}
          tone="danger"
        />
        <StatCard
          icon={Coins}
          label="Tokens (24h)"
          value={formatNumber(overview.tokens.used24h)}
          delta={formatCost(overview.tokens.cost24h)}
          tone="default"
        />
        <StatCard
          icon={Zap}
          label="LLM throttle"
          value={overview.throttle.active ? "Active" : "Idle"}
          delta={
            overview.throttle.active
              ? `${Math.round(overview.throttle.tpmUsage * 100)}% TPM on ${overview.throttle.providers[0]}`
              : "All providers healthy"
          }
          tone={overview.throttle.active ? "warning" : "default"}
        />
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
            <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
              {(Object.keys(overview.findings.bySeverity) as (keyof typeof overview.findings.bySeverity)[]).map(
                (k) => (
                  <div key={k} className="rounded-md border border-border bg-surface/60 py-1.5">
                    <div className="font-semibold tabular-nums">{overview.findings.bySeverity[k]}</div>
                    <div className="uppercase tracking-wider text-muted-foreground">{k}</div>
                  </div>
                ),
              )}
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
                  overview.throttle.tpmUsage > 0.8 ? "bg-amber-400" : "bg-primary"
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
            {overview.throttle.active ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  Throttling active on {overview.throttle.providers.join(", ")}. Requests are being
                  queued with exponential backoff — runs will auto-resume.
                </div>
              </div>
            ) : null}
            <Link href="/admin/rate-limits">
              <Button variant="outline" size="sm" className="w-full">
                View provider details <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Active runs</CardTitle>
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
              <p className="text-sm text-muted-foreground">No active runs right now.</p>
            ) : (
              activeRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:bg-surface-2/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.targets.join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{r.stats.agents} agents</span>
                    <span>{formatNumber(r.stats.tokens)} tok</span>
                    <span>{r.stats.vulnerabilities} findings</span>
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
            {findings.slice(0, 5).map((f) => (
              <Link
                key={f.id}
                href={`/findings/${f.id}`}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:bg-surface-2/60"
              >
                <SeverityBadge severity={f.severity} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {f.target ?? "—"} · {formatRelativeTime(f.timestamp)}
                  </div>
                </div>
              </Link>
            ))}
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
  delta,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "primary" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-muted-foreground",
    primary: "text-primary",
    warning: "text-amber-300",
    danger: "text-red-300",
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {delta ? <div className={`mt-1 text-xs ${toneClass}`}>{delta}</div> : null}
        </div>
        <div
          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2/60 ${toneClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
