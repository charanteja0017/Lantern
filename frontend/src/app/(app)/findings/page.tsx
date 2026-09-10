"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, FilterX, Search, ShieldCheck, X } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/common/severity-badge";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Finding, Severity } from "@/lib/types";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

type FindingStatus = NonNullable<Finding["status"]>;

const STATUS_META: Record<FindingStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "text-severity-high" },
  confirmed: { label: "Confirmed", tone: "text-severity-critical" },
  false_positive: { label: "False positive", tone: "text-muted-foreground" },
  accepted_risk: { label: "Accepted risk", tone: "text-severity-medium" },
  remediated: { label: "Remediated", tone: "text-live" },
  retested_closed: { label: "Retested closed", tone: "text-live" },
};

const STATUS_ORDER: FindingStatus[] = [
  "open",
  "confirmed",
  "accepted_risk",
  "remediated",
  "retested_closed",
  "false_positive",
];

type SortKey = "severity" | "newest" | "oldest";

/**
 * Tailwind only emits classes it can see as complete literals in the source,
 * so severity classes must be looked up, never interpolated.
 */
const SEV_TEXT: Record<Severity, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  info: "text-severity-info",
};

const SEV_RAIL: Record<Severity, string> = {
  critical: "border-l-severity-critical",
  high: "border-l-severity-high",
  medium: "border-l-severity-medium",
  low: "border-l-severity-low",
  info: "border-l-severity-info",
};

const SORTS: { value: SortKey; label: string }[] = [
  { value: "severity", label: "Severity" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

/**
 * Everything an operator can narrow the list by. Held in the URL rather than
 * component state so a triage view is a link: "here are the 3 unresolved
 * criticals on the payments host" can be pasted into a ticket or chat and
 * survives a refresh.
 */
type Filters = {
  q: string;
  severities: Severity[];
  statuses: FindingStatus[];
  sort: SortKey;
};

const EMPTY: Filters = { q: "", severities: [], statuses: [], sort: "severity" };

function parseFilters(params: URLSearchParams): Filters {
  const list = <T extends string>(key: string, allowed: readonly T[]): T[] => {
    const raw = params.get(key);
    if (!raw) return [];
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v): v is T => (allowed as readonly string[]).includes(v));
  };
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    severities: list("sev", SEVERITY_ORDER),
    statuses: list("status", STATUS_ORDER),
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortKey) : "severity",
  };
}

function toQueryString(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.severities.length) p.set("sev", f.severities.join(","));
  if (f.statuses.length) p.set("status", f.statuses.join(","));
  if (f.sort !== "severity") p.set("sort", f.sort);
  return p.toString();
}

function matchesQuery(f: Finding, q: string): boolean {
  if (!q) return true;
  const haystack = [
    f.title,
    f.description,
    f.target,
    f.endpoint,
    f.method,
    f.cve,
    f.cwe,
    f.id,
    f.severity,
  ];
  return haystack.some((v) => v?.toLowerCase().includes(q));
}

export default function FindingsPage() {
  // useSearchParams() opts the subtree into client rendering; the boundary
  // keeps the rest of the route statically renderable.
  return (
    <Suspense fallback={<PageLoading label="Loading findings…" />}>
      <FindingsTriage />
    </Suspense>
  );
}

