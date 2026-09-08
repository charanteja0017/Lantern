"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, Bug, Coins, PlayCircle, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { PageError, PageLoading } from "@/components/common/page-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badge";
import { useProviderData } from "@/lib/api/use-provider-data";
import { formatCost, formatDuration, formatNumber, formatRelativeTime } from "@/lib/utils";
import type { RunStatus, RunSummary, Severity } from "@/lib/types";

const STATUS_FILTERS: { value: RunStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "throttled", label: "Throttled" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
];

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export default function RunsPage() {
  const { data: runs, loading, error, refetch } = useProviderData(
    (p) => p.listRuns(),
    [],
    // Poll every 5s so newly-kicked runs and status transitions (queued →
    // running → completed) appear in the table without a manual refresh.
    { pollMs: 5000 },
  );
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!runs) return [];
    const q = search.trim().toLowerCase();
    return runs
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => {
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          r.targets.some((t) => t.toLowerCase().includes(q)) ||
          r.id.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [runs, status, search]);

  if (loading) return <PageLoading label="Loading runs…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!runs) return null;

  const totals = computeTotals(runs);

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every scan, sorted by most recent activity. Click a run to drill into agents, findings and the live event timeline."
        actions={
          <Link href="/runs/new">
            <Button>
              <PlayCircle className="h-4 w-4" />
              New scan
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total" value={String(runs.length)} icon={Activity} />
        <StatTile
          label="Active"
          value={String(totals.active)}
          icon={Activity}
          tone="primary"
        />
        <StatTile
          label="Findings"
          value={formatNumber(totals.findings)}
          icon={Bug}
          tone="danger"
        />
        <StatTile
          label="Cost"
          value={formatCost(totals.cost)}
          icon={Coins}
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between md:p-4">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, target or ID…"
              className="h-9 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  status === f.value
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-surface/40 text-muted-foreground hover:bg-surface-2/60 hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[1.6fr_1.4fr_0.7fr_0.8fr_1fr_0.6fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
            <div>Run</div>
            <div>Targets</div>
            <div>Status</div>
            <div>Findings</div>
            <div>Usage</div>
            <div className="text-right">Updated</div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <ul>
              {filtered.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/runs/${r.id}`}
                    className="block border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2/40 md:grid md:grid-cols-[1.6fr_1.4fr_0.7fr_0.8fr_1fr_0.6fr] md:items-center md:gap-3"
                  >
                    {/* Mobile summary */}
                    <div className="flex flex-col gap-2 md:hidden">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{r.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {r.targets.join(" · ")}
                          </div>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{r.stats.agents} agents</span>
                        <span>{formatNumber(r.stats.tokens)} tok</span>
                        <span>{r.stats.vulnerabilities} findings</span>
                        <span>{formatRelativeTime(r.updatedAt)}</span>
                      </div>
                      <SeverityStrip counts={r.severityCounts} />
                    </div>

                    {/* Desktop row */}
                    <div className="hidden min-w-0 md:block">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {r.scanMode} · {r.scopeMode} · {formatDuration(r.stats.durationMs)}
                      </div>
                    </div>
                    <div className="hidden min-w-0 md:block">
                      <div className="truncate text-xs text-muted-foreground">
                        {r.targets.join(" · ")}
                      </div>
                    </div>
                    <div className="hidden md:block">
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="hidden md:block">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="default">{r.stats.vulnerabilities}</Badge>
                        <SeverityStrip counts={r.severityCounts} />
                      </div>
                    </div>
                    <div className="hidden text-xs text-muted-foreground md:block">
                      <div className="tabular-nums">{formatNumber(r.stats.tokens)} tok</div>
                      <div className="tabular-nums">{formatCost(r.stats.cost)}</div>
                    </div>
                    <div className="hidden text-right text-xs text-muted-foreground md:block">
                      {formatRelativeTime(r.updatedAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function computeTotals(runs: RunSummary[]) {
  return runs.reduce(
    (acc, r) => {
      acc.findings += r.stats.vulnerabilities;
      acc.cost += r.stats.cost;
      if (r.status === "running" || r.status === "throttled" || r.status === "queued") {
        acc.active += 1;
      }
      return acc;
    },
    { findings: 0, cost: 0, active: 0 },
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "primary" | "danger";
}) {
  const toneClass = {
    default: "text-muted-foreground",
    primary: "text-primary",
    danger: "text-red-300",
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3 md:p-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums md:text-2xl">{value}</div>
        </div>
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2/60 ${toneClass}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_PILL_CLASS: Record<Severity, string> = {
  critical: "border-red-500/40 bg-red-500/15 text-red-200",
  high: "border-orange-500/40 bg-orange-500/15 text-orange-200",
  medium: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  low: "border-sky-400/40 bg-sky-400/15 text-sky-200",
  info: "border-border bg-surface-2/60 text-muted-foreground",
};

function SeverityStrip({ counts }: { counts: Record<Severity, number> }) {
  const total = SEVERITY_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0);
  if (total === 0) {
    return <span className="text-[11px] text-muted-foreground">no findings</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {SEVERITY_ORDER.map((s) =>
        counts[s] ? (
          <span
            key={s}
            title={`${counts[s]} ${s}`}
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-md border px-1 text-[10px] font-semibold tabular-nums uppercase tracking-wider ${SEVERITY_PILL_CLASS[s]}`}
          >
            {counts[s]}
          </span>
        ) : null,
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2/60">
        <Activity className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <div className="text-sm font-medium">No runs match your filters</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Clear the search or launch a new scan to get started.
        </div>
      </div>
      <Link href="/runs/new">
        <Button variant="outline" size="sm">
          <PlayCircle className="h-4 w-4" />
          Start a scan
        </Button>
      </Link>
    </div>
  );
}
