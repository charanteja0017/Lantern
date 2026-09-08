"use client";

import Link from "next/link";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "@/components/common/severity-badge";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";
import { formatRelativeTime } from "@/lib/utils";
import type { Severity } from "@/lib/types";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export default function FindingsPage() {
  const { data: findings, loading, error, refetch } = useProviderData(
    (p) => p.listFindings(),
    [],
    // New findings should appear live while a scan runs — 6s is frequent
    // enough to feel immediate without hammering the API.
    { pollMs: 6000 },
  );

  if (loading) return <PageLoading label="Loading findings…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!findings) return null;

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const countsBySeverity = SEVERITY_ORDER.map((s) => ({
    s,
    n: findings.filter((f) => f.severity === s).length,
  }));

  return (
    <>
      <PageHeader
        title="Findings"
        description="All vulnerabilities discovered across your workspace, de-duplicated."
        actions={<Input placeholder="Search findings…" className="h-9 w-full md:w-64" />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 md:gap-3">
        {countsBySeverity.map(({ s, n }) => (
          <Card key={s}>
            <CardContent className="flex items-center justify-between p-3 md:p-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums md:text-2xl">{n}</div>
              </div>
              <SeverityBadge severity={s} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop header */}
          <div className="hidden grid-cols-[1fr_0.8fr_1.5fr_0.7fr_0.6fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
            <div>Title</div>
            <div>Target</div>
            <div>Description</div>
            <div>Severity</div>
            <div className="text-right">Detected</div>
          </div>
          <ul>
            {sorted.map((f) => (
              <li
                key={f.id}
                className="border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2/40 md:grid md:grid-cols-[1fr_0.8fr_1.5fr_0.7fr_0.6fr] md:items-center md:gap-3"
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
                  <div className="truncate text-xs text-muted-foreground">{f.target ?? "—"}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{f.description}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(f.timestamp)}
                  </div>
                </div>

                {/* Desktop layout */}
                <Link
                  href={`/findings/${f.id}`}
                  className="hidden truncate text-sm font-medium hover:underline md:block"
                >
                  {f.title}
                </Link>
                <div className="hidden truncate text-xs text-muted-foreground md:block">
                  {f.target ?? "—"}
                </div>
                <div className="hidden line-clamp-1 text-xs text-muted-foreground md:block">
                  {f.description}
                </div>
                <div className="hidden md:block">
                  <SeverityBadge severity={f.severity} />
                </div>
                <div className="hidden text-right text-xs text-muted-foreground md:block">
                  {formatRelativeTime(f.timestamp)}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