function FindingsTriage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  // The text field is echoed locally so typing stays responsive, then pushed
  // to the URL on a short debounce -- writing a history entry per keystroke
  // would make the browser back button useless.
  const [draftQuery, setDraftQuery] = useState(filters.q);

  // When the URL changes from somewhere else (back button, a link into a
  // pre-filtered view) the box has to follow it. Adjusting during render is
  // React's documented way to do this; the equivalent effect would queue a
  // second render pass on every navigation.
  const [syncedQuery, setSyncedQuery] = useState(filters.q);
  if (syncedQuery !== filters.q) {
    setSyncedQuery(filters.q);
    setDraftQuery(filters.q);
  }

  const commit = useCallback(
    (next: Filters) => {
      const qs = toQueryString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (draftQuery === filters.q) return;
    const t = window.setTimeout(() => commit({ ...filters, q: draftQuery }), 200);
    return () => window.clearTimeout(t);
  }, [draftQuery, filters, commit]);

  const { data: findings, loading, error, refetch } = useProviderData(
    (p) => p.listFindings(),
    [],
    // New findings should appear live while a scan runs — 6s is frequent
    // enough to feel immediate without hammering the API.
    { pollMs: 6000 },
  );

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const q = filters.q.trim().toLowerCase();

  // Counts are computed against everything EXCEPT the facet being counted, so
  // a severity chip always shows how many findings selecting it would reveal
  // rather than collapsing to zero once another severity is picked.
  const severityCounts = useMemo(() => {
    const base = (findings ?? []).filter(
      (f) =>
        matchesQuery(f, q) &&
        (filters.statuses.length === 0 ||
          filters.statuses.includes((f.status ?? "open") as FindingStatus)),
    );
    return SEVERITY_ORDER.map((s) => ({
      severity: s,
      count: base.filter((f) => f.severity === s).length,
    }));
  }, [findings, q, filters.statuses]);

  const statusCounts = useMemo(() => {
    const base = (findings ?? []).filter(
      (f) =>
        matchesQuery(f, q) &&
        (filters.severities.length === 0 || filters.severities.includes(f.severity)),
    );
    return STATUS_ORDER.map((s) => ({
      status: s,
      count: base.filter((f) => (f.status ?? "open") === s).length,
    })).filter((s) => s.count > 0);
  }, [findings, q, filters.severities]);

  const visible = useMemo(() => {
    const rows = (findings ?? []).filter(
      (f) =>
        matchesQuery(f, q) &&
        (filters.severities.length === 0 || filters.severities.includes(f.severity)) &&
        (filters.statuses.length === 0 ||
          filters.statuses.includes((f.status ?? "open") as FindingStatus)),
    );
    const bySeverity = (a: Finding, b: Finding) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    const byTime = (a: Finding, b: Finding) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

    return [...rows].sort((a, b) => {
      if (filters.sort === "newest") return byTime(a, b) || bySeverity(a, b);
      if (filters.sort === "oldest") return -byTime(a, b) || bySeverity(a, b);
      // Within a severity band, surface the most recent first.
      return bySeverity(a, b) || byTime(a, b);
    });
  }, [findings, q, filters.severities, filters.statuses, filters.sort]);

  if (loading) return <PageLoading label="Loading findings…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!findings) return null;

  const filterCount =
    filters.severities.length + filters.statuses.length + (filters.q.trim() ? 1 : 0);
  const isFiltered = filterCount > 0;

  return (
    <>
      <PageHeader
        title="Findings"
        description="All vulnerabilities discovered across your workspace, de-duplicated."
        actions={
          <div className="flex w-full items-center gap-2 md:w-auto">
            <div className="relative w-full md:w-72">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
                placeholder="Search title, target, CVE…"
                aria-label="Search findings"
                className="h-9 w-full rounded-md border border-border bg-surface/60 pl-8 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
              {draftQuery ? (
                <button
                  type="button"
                  onClick={() => setDraftQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <SortControl
              value={filters.sort}
              onChange={(sort) => commit({ ...filters, sort })}
            />
          </div>
        }
      />

      {/* Severity chips double as the summary and the filter. Previously these
          were inert cards next to a search box that did nothing. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 md:gap-3">
        {severityCounts.map(({ severity, count }) => {
          const active = filters.severities.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              aria-pressed={active}
              onClick={() =>
                commit({ ...filters, severities: toggle(filters.severities, severity) })
              }
              className={cn(
                "group flex items-center justify-between rounded-lg border bg-card p-3 text-left transition-colors md:p-4",
                active
                  ? "border-primary/60 bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-surface-2/40",
                count === 0 && !active && "opacity-55",
              )}
            >
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {severity}
                </div>
                <div
                  className={cn(
                    "mt-1 text-xl font-semibold tabular-nums md:text-2xl",
                    SEV_TEXT[severity],
                  )}
                >
                  {count}
                </div>
              </div>
              <SeverityBadge severity={severity} />
            </button>
          );
        })}
      </div>

      {statusCounts.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Triage state
          </span>
          {statusCounts.map(({ status, count }) => {
            const active = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  commit({ ...filters, statuses: toggle(filters.statuses, status) })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border bg-surface/60 text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("font-medium", active ? "" : STATUS_META[status].tone)}>
                  {STATUS_META[status].label}
                </span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          Showing <span className="tabular-nums text-foreground">{visible.length}</span> of{" "}
          <span className="tabular-nums">{findings.length}</span>{" "}
          {findings.length === 1 ? "finding" : "findings"}
          {isFiltered ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"} active` : ""}
        </p>
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={() => commit({ ...EMPTY })}>
            <FilterX className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <EmptyState
              filtered={isFiltered}
              onClear={() => commit({ ...EMPTY })}
              total={findings.length}
            />
          ) : (
            <>
              {/* Desktop header */}
              <div className="hidden grid-cols-[1.4fr_0.9fr_1.3fr_0.7fr_0.6fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
                <div>Title</div>
                <div>Target</div>
                <div>Description</div>
                <div>Severity</div>
                <div className="text-right">Detected</div>
              </div>
              <ul>
                {visible.map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function FindingRow({ finding: f }: { finding: Finding }) {
  const status = (f.status ?? "open") as FindingStatus;
  return (
    <li
      className={cn(
        "relative border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2/40",
        "md:grid md:grid-cols-[1.4fr_0.9fr_1.3fr_0.7fr_0.6fr] md:items-center md:gap-3",
        // A colour rail makes the severity of a long list scannable in the
        // periphery, without relying on colour alone -- the badge still says it.
        "border-l-2",
        SEV_RAIL[f.severity],
      )}
    >
      {/* Mobile layout */}
      <div className="flex flex-col gap-2 md:hidden">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/findings/${f.id}`}
            className="flex-1 text-sm font-medium hover:underline"
          >
            {f.title}
          </Link>
          <SeverityBadge severity={f.severity} />
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {f.target ?? "—"}
        </div>
        <div className="line-clamp-2 text-xs text-muted-foreground">{f.description}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={STATUS_META[status].tone}>{STATUS_META[status].label}</span>
          <span aria-hidden>·</span>
          <span>{formatRelativeTime(f.timestamp)}</span>
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden min-w-0 md:block">
        <Link
          href={`/findings/${f.id}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {f.title}
        </Link>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("text-[11px]", STATUS_META[status].tone)}>
            {STATUS_META[status].label}
          </span>
          {f.cve ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {f.cve}
            </Badge>
          ) : null}
          {f.cvss != null ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              CVSS {f.cvss.toFixed(1)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="hidden truncate font-mono text-xs text-muted-foreground md:block">
        {f.target ?? "—"}
      </div>
      <div className="hidden line-clamp-1 text-xs text-muted-foreground md:block">
        {f.description}
      </div>
      <div className="hidden md:block">
        <SeverityBadge severity={f.severity} />
      </div>
      <div className="hidden text-right text-xs tabular-nums text-muted-foreground md:block">
        {formatRelativeTime(f.timestamp)}
      </div>
    </li>
  );
}

function SortControl({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  return (
    <div className="relative">
      <ArrowUpDown
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        aria-label="Sort findings"
        className="h-9 cursor-pointer appearance-none rounded-md border border-border bg-surface/60 pl-8 pr-7 text-sm outline-none transition-colors hover:bg-surface-2/60 focus:border-primary/50"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EmptyState({
  filtered,
  onClear,
  total,
}: {
  filtered: boolean;
  onClear: () => void;
  total: number;
}) {
  if (!filtered && total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-live/30 bg-live/10 text-live">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium">No findings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing has been discovered in this workspace. Launch a scan to start
            collecting results.
          </p>
        </div>
        <Link href="/runs/new">
          <Button size="sm">Start a scan</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2/60 text-muted-foreground">
        <Search className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium">No findings match these filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} finding{total === 1 ? "" : "s"} exist in the workspace — none match the
          current search and filter combination.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onClear}>
        <FilterX className="h-3.5 w-3.5" />
        Clear filters
      </Button>
    </div>
  );
}
